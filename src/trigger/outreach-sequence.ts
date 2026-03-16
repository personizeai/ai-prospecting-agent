import { task, wait } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { workspace } from '../lib/workspace.js';
import { generateOutreachForContact } from '../pipelines/generate-outreach.js';
import { sendAndLog } from '../delivery/hubspot-deliver.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';
import { getCadence, getCadenceName } from '../config/prospecting.config.js';

/**
 * Check workspace for stop signals: opt-out, reply, bounce, or issue.
 * Uses the workspace state instead of raw memory recall.
 */
async function shouldStopSequence(contactEmail: string): Promise<{ stop: boolean; reason: string }> {
  const state = await workspace.getSequenceState(contactEmail);

  if (state.hasOptedOut) return { stop: true, reason: 'opted_out' };
  if (state.hasReplied) return { stop: true, reason: 'replied' };
  if (state.lastEngagement === 'bounced') return { stop: true, reason: 'bounced' };

  // Also check for critical issues raised by any agent
  const issues = await workspace.getIssues(contactEmail);
  for (const item of issues.data || []) {
    const content = (item.content || '').toUpperCase();
    if (content.includes('"STATUS":"OPEN"') && content.includes('"SEVERITY":"CRITICAL"')) {
      return { stop: true, reason: 'critical_issue' };
    }
  }

  return { stop: false, reason: '' };
}

/**
 * Record a sent email in the workspace (message + update + context rewrite).
 */
async function recordEmailSent(
  contactEmail: string,
  generated: { step: number; subject: string; bodyText: string; angle: string },
  dryRun: boolean,
  cadence: { maxEmails: number; label: string },
) {
  // Record the message
  await workspace.addMessageSent(contactEmail, {
    channel: 'email',
    subject: generated.subject,
    bodyPreview: generated.bodyText.substring(0, 200),
    step: generated.step,
    angle: generated.angle,
    sentBy: 'outreach-agent',
    status: dryRun ? 'sent' : 'delivered',
  });

  // Add timeline update
  await workspace.addUpdate(contactEmail, {
    author: 'outreach-agent',
    type: 'outreach',
    summary: `Email ${generated.step}/${cadence.maxEmails} ${dryRun ? '(dry run)' : 'sent'}: "${generated.subject}"`,
    details: `Angle: ${generated.angle} | Cadence: ${cadence.label}`,
  });

  const isLastEmail = generated.step >= cadence.maxEmails;

  await workspace.rewriteContext(contactEmail, [
    `Sequence Status: Email ${generated.step}/${cadence.maxEmails} sent (${cadence.label})`,
    `Last Email: "${generated.subject}" (${generated.angle})`,
    `Sent: ${new Date().toISOString().split('T')[0]}`,
    `Awaiting: ${isLastEmail ? 'End of sequence' : 'Reply or next step'}`,
  ].join('\n'), 'outreach-agent');
}

/**
 * Record when the sequence stops (reply, opt-out, etc.) in the workspace.
 */
async function recordSequenceStopped(contactEmail: string, reason: string, afterStep: number) {
  await workspace.addUpdate(contactEmail, {
    author: 'outreach-agent',
    type: 'system',
    summary: `Sequence stopped after email ${afterStep}: ${reason}`,
  });

  if (reason === 'replied') {
    await workspace.addTask(contactEmail, {
      title: 'Review reply and respond personally',
      description: `Lead replied after email ${afterStep}. Review the reply and craft a personal response within 1 hour. Check the workspace notes for reply analysis.`,
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'outreach-agent',
      priority: 'urgent',
      dueDate: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
    });

    await notifySlack(
      `*Reply detected!* 🔔\nFrom: ${contactEmail}\nAfter: Email ${afterStep}\nAction: Review reply and respond personally`
    );
  }

  if (reason === 'opted_out' || reason === 'not_interested') {
    await workspace.raiseIssue(contactEmail, {
      title: 'Lead opted out of communications',
      description: `Lead indicated they do not want further outreach. Reason: ${reason}. Do NOT send any more emails.`,
      severity: 'critical',
      status: 'open',
      raisedBy: 'outreach-agent',
    });
  }

  if (reason === 'bounced') {
    await workspace.raiseIssue(contactEmail, {
      title: 'Email bounced — invalid address',
      description: 'Email delivery failed. Verify the email address or find an alternative contact.',
      severity: 'high',
      status: 'open',
      raisedBy: 'outreach-agent',
    });
  }

  await workspace.rewriteContext(contactEmail, [
    `Sequence Status: STOPPED (${reason}) after email ${afterStep}.`,
    reason === 'replied' ? 'Action: Sales rep to respond within 1 hour.' : '',
    reason === 'opted_out' ? 'Action: Do not contact again.' : '',
    reason === 'bounced' ? 'Action: Verify email address.' : '',
  ].filter(Boolean).join('\n'), 'outreach-agent');
}

// ─── Full Outreach Sequence (Cadence-Driven) ─────────────────────

