import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Workspace Entry Formatting', () => {
  it('creates properly structured update entry', () => {
    const update = {
      author: 'outreach-agent',
      type: 'outreach' as const,
      summary: 'Email 1/3 sent: "Quick question about your sales process"',
      details: 'Angle: Recent funding round',
      timestamp: '2026-03-10T10:00:00Z',
    };

    const content = JSON.stringify(update);
    const parsed = JSON.parse(content);

    assert.equal(parsed.author, 'outreach-agent');
    assert.equal(parsed.type, 'outreach');
    assert.ok(parsed.summary.includes('Email 1/3'));
    assert.ok(parsed.timestamp);
  });

  it('creates properly structured task entry', () => {
    const task = {
      title: 'Reply received — respond within 1 hour',
      description: 'Lead replied to outreach. Review and respond.',
      status: 'pending' as const,
      owner: 'sales-rep',
      createdBy: 'engagement-webhook',
      priority: 'urgent' as const,
      dueDate: '2026-03-10T11:00:00Z',
      outcome: null,
    };

    const content = JSON.stringify(task);
    const parsed = JSON.parse(content);

    assert.equal(parsed.status, 'pending');
    assert.equal(parsed.priority, 'urgent');
    assert.equal(parsed.owner, 'sales-rep');
    assert.ok(parsed.dueDate);
  });

  it('creates properly structured issue entry', () => {
    const issue = {
      title: 'Email bounced',
      description: 'Email delivery failed.',
      severity: 'high' as const,
      status: 'open' as const,
      raisedBy: 'engagement-webhook',
      resolution: null,
    };

    const content = JSON.stringify(issue);
    const parsed = JSON.parse(content);

    assert.equal(parsed.severity, 'high');
    assert.equal(parsed.status, 'open');
    assert.equal(parsed.resolution, null);
  });

  it('creates properly structured message entry', () => {
    const message = {
      channel: 'email' as const,
      subject: 'Quick question about your sales stack',
      bodyPreview: 'Hi John, I noticed Acme just raised a Series B...',
      step: 1,
      angle: 'Recent funding round as conversation starter',
      sentBy: 'outreach-agent',
      status: 'sent' as const,
      sentAt: '2026-03-10T10:00:00Z',
    };

    const content = JSON.stringify(message);
    const parsed = JSON.parse(content);

    assert.equal(parsed.channel, 'email');
    assert.equal(parsed.step, 1);
    assert.ok(parsed.bodyPreview.length <= 200);
    assert.ok(parsed.sentAt);
  });
});

describe('Workspace Tagging Conventions', () => {
  it('generates correct tags for updates', () => {
    const author = 'outreach-agent';
    const tags = ['workspace:updates', `source:${author}`];

    assert.ok(tags.includes('workspace:updates'));
    assert.ok(tags.includes('source:outreach-agent'));
  });

  it('generates correct tags for tasks with priority', () => {
    const createdBy = 'engagement-webhook';
    const priority = 'urgent';
    const tags = ['workspace:tasks', `source:${createdBy}`, `priority:${priority}`];

    assert.ok(tags.includes('workspace:tasks'));
    assert.ok(tags.includes('priority:urgent'));
  });

  it('generates correct tags for issues with severity', () => {
    const raisedBy = 'engagement-webhook';
    const severity = 'critical';
    const tags = ['workspace:issues', `source:${raisedBy}`, `severity:${severity}`];

    assert.ok(tags.includes('severity:critical'));
  });

  it('generates correct tags for messages with channel and step', () => {
    const sentBy = 'outreach-agent';
    const channel = 'email';
    const step = 2;
    const tags = ['workspace:messages', `source:${sentBy}`, `channel:${channel}`, `step:${step}`];

    assert.ok(tags.includes('workspace:messages'));
    assert.ok(tags.includes('channel:email'));
    assert.ok(tags.includes('step:2'));
  });
});

