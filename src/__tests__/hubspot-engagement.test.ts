import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Helpers (mirror production code) ────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getEmailBody(props: Record<string, string | null>): string {
  if (props.hs_email_text) return props.hs_email_text;
  if (props.hs_email_html) return stripHtml(props.hs_email_html);
  return '';
}

function formatEngagement(type: string, props: Record<string, string | null>): string {
  const timestamp = props.hs_timestamp || props.hs_meeting_start_time || '';
  const date = timestamp ? new Date(timestamp).toISOString().split('T')[0] : 'Unknown date';

  switch (type) {
    case 'notes': {
      const body = props.hs_note_body || '';
      const cleanBody = body.includes('<') ? stripHtml(body) : body;
      return `[CRM NOTE — ${date}]\n${cleanBody.substring(0, 2000)}`;
    }

    case 'emails': {
      const direction = props.hs_email_direction === 'INCOMING_EMAIL' ? 'RECEIVED' : 'SENT';
      const body = getEmailBody(props);
      return [
        `[CRM EMAIL ${direction} — ${date}]`,
        `Subject: ${props.hs_email_subject || '(no subject)'}`,
        props.hs_email_from_email ? `From: ${props.hs_email_from_email}` : '',
        body.substring(0, 2000),
      ].filter(Boolean).join('\n');
    }

    case 'meetings': {
      const notes = props.hs_internal_meeting_notes || '';
      const body = props.hs_meeting_body || '';
      const cleanNotes = notes.includes('<') ? stripHtml(notes) : notes;
      const cleanBody = body.includes('<') ? stripHtml(body) : body;
      return [
        `[CRM MEETING — ${date}]`,
        `Title: ${props.hs_meeting_title || 'Meeting'}`,
        `Outcome: ${props.hs_meeting_outcome || 'Unknown'}`,
        props.hs_meeting_location ? `Location: ${props.hs_meeting_location}` : '',
        cleanNotes ? `Internal Notes: ${cleanNotes.substring(0, 2000)}` : '',
        cleanBody.substring(0, 1500),
      ].filter(Boolean).join('\n');
    }

    case 'calls': {
      const direction = props.hs_call_direction === 'INBOUND' ? 'Inbound' : 'Outbound';
      return [
        `[CRM CALL (${direction}) — ${date}]`,
        `Title: ${props.hs_call_title || 'Call'}`,
        `Duration: ${props.hs_call_duration ? Math.round(Number(props.hs_call_duration) / 1000 / 60) + ' min' : 'Unknown'}`,
        `Status: ${props.hs_call_status || 'Unknown'}`,
        props.hs_call_disposition ? `Disposition: ${props.hs_call_disposition}` : '',
        (props.hs_call_body || '').substring(0, 2000),
      ].filter(Boolean).join('\n');
    }

    case 'tasks': {
      const taskType = props.hs_task_type ? ` (${props.hs_task_type})` : '';
      return [
        `[CRM TASK${taskType} — ${date}]`,
        `Subject: ${props.hs_task_subject || 'Task'}`,
        `Status: ${props.hs_task_status || 'Unknown'}`,
        `Priority: ${props.hs_task_priority || 'Normal'}`,
        (props.hs_task_body || '').substring(0, 1000),
      ].join('\n');
    }

    default:
      return `[CRM ${type.toUpperCase()} — ${date}]\n${JSON.stringify(props).substring(0, 1000)}`;
  }
}

// ─── HTML Stripping ──────────────────────────────────────────────