export const fullSequenceTask = task({
  id: "full-outreach-sequence",
  retry: { maxAttempts: 2 },
  onFailure: async (payload, error, { ctx }) => {
    await reportFailure(`full-outreach-sequence (${payload.contactEmail})`, ctx.run.id, error);
  },
  run: async ({ contactEmail, crmId, icpScore }: { contactEmail: string; crmId: string; icpScore?: number }) => {
    const dryRun = process.env.DRY_RUN !== 'false';
    const cadence = getCadence(icpScore);
    const cadenceName = getCadenceName(icpScore);
    const results: { step: number; subject: string }[] = [];

    // Log cadence selection
    await workspace.addUpdate(contactEmail, {
      author: 'outreach-agent',
      type: 'system',
      summary: `Sequence started: ${cadenceName} cadence (${cadence.maxEmails} emails, waits: [${cadence.waitDays.join(', ')}] days)`,
    });

    for (let step = 1; step <= cadence.maxEmails; step++) {
      // Check for stop signals before each email
      const check = await shouldStopSequence(contactEmail);
      if (check.stop) {
        await recordSequenceStopped(contactEmail, check.reason, step - 1);
        return {
          contactEmail,
          cadence: cadenceName,
          status: step === 1 ? check.reason : `${check.reason}_after_email_${step - 1}`,
          results,
        };
      }

      // Generate and send the email
      const generated = await generateOutreachForContact(contactEmail, dryRun, cadence);
      if (!generated) {
        await workspace.addUpdate(contactEmail, {
          author: 'outreach-agent',
          type: 'system',
          summary: step === 1
            ? 'Skipped: not qualified or generation failed.'
            : `Email ${step} generation failed. Sequence stopped.`,
        });
        return {
          contactEmail,
          cadence: cadenceName,
          status: step === 1 ? 'skipped' : 'sequence_stopped',
          ...(step === 1 ? { reason: 'not qualified' } : {}),
          results,
        };
      }

      if (!dryRun) await sendAndLog(generated, crmId);
      await recordEmailSent(contactEmail, generated, dryRun, cadence);
      results.push({ step, subject: generated.subject });

      // Durable wait between emails — Trigger.dev checkpoints, no cost during wait
      if (step < cadence.maxEmails) {
        const waitDays = cadence.waitDays[step - 1] ?? cadence.waitDays[cadence.waitDays.length - 1];
        await wait.for({ days: waitDays });
      }
    }

    // Sequence complete — trigger multi-channel follow-up if enabled
    const { LINKEDIN_CONFIG, CALL_CONFIG } = await import('../config/prospecting.config.js');
    const channelActions: string[] = [];

    if (LINKEDIN_CONFIG.enabled) {
      // Trigger LinkedIn outreach for contacts with a LinkedIn URL
      try {
        const { generateLinkedInMessage } = await import('../pipelines/generate-linkedin-message.js');
        const { sendViaLinkedIn } = await import('../delivery/linkedin.js');

        const contactData = await client.memory.smartDigest({
          email: contactEmail,
          type: 'Contact',
          token_budget: 300,
          include_properties: true,
        });
        const linkedinUrl = (contactData.data as any)?.properties?.linkedin_url?.value || '';

        if (linkedinUrl) {
          const linkedInMsg = await generateLinkedInMessage(contactEmail, String(linkedinUrl), cadence.maxEmails + 1, dryRun);
          if (linkedInMsg && !dryRun) {
            await sendViaLinkedIn(linkedInMsg, crmId);
          }
          channelActions.push('LinkedIn connection request sent');
        }
      } catch (err) {
        // Non-fatal — LinkedIn is optional
      }
    }

    if (CALL_CONFIG.enabled && icpScore && icpScore >= CALL_CONFIG.minScoreForCall) {
      // Trigger call script generation for high-score contacts
      try {
        const { generateCallScriptForContact } = await import('../pipelines/generate-call-script.js');
        const { executeCall } = await import('../delivery/phone.js');

        const script = await generateCallScriptForContact(contactEmail, icpScore, cadence.maxEmails + 1, dryRun);
        if (script && !dryRun) {
          await executeCall(script, crmId);
        }
        if (script) channelActions.push('Call script generated');
      } catch (err) {
        // Non-fatal — calls are optional
      }
    }

    // Create follow-up task for remaining manual actions
    const nextStepsDescription = channelActions.length > 0
      ? `Multi-channel actions taken: ${channelActions.join(', ')}. Review results and evaluate: add to nurture? Mark as cold?`
      : `All ${cadence.maxEmails} emails sent (${cadenceName} cadence) with no reply. Evaluate: try different channel (LinkedIn/call)? Add to nurture? Mark as cold?`;

    await workspace.addTask(contactEmail, {
      title: 'Sequence complete — evaluate for next steps',
      description: nextStepsDescription,
      status: 'pending',
      owner: 'sales-rep',
      createdBy: 'outreach-agent',
      priority: 'medium',
    });

    await workspace.rewriteContext(contactEmail, [
      `Sequence Status: COMPLETE (${cadence.maxEmails}/${cadence.maxEmails} emails sent, no reply).`,
      `Cadence: ${cadenceName} (${cadence.label})`,
      channelActions.length > 0
        ? `Multi-channel: ${channelActions.join(', ')}`
        : 'Action: Sales rep to evaluate next steps — different channel, nurture, or archive.',
    ].join('\n'), 'outreach-agent');

    return { contactEmail, cadence: cadenceName, status: 'sequence_complete', results, channelActions };
  },
});
