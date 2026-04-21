/**
 * Creates role-specific governance overlays in Personize.
 *
 * Run: npx tsx src/setup/create-role-governance.ts
 *
 * Each overlay modifies the base governance for a specific role:
 *   - SDR: Challenger tone, curiosity-driven, short cold emails
 *   - AE: Consultative tone, deal-focused, reference prior conversation
 *   - CSM: Supportive tone, retention-focused, reference usage/value
 */

import 'dotenv/config';
import { Personize } from '@personize/sdk';
import { logger } from '../lib/logger.js';

const client = new Personize({ secretKey: process.env.PERSONIZE_SECRET_KEY! });
const log = logger.child({ module: 'create-role-governance' });

interface GovernanceVariable {
  name: string;
  value: string;
  tags: string[];
}

const ROLE_GOVERNANCE: GovernanceVariable[] = [
  // ─── SDR Overlays ─────────────────────────────────────────
  {
    name: 'brand-voice--sdr',
    value: `# SDR Brand Voice Overlay

Role: Sales Development Representative — first touch, cold outreach, qualification.

## Tone
- Challenger: provoke thinking, don't just inform
- Curiosity-driven: ask questions that make them think about their problem
- Brief and punchy: max 4 sentences in the opening email
- No corporate speak, no "I hope this email finds you well"
- Lead with insight, not with yourself

## Rules
- NEVER mention pricing, demos, or product features in Email 1
- Email 1 is about THEM and their problem, not about you
- Use their name, company, and a specific observation
- End with a question, not a pitch
- Subject lines: short (3-6 words), lowercase, no emoji, looks like a human wrote it

## Forbidden
- "I'd love to" / "I was wondering if" / "Just reaching out"
- Company boilerplate in cold emails
- Attaching anything in the first email
- Using the word "solution"`,
    tags: ['governance', 'role-overlay', 'sdr'],
  },

  {
    name: 'outreach-playbook--sdr',
    value: `# SDR Outreach Playbook Overlay

## Sequence Structure
- 3 emails max (cold sequence)
- Wait 3 days between emails
- Each email must use a DIFFERENT angle (problem → insight → social proof)
- If no reply after Email 3: mark for LinkedIn follow-up or nurture

## Qualification Gate
Before booking a meeting, the SDR must confirm:
1. Right person (decision maker or influencer)
2. Right company (ICP match)
3. Buying signal or pain acknowledged

## Handoff to AE
When a lead replies positively (interest, question, meeting request):
- Create handoff task with reply context
- Do NOT try to close — pass to AE immediately
- Include: reply text, sentiment analysis, company context, suggested next steps`,
    tags: ['governance', 'role-overlay', 'sdr'],
  },

  // ─── AE Overlays ──────────────────────────────────────────
  {
    name: 'brand-voice--ae',
    value: `# AE Brand Voice Overlay

Role: Account Executive — warm follow-up, deal management, closing.

## Tone
- Consultative: you're a trusted advisor, not a salesperson
- Reference the conversation so far (SDR handoff context, their reply, their concerns)
- Longer, more detailed emails are appropriate (they already know you)
- Professional but warm — you're building a relationship

## Rules
- ALWAYS reference their previous interaction ("You mentioned...", "Following up on...")
- Propose specific next steps (calendar link, agenda, timeline)
- Address objections proactively if known from reply analysis
- Include relevant case studies or ROI data when appropriate

## Forbidden
- Cold outreach language (they already replied/engaged)
- Generic follow-ups with no context
- Pressuring for a meeting without providing value first`,
    tags: ['governance', 'role-overlay', 'ae'],
  },

  {
    name: 'outreach-playbook--ae',
    value: `# AE Outreach Playbook Overlay

## Sequence Structure
- 2-3 follow-up emails (warm, not cold)
- Wait 2 days between emails
- Include meeting booking link in every email
- Multi-thread: engage other stakeholders if champion goes quiet

## Deal Management
- After meeting: send recap email within 2 hours
- If proposal sent: follow up in 3 days
- If gone quiet after meeting: send value-add content, not "just checking in"

## Handoff to CSM
When deal closes (lead_status → Customer):
- Create handoff task with deal context
- Include: deal size, decision criteria, key stakeholders, implementation notes`,
    tags: ['governance', 'role-overlay', 'ae'],
  },

  // ─── CSM Overlays ─────────────────────────────────────────
  {
    name: 'brand-voice--csm',
    value: `# CSM Brand Voice Overlay

Role: Customer Success Manager — onboarding, retention, renewal, expansion.

## Tone
- Supportive and proactive: you're their partner, not a seller
- Reference their usage, milestones, and wins
- Empathetic when addressing issues
- Forward-looking: always connect current action to their goals

## Rules
- Lead with value delivered, not with asks
- Celebrate their wins ("Congrats on hitting X milestone!")
- When discussing renewals, frame as continued partnership, not a transaction
- For expansion: only suggest when you see clear signals (usage growth, new team members, feature requests)

## Forbidden
- Sales language (close, deal, pipeline, quota)
- Ignoring open support tickets when sending outreach
- Renewal pressure more than 30 days before expiration`,
    tags: ['governance', 'role-overlay', 'csm'],
  },

  {
    name: 'outreach-playbook--csm',
    value: `# CSM Outreach Playbook Overlay

## Check-in Cadence
- Month 1: Weekly onboarding check-ins (4 emails)
- Month 2-11: Monthly value check-ins
- Month 12 (pre-renewal): Bi-weekly renewal engagement

## Retention Signals to Watch
- Usage drop > 30% month-over-month → proactive outreach
- Support ticket spike → escalate and reach out
- Champion leaves company → immediate outreach to new stakeholder
- Competitor mentioned in support tickets → retention playbook

## Expansion Signals
- Usage consistently above plan limits
- New team members added
- Feature requests for premium features
- Positive NPS/CSAT responses`,
    tags: ['governance', 'role-overlay', 'csm'],
  },
];

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  log.info('Creating role-specific governance overlays...');

  // List existing to avoid duplicates
  const existing = await client.context.list({ type: 'guideline' });
  const existingNames = new Set(
    (existing.data?.actions || []).map((a: any) => a.payload?.name).filter(Boolean),
  );

  let created = 0;
  let skipped = 0;

  for (const variable of ROLE_GOVERNANCE) {
    if (existingNames.has(variable.name)) {
      log.info(`Skipping (already exists): ${variable.name}`);
      skipped++;
      continue;
    }

    await client.context.create({
      type: 'guideline',
      name: variable.name,
      value: variable.value,
      tags: variable.tags,
    });
    log.info(`Created: ${variable.name}`);
    created++;
  }

  log.info('Done', { created, skipped, total: ROLE_GOVERNANCE.length });
}

main().catch((err) => {
  log.error('Failed to create role governance', { error: err.message });
  process.exit(1);
});