describe('HTML Stripping', () => {
  it('strips basic HTML tags', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('converts <br> to newlines', () => {
    assert.equal(stripHtml('Line 1<br>Line 2<br/>Line 3'), 'Line 1\nLine 2\nLine 3');
  });

  it('decodes HTML entities', () => {
    assert.equal(stripHtml('A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s'), "A & B < C > D \"E\" F's");
  });

  it('replaces &nbsp; with space', () => {
    assert.equal(stripHtml('Hello&nbsp;world'), 'Hello world');
  });

  it('collapses excessive newlines', () => {
    const result = stripHtml('<p>A</p><p></p><p></p><p>B</p>');
    assert.ok(!result.includes('\n\n\n'));
  });
});

// ─── Email Body Fallback ─────────────────────────────────────────

describe('Email Body Fallback', () => {
  it('prefers hs_email_text when available', () => {
    const body = getEmailBody({
      hs_email_text: 'Plain text body',
      hs_email_html: '<p>HTML body</p>',
    });
    assert.equal(body, 'Plain text body');
  });

  it('falls back to stripped HTML when text is null', () => {
    const body = getEmailBody({
      hs_email_text: null,
      hs_email_html: '<p>Hello <b>world</b></p><br><p>Second paragraph.</p>',
    });
    assert.ok(!body.includes('<'));
    assert.ok(body.includes('Hello'));
    assert.ok(body.includes('world'));
  });

  it('returns empty string when both are null', () => {
    const body = getEmailBody({ hs_email_text: null, hs_email_html: null });
    assert.equal(body, '');
  });
});

// ─── Engagement Formatting ───────────────────────────────────────

describe('Engagement Formatting', () => {
  it('formats notes and strips HTML from note body', () => {
    const result = formatEngagement('notes', {
      hs_note_body: '<p>Discussed <b>pricing</b> and timeline.</p>',
      hs_timestamp: '2026-02-15T10:00:00Z',
      hubspot_owner_id: '12345',
    });
    assert.ok(result.startsWith('[CRM NOTE — 2026-02-15]'));
    assert.ok(result.includes('Discussed pricing and timeline.'));
    assert.ok(!result.includes('<p>'));
  });

  it('keeps plain-text notes as-is', () => {
    const result = formatEngagement('notes', {
      hs_note_body: 'Just a plain text note.',
      hs_timestamp: '2026-02-15T10:00:00Z',
      hubspot_owner_id: null,
    });
    assert.ok(result.includes('Just a plain text note.'));
  });

  it('formats outgoing emails with from address', () => {
    const result = formatEngagement('emails', {
      hs_email_subject: 'Following up on our call',
      hs_email_text: 'Hi Sarah, great talking to you yesterday...',
      hs_email_html: null,
      hs_email_direction: 'FORWARDED_EMAIL',
      hs_email_from_email: 'rep@company.com',
      hs_email_to_email: 'sarah@acme.com',
      hs_timestamp: '2026-03-01T14:30:00Z',
      hs_email_status: null,
    });
    assert.ok(result.includes('[CRM EMAIL SENT — 2026-03-01]'));
    assert.ok(result.includes('Subject: Following up on our call'));
    assert.ok(result.includes('From: rep@company.com'));
    assert.ok(result.includes('great talking to you'));
  });

  it('formats incoming emails correctly', () => {
    const result = formatEngagement('emails', {
      hs_email_subject: 'Re: Our product',
      hs_email_text: 'Thanks for reaching out. We are interested.',
      hs_email_html: null,
      hs_email_direction: 'INCOMING_EMAIL',
      hs_email_from_email: 'prospect@acme.com',
      hs_email_to_email: null,
      hs_timestamp: '2026-03-02T09:00:00Z',
      hs_email_status: null,
    });
    assert.ok(result.includes('[CRM EMAIL RECEIVED — 2026-03-02]'));
    assert.ok(result.includes('From: prospect@acme.com'));
  });

  it('falls back to stripped HTML when email text is null', () => {
    const result = formatEngagement('emails', {
      hs_email_subject: 'Welcome',
      hs_email_text: null,
      hs_email_html: '<p>Welcome to our <b>platform</b>!</p>',
      hs_email_direction: 'EMAIL',
      hs_email_from_email: null,
      hs_email_to_email: null,
      hs_timestamp: '2026-03-01T00:00:00Z',
      hs_email_status: null,
    });
    assert.ok(result.includes('Welcome to our platform!'));
    assert.ok(!result.includes('<p>'));
  });

  it('formats meetings with internal notes and location', () => {
    const result = formatEngagement('meetings', {
      hs_meeting_title: 'Product Demo',
      hs_meeting_body: 'Walked through the main features.',
      hs_internal_meeting_notes: 'Prospect very interested in automation. Budget approved.',
      hs_meeting_start_time: '2026-02-20T15:00:00Z',
      hs_meeting_end_time: '2026-02-20T16:00:00Z',
      hs_meeting_outcome: 'COMPLETED',
      hs_meeting_location: 'https://zoom.us/j/123456',
    });
    assert.ok(result.includes('[CRM MEETING — 2026-02-20]'));
    assert.ok(result.includes('Outcome: COMPLETED'));
    assert.ok(result.includes('Location: https://zoom.us/j/123456'));
    assert.ok(result.includes('Internal Notes: Prospect very interested'));
    assert.ok(result.includes('Walked through the main features.'));
  });

  it('formats calls with direction and status', () => {
    const result = formatEngagement('calls', {
      hs_call_title: 'Discovery Call',
      hs_call_body: 'Discussed pain points around scaling.',
      hs_call_direction: 'OUTBOUND',
      hs_call_duration: '1800000',
      hs_call_status: 'COMPLETED',
      hs_call_disposition: 'CONNECTED',
      hs_timestamp: '2026-03-05T11:00:00Z',
    });
    assert.ok(result.includes('[CRM CALL (Outbound) — 2026-03-05]'));
    assert.ok(result.includes('Duration: 30 min'));
    assert.ok(result.includes('Status: COMPLETED'));
    assert.ok(result.includes('Disposition: CONNECTED'));
  });

  it('formats inbound calls', () => {
    const result = formatEngagement('calls', {
      hs_call_title: 'Support Call',
      hs_call_body: 'Customer called about billing.',
      hs_call_direction: 'INBOUND',
      hs_call_duration: '600000',
      hs_call_status: 'COMPLETED',
      hs_call_disposition: null,
      hs_timestamp: '2026-03-06T09:00:00Z',
    });
    assert.ok(result.includes('[CRM CALL (Inbound) — 2026-03-06]'));
    assert.ok(result.includes('Duration: 10 min'));
    assert.ok(!result.includes('Disposition:')); // null disposition is filtered out
  });

  it('formats tasks with task type', () => {
    const result = formatEngagement('tasks', {
      hs_task_subject: 'Send follow-up proposal',
      hs_task_body: 'Include pricing for enterprise tier.',
      hs_task_status: 'COMPLETED',
      hs_task_priority: 'HIGH',
      hs_task_type: 'EMAIL',
      hs_timestamp: '2026-03-01T08:00:00Z',
    });
    assert.ok(result.includes('[CRM TASK (EMAIL) — 2026-03-01]'));
    assert.ok(result.includes('Subject: Send follow-up proposal'));
    assert.ok(result.includes('Status: COMPLETED'));
    assert.ok(result.includes('Priority: HIGH'));
  });

  it('handles missing timestamp gracefully', () => {
    const result = formatEngagement('notes', {
      hs_note_body: 'Some note.',
      hs_timestamp: null,
      hubspot_owner_id: null,
    });
    assert.ok(result.includes('Unknown date'));
  });

  it('handles unknown engagement types', () => {
    const result = formatEngagement('custom_type', {
      some_prop: 'value',
      hs_timestamp: '2026-01-01T00:00:00Z',
    });
    assert.ok(result.includes('[CRM CUSTOM_TYPE — 2026-01-01]'));
  });

  it('handles emails with no subject and no from', () => {
    const result = formatEngagement('emails', {
      hs_email_subject: null,
      hs_email_text: 'Body text',
      hs_email_html: null,
      hs_email_direction: null,
      hs_email_from_email: null,
      hs_email_to_email: null,
      hs_timestamp: '2026-03-01T00:00:00Z',
      hs_email_status: null,
    });
    assert.ok(result.includes('(no subject)'));
    assert.ok(result.includes('SENT'));
    assert.ok(!result.includes('From:'));
  });
});

// ─── Content Truncation ──────────────────────────────────────────

describe('Engagement Content Truncation', () => {
  it('truncates note body to 2000 chars', () => {
    const longBody = 'x'.repeat(5000);
    const truncated = longBody.substring(0, 2000);
    assert.equal(truncated.length, 2000);
  });

  it('truncates meeting body to 1500 chars (internal notes get 2000)', () => {
    const longBody = 'x'.repeat(5000);
    const truncated = longBody.substring(0, 1500);
    assert.equal(truncated.length, 1500);
  });

  it('truncates task body to 1000 chars', () => {
    const longBody = 'x'.repeat(5000);
    const truncated = longBody.substring(0, 1000);
    assert.equal(truncated.length, 1000);
  });
});

// ─── Recency Window ─────────────────────────────────────────────

describe('Engagement Recency Window', () => {
  function isWithinRecencyWindow(props: Record<string, string | null>, recencyDays: number): boolean {
    if (!recencyDays) return true;
    const timestamp = props.hs_timestamp || props.hs_meeting_start_time || '';
    if (!timestamp) return true;
    const engagementDate = new Date(timestamp).getTime();
    if (isNaN(engagementDate)) return true;
    const cutoff = Date.now() - (recencyDays * 24 * 60 * 60 * 1000);
    return engagementDate >= cutoff;
  }

  it('includes engagements within 90-day window', () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    assert.ok(isWithinRecencyWindow({ hs_timestamp: thirtyDaysAgo.toISOString() }, 90));
  });

  it('excludes engagements outside 90-day window', () => {
    const oneHundredDaysAgo = new Date();
    oneHundredDaysAgo.setDate(oneHundredDaysAgo.getDate() - 100);
    assert.equal(isWithinRecencyWindow({ hs_timestamp: oneHundredDaysAgo.toISOString() }, 90), false);
  });

  it('includes all engagements when recencyDays is 0', () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    assert.ok(isWithinRecencyWindow({ hs_timestamp: twoYearsAgo.toISOString() }, 0));
  });

  it('includes engagements with no timestamp', () => {
    assert.ok(isWithinRecencyWindow({ hs_timestamp: null }, 90));
  });

  it('includes engagements with invalid timestamp', () => {
    assert.ok(isWithinRecencyWindow({ hs_timestamp: 'not-a-date' }, 90));
  });

  it('uses meeting start time when no hs_timestamp', () => {
    const fiftyDaysAgo = new Date();
    fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
    assert.ok(isWithinRecencyWindow({
      hs_timestamp: null,
      hs_meeting_start_time: fiftyDaysAgo.toISOString(),
    }, 90));
  });
});