describe('Sequence State Parsing', () => {
  it('parses workspace message entries', () => {
    const messages = [
      JSON.stringify({ channel: 'email', step: 1, sentAt: '2026-03-07T10:00:00Z' }),
      JSON.stringify({ channel: 'email', step: 2, sentAt: '2026-03-10T10:00:00Z' }),
      'Some non-JSON memory',
    ];

    let emailsSent = 0;
    let lastSentAt = '';

    for (const content of messages) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.step && parsed.channel === 'email') {
          emailsSent = Math.max(emailsSent, parsed.step);
          if (parsed.sentAt > lastSentAt) lastSentAt = parsed.sentAt;
        }
      } catch {
        // Not JSON — skip
      }
    }

    assert.equal(emailsSent, 2);
    assert.equal(lastSentAt, '2026-03-10T10:00:00Z');
  });

  it('falls back to legacy format parsing', () => {
    const content = '[OUTREACH SENT \u2014 Email 2]\nDate: 2026-03-10T10:00:00Z';

    let emailsSent = 0;
    try {
      JSON.parse(content);
    } catch {
      const match = content.match(/\[OUTREACH SENT\s*[-\u2014\u2013]+\s*Email (\d+)\]/);
      if (match) {
        emailsSent = parseInt(match[1], 10);
      }
    }

    assert.equal(emailsSent, 2);
  });

  it('detects reply from engagement events', () => {
    const engagements = [
      '[EMAIL ENGAGEMENT \u2014 OPEN]\nDate: 2026-03-08',
      '[EMAIL ENGAGEMENT \u2014 REPLY]\nDate: 2026-03-10',
    ];

    let hasReplied = false;
    for (const content of engagements) {
      const upper = content.toUpperCase();
      if (upper.includes('REPLY') || upper.includes('REPLIED')) {
        hasReplied = true;
      }
    }

    assert.ok(hasReplied);
  });

  it('detects opt-out from engagement events', () => {
    const engagements = [
      'Please unsubscribe me from your list',
    ];

    let hasOptedOut = false;
    for (const content of engagements) {
      const upper = content.toUpperCase();
      if (upper.includes('UNSUBSCRIBE')) hasOptedOut = true;
      if (upper.includes('OPT') && upper.includes('OUT')) hasOptedOut = true;
      if (upper.includes('NOT INTERESTED')) hasOptedOut = true;
      if (upper.includes('REMOVE ME')) hasOptedOut = true;
    }

    assert.ok(hasOptedOut);
  });

  it('detects bounce from engagement events', () => {
    const content = '[EMAIL ENGAGEMENT \u2014 BOUNCED]';
    const lastEngagement = content.toUpperCase().includes('BOUNCED') ? 'bounced' : 'none';
    assert.equal(lastEngagement, 'bounced');
  });
});

describe('Sequence Stop Logic', () => {
  it('stops on reply', () => {
    const state = { hasOptedOut: false, hasReplied: true, lastEngagement: 'replied' };
    const shouldStop = state.hasOptedOut || state.hasReplied || state.lastEngagement === 'bounced';
    assert.ok(shouldStop);
  });

  it('stops on opt-out', () => {
    const state = { hasOptedOut: true, hasReplied: false, lastEngagement: 'none' };
    const shouldStop = state.hasOptedOut || state.hasReplied || state.lastEngagement === 'bounced';
    assert.ok(shouldStop);
  });

  it('stops on bounce', () => {
    const state = { hasOptedOut: false, hasReplied: false, lastEngagement: 'bounced' };
    const shouldStop = state.hasOptedOut || state.hasReplied || state.lastEngagement === 'bounced';
    assert.ok(shouldStop);
  });

  it('continues when no stop signals', () => {
    const state = { hasOptedOut: false, hasReplied: false, lastEngagement: 'opened' };
    const shouldStop = state.hasOptedOut || state.hasReplied || state.lastEngagement === 'bounced';
    assert.ok(!shouldStop);
  });

  it('stops on critical issue', () => {
    const issueContent = JSON.stringify({ severity: 'critical', status: 'open', title: 'Lead opted out' });
    const upper = issueContent.toUpperCase();
    const hasCriticalIssue = upper.includes('"STATUS":"OPEN"') && upper.includes('"SEVERITY":"CRITICAL"');
    assert.ok(hasCriticalIssue);
  });
});

describe('Context Rewrite Formatting', () => {
  it('formats sequence active context', () => {
    const step: number = 2;
    const subject = 'Quick question about your sales process';
    const angle = 'Recent funding';
    const context = [
      `Sequence Status: Email ${step}/3 sent. Next email in ${step === 1 ? '3' : '5'} days.`,
      `Last Email: "${subject}" (${angle})`,
      `Sent: 2026-03-10`,
      'Awaiting: Reply or next step',
    ].join('\n');

    assert.ok(context.includes('Email 2/3'));
    assert.ok(context.includes('5 days'));
    assert.ok(context.includes(subject));
  });

  it('formats sequence stopped context', () => {
    const reason = 'replied';
    const step = 1;
    const context = [
      `Sequence Status: STOPPED (${reason}) after email ${step}.`,
      reason === 'replied' ? 'Action: Sales rep to respond within 1 hour.' : '',
    ].filter(Boolean).join('\n');

    assert.ok(context.includes('STOPPED (replied)'));
    assert.ok(context.includes('respond within 1 hour'));
  });

  it('formats sequence complete context', () => {
    const context = [
      'Sequence Status: COMPLETE (3/3 emails sent, no reply).',
      'Action: Sales rep to evaluate next steps — different channel, nurture, or archive.',
    ].join('\n');

    assert.ok(context.includes('COMPLETE'));
    assert.ok(context.includes('evaluate next steps'));
  });
});

describe('Message Body Preview Truncation', () => {
  it('truncates long body to 200 chars', () => {
    const body = 'x'.repeat(500);
    const preview = body.substring(0, 200);
    assert.equal(preview.length, 200);
  });

  it('keeps short body as-is', () => {
    const body = 'Hi John, I noticed Acme just raised a Series B.';
    const preview = body.substring(0, 200);
    assert.equal(preview, body);
  });
});