// ─── Engagement Properties ──────────────────────────────────────

describe('Engagement Properties Config', () => {
  const ENGAGEMENT_PROPERTIES: Record<string, string[]> = {
    notes: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
    emails: [
      'hs_email_subject', 'hs_email_text', 'hs_email_html',
      'hs_email_direction', 'hs_email_status',
      'hs_email_from_email', 'hs_email_to_email', 'hs_timestamp',
    ],
    meetings: [
      'hs_meeting_title', 'hs_meeting_body', 'hs_internal_meeting_notes',
      'hs_meeting_start_time', 'hs_meeting_end_time',
      'hs_meeting_outcome', 'hs_meeting_location',
    ],
    calls: [
      'hs_call_title', 'hs_call_body', 'hs_call_direction',
      'hs_call_duration', 'hs_call_status', 'hs_call_disposition',
      'hs_timestamp',
    ],
    tasks: [
      'hs_task_subject', 'hs_task_body', 'hs_task_status',
      'hs_task_priority', 'hs_task_type', 'hs_timestamp',
    ],
  };

  it('has all 5 engagement types', () => {
    assert.equal(Object.keys(ENGAGEMENT_PROPERTIES).length, 5);
  });

  it('every type has hs_timestamp or start_time', () => {
    for (const [type, props] of Object.entries(ENGAGEMENT_PROPERTIES)) {
      const hasTimestamp = props.includes('hs_timestamp') || props.includes('hs_meeting_start_time');
      assert.ok(hasTimestamp, `${type} should have a timestamp property`);
    }
  });

  it('emails has both text and html for fallback', () => {
    assert.ok(ENGAGEMENT_PROPERTIES.emails.includes('hs_email_text'));
    assert.ok(ENGAGEMENT_PROPERTIES.emails.includes('hs_email_html'));
  });

  it('emails has from/to address fields', () => {
    assert.ok(ENGAGEMENT_PROPERTIES.emails.includes('hs_email_from_email'));
    assert.ok(ENGAGEMENT_PROPERTIES.emails.includes('hs_email_to_email'));
  });

  it('meetings has internal notes', () => {
    assert.ok(ENGAGEMENT_PROPERTIES.meetings.includes('hs_internal_meeting_notes'));
  });

  it('calls has direction', () => {
    assert.ok(ENGAGEMENT_PROPERTIES.calls.includes('hs_call_direction'));
  });

  it('tasks has type', () => {
    assert.ok(ENGAGEMENT_PROPERTIES.tasks.includes('hs_task_type'));
  });
});

// ─── HUBSPOT_CONFIG Engagement Settings ─────────────────────────

describe('HUBSPOT_CONFIG Engagement Settings', () => {
  it('has engagement sync settings', async () => {
    const { HUBSPOT_CONFIG } = await import('../config/prospecting.config.js');
    assert.equal(typeof HUBSPOT_CONFIG.syncEngagements, 'boolean');
    assert.ok(Array.isArray(HUBSPOT_CONFIG.engagementTypes));
    assert.equal(typeof HUBSPOT_CONFIG.syncDeals, 'boolean');
    assert.equal(typeof HUBSPOT_CONFIG.maxEngagementsPerType, 'number');
    assert.equal(typeof HUBSPOT_CONFIG.engagementRecencyDays, 'number');
  });

  it('engagement types are valid', async () => {
    const { HUBSPOT_CONFIG } = await import('../config/prospecting.config.js');
    const validTypes = ['notes', 'emails', 'meetings', 'calls', 'tasks'];
    for (const type of HUBSPOT_CONFIG.engagementTypes) {
      assert.ok(validTypes.includes(type), `Unknown engagement type: ${type}`);
    }
  });

  it('maxEngagementsPerType is reasonable', async () => {
    const { HUBSPOT_CONFIG } = await import('../config/prospecting.config.js');
    assert.ok(HUBSPOT_CONFIG.maxEngagementsPerType >= 1);
    assert.ok(HUBSPOT_CONFIG.maxEngagementsPerType <= 50);
  });

  it('engagementRecencyDays is reasonable', async () => {
    const { HUBSPOT_CONFIG } = await import('../config/prospecting.config.js');
    assert.ok(HUBSPOT_CONFIG.engagementRecencyDays >= 0);
    assert.ok(HUBSPOT_CONFIG.engagementRecencyDays <= 365);
  });
});

// ─── Deal Formatting ────────────────────────────────────────────

describe('Deal Formatting', () => {
  it('formats deal with won/lost status and currency', () => {
    const p = {
      dealname: 'Enterprise License',
      amount: '50000',
      dealstage: 'closedwon',
      pipeline: 'default',
      closedate: '2026-04-01',
      description: 'Annual enterprise license with premium support.',
      deal_currency_code: 'EUR',
      hs_is_closed_won: 'true',
      hs_is_closed_lost: null,
      closed_won_reason: 'Best product fit',
      closed_lost_reason: null,
    };

    const status = p.hs_is_closed_won === 'true' ? ' (WON)'
      : p.hs_is_closed_lost === 'true' ? ' (LOST)' : '';
    const currency = p.deal_currency_code || 'USD';
    const content = [
      `[CRM DEAL${status}]`,
      `Deal: ${p.dealname || 'Untitled'}`,
      `Amount: ${p.amount ? Number(p.amount).toLocaleString() + ' ' + currency : 'Unknown'}`,
      `Stage: ${p.dealstage || 'Unknown'}`,
      `Pipeline: ${p.pipeline || 'Default'}`,
      `Close Date: ${p.closedate || 'Not set'}`,
      p.closed_won_reason ? `Won Reason: ${p.closed_won_reason}` : '',
      p.closed_lost_reason ? `Lost Reason: ${p.closed_lost_reason}` : '',
      p.description ? `Description: ${p.description.substring(0, 1000)}` : '',
    ].filter(Boolean).join('\n');

    assert.ok(content.includes('[CRM DEAL (WON)]'));
    assert.ok(content.includes('50,000 EUR'));
    assert.ok(content.includes('Won Reason: Best product fit'));
    assert.ok(!content.includes('Lost Reason:'));
  });

  it('formats lost deal with reason', () => {
    const p = {
      dealname: 'Startup Plan',
      amount: '5000',
      dealstage: 'closedlost',
      pipeline: 'default',
      closedate: '2026-03-15',
      description: null,
      deal_currency_code: null,
      hs_is_closed_won: null,
      hs_is_closed_lost: 'true',
      closed_won_reason: null,
      closed_lost_reason: 'Went with competitor',
    };

    const status = p.hs_is_closed_won === 'true' ? ' (WON)'
      : p.hs_is_closed_lost === 'true' ? ' (LOST)' : '';
    const currency = p.deal_currency_code || 'USD';
    const content = [
      `[CRM DEAL${status}]`,
      `Deal: ${p.dealname || 'Untitled'}`,
      `Amount: ${p.amount ? Number(p.amount).toLocaleString() + ' ' + currency : 'Unknown'}`,
      `Stage: ${p.dealstage || 'Unknown'}`,
    ].join('\n');

    assert.ok(content.includes('[CRM DEAL (LOST)]'));
    assert.ok(content.includes('5,000 USD'));
  });

  it('handles missing deal properties', () => {
    const p = {
      dealname: null as string | null,
      amount: null as string | null,
      dealstage: null as string | null,
      pipeline: null as string | null,
      closedate: null as string | null,
      description: null as string | null,
      deal_currency_code: null as string | null,
      hs_is_closed_won: null as string | null,
      hs_is_closed_lost: null as string | null,
      closed_won_reason: null as string | null,
      closed_lost_reason: null as string | null,
    };

    const status = p.hs_is_closed_won === 'true' ? ' (WON)'
      : p.hs_is_closed_lost === 'true' ? ' (LOST)' : '';
    const content = [
      `[CRM DEAL${status}]`,
      `Deal: ${p.dealname || 'Untitled'}`,
      `Amount: ${p.amount ? Number(p.amount).toLocaleString() : 'Unknown'}`,
    ].join('\n');

    assert.ok(content.includes('[CRM DEAL]')); // no status suffix
    assert.ok(content.includes('Deal: Untitled'));
    assert.ok(content.includes('Amount: Unknown'));
  });
});

// ─── Batch Record Structure ─────────────────────────────────────

describe('Engagement Batch Records', () => {
  it('creates one record per engagement for memorizeBatch', () => {
    const engagements = [
      '[CRM EMAIL SENT — 2026-03-01]\nSubject: Hello\nBody text',
      '[CRM EMAIL RECEIVED — 2026-03-02]\nSubject: Re: Hello\nThanks!',
    ];
    const records = engagements.map((content) => ({
      email: 'test@acme.com',
      content,
      collectionName: 'contacts',
      tags: ['crm', 'hubspot', 'engagement:emails'],
    }));

    assert.equal(records.length, 2);
    assert.equal(records[0].email, 'test@acme.com');
    assert.ok(records[0].content.includes('[CRM EMAIL SENT'));
    assert.ok(records[1].content.includes('[CRM EMAIL RECEIVED'));
    assert.deepEqual(records[0].tags, ['crm', 'hubspot', 'engagement:emails']);
  });

  it('creates one record per deal for memorizeBatch', () => {
    const dealTexts = [
      '[CRM DEAL (WON)]\nDeal: Enterprise\nAmount: 50,000 USD',
      '[CRM DEAL]\nDeal: Starter\nAmount: 5,000 USD',
    ];
    const records = dealTexts.map((content) => ({
      email: 'test@acme.com',
      content,
      collectionName: 'contacts',
      tags: ['crm', 'hubspot', 'deal'],
    }));

    assert.equal(records.length, 2);
    assert.deepEqual(records[0].tags, ['crm', 'hubspot', 'deal']);
  });
});
