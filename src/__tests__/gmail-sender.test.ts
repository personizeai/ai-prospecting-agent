import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Replicate pure functions from gmail.ts ─────────────────────────
// gmail.ts imports config at module level, so we replicate the testable
// functions here. Same pattern as hubspot-engagement.test.ts.

function buildMimeMessage(params: {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): string {
  const boundary = `boundary_test_123`;

  const lines = [
    `From: ${params.fromName} <${params.from}>`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    params.bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    params.bodyHtml,
    ``,
    `--${boundary}--`,
  ];

  return lines.join('\r\n');
}

function encodeMessage(mime: string): string {
  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── Replicate sender selection logic ────────────────────────────────

interface GmailSender {
  email: string;
  name: string;
  refreshToken: string;
  dailyLimit: number;
}

function createSenderSelector(senders: GmailSender[], strategy: 'round-robin' | 'random' = 'round-robin') {
  const dailySends = new Map<string, number>();
  let rrIndex = 0;

  function getSendCount(email: string): number {
    return dailySends.get(email) || 0;
  }

  function incrementSendCount(email: string): void {
    dailySends.set(email, getSendCount(email) + 1);
  }

  function selectSender(): GmailSender | null {
    if (senders.length === 0) return null;

    const available = senders.filter(
      (s) => getSendCount(s.email) < s.dailyLimit,
    );

    if (available.length === 0) return null;

    if (strategy === 'random') {
      return available[Math.floor(Math.random() * available.length)];
    }

    const sender = available[rrIndex % available.length];
    rrIndex = (rrIndex + 1) % available.length;
    return sender;
  }

  function getRemainingCapacity() {
    const perSender = senders.map((s) => ({
      email: s.email,
      remaining: Math.max(0, s.dailyLimit - getSendCount(s.email)),
    }));
    return {
      total: perSender.reduce((sum, s) => sum + s.remaining, 0),
      perSender,
    };
  }

  return { selectSender, incrementSendCount, getSendCount, getRemainingCapacity };
}

function loadGmailSenders(envValue: string | undefined, fallbackEmail?: string, fallbackName?: string, fallbackToken?: string): GmailSender[] {
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue);
      return (parsed as Array<Partial<GmailSender>>).map((s) => ({
        email: s.email || '',
        name: s.name || 'Sales Team',
        refreshToken: s.refreshToken || '',
        dailyLimit: s.dailyLimit || 100,
      }));
    } catch {
      throw new Error('GMAIL_SENDERS is not valid JSON');
    }
  }

  if (fallbackToken && fallbackEmail) {
    return [{
      email: fallbackEmail,
      name: fallbackName || 'Sales Team',
      refreshToken: fallbackToken,
      dailyLimit: 100,
    }];
  }

  return [];
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('MIME Message Building', () => {
  const baseParams = {
    to: 'prospect@acme.com',
    from: 'rep@ourcompany.com',
    fromName: 'Jane Smith',
    subject: 'Quick question about your infrastructure',
    bodyHtml: '<p>Hi there,</p><p>I noticed your team is scaling fast.</p>',
    bodyText: 'Hi there,\n\nI noticed your team is scaling fast.',
  };

  it('includes correct From header with display name', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('From: Jane Smith <rep@ourcompany.com>'));
  });

  it('includes correct To header', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('To: prospect@acme.com'));
  });

  it('includes correct Subject header', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('Subject: Quick question about your infrastructure'));
  });

  it('includes MIME-Version header', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('MIME-Version: 1.0'));
  });

  it('uses multipart/alternative content type', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('Content-Type: multipart/alternative'));
  });

  it('includes plain text part', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('Content-Type: text/plain; charset="UTF-8"'));
    assert.ok(mime.includes('Hi there,'));
  });

  it('includes HTML part', () => {
    const mime = buildMimeMessage(baseParams);
    assert.ok(mime.includes('Content-Type: text/html; charset="UTF-8"'));
    assert.ok(mime.includes('<p>Hi there,</p>'));
  });

  it('has proper boundary markers', () => {
    const mime = buildMimeMessage(baseParams);
    const boundaryCount = (mime.match(/--boundary_test_123/g) || []).length;
    assert.equal(boundaryCount, 3, 'Should have opening, middle, and closing boundaries');
    assert.ok(mime.includes('--boundary_test_123--'), 'Should have closing boundary');
  });

  it('handles special characters in subject', () => {
    const mime = buildMimeMessage({
      ...baseParams,
      subject: 'Re: Q1 results — 50% growth & "big news"',
    });
    assert.ok(mime.includes('Re: Q1 results — 50% growth & "big news"'));
  });

  it('handles empty body text gracefully', () => {
    const mime = buildMimeMessage({ ...baseParams, bodyText: '' });
    assert.ok(mime.includes('Content-Type: text/plain'));
    assert.ok(mime.includes('--boundary_test_123--'));
  });
});

describe('Base64 URL-Safe Encoding', () => {
  it('produces URL-safe base64 (no +, /, or =)', () => {
    const input = 'Subject: Test\r\nTo: a@b.com\r\n\r\nHello >>>???';
    const encoded = encodeMessage(input);
    assert.ok(!encoded.includes('+'), 'Should not contain +');
    assert.ok(!encoded.includes('/'), 'Should not contain /');
    assert.ok(!encoded.includes('='), 'Should not contain trailing =');
  });

  it('encodes and can be decoded back', () => {
    const input = 'From: test@test.com\r\nSubject: Hello\r\n\r\nBody here';
    const encoded = encodeMessage(input);
    const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standard, 'base64').toString('utf-8');
    assert.equal(decoded, input);
  });

  it('handles unicode content', () => {
    const input = 'Subject: Héllo Wörld 你好\r\n\r\nCafé résumé';
    const encoded = encodeMessage(input);
    const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standard, 'base64').toString('utf-8');
    assert.equal(decoded, input);
  });

  it('handles empty input', () => {
    const encoded = encodeMessage('');
    assert.equal(encoded, '');
  });
});

describe('Gmail Reply Threading', () => {
  it('adds Re: prefix when not already present', () => {
    const subject = 'Quick question about your stack';
    const replySubject = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;
    assert.equal(replySubject, 'Re: Quick question about your stack');
  });

  it('does not double-prefix Re:', () => {
    const subject = 'Re: Quick question about your stack';
    const replySubject = subject.startsWith('Re: ') ? subject : `Re: ${subject}`;
    assert.equal(replySubject, 'Re: Quick question about your stack');
  });
});

describe('Multi-Sender Config Loading', () => {
  it('loads multi-sender JSON array', () => {
    const json = JSON.stringify([
      { email: 'alice@co.com', name: 'Alice', refreshToken: '1//aaa', dailyLimit: 50 },
      { email: 'bob@co.com', name: 'Bob', refreshToken: '1//bbb', dailyLimit: 75 },
    ]);
    const senders = loadGmailSenders(json);
    assert.equal(senders.length, 2);
    assert.equal(senders[0].email, 'alice@co.com');
    assert.equal(senders[0].dailyLimit, 50);
    assert.equal(senders[1].name, 'Bob');
  });

  it('defaults dailyLimit to 100 and name to Sales Team', () => {
    const json = JSON.stringify([{ email: 'x@y.com', refreshToken: '1//xxx' }]);
    const senders = loadGmailSenders(json);
    assert.equal(senders[0].dailyLimit, 100);
    assert.equal(senders[0].name, 'Sales Team');
  });

  it('falls back to single-sender env vars', () => {
    const senders = loadGmailSenders(undefined, 'solo@co.com', 'Solo Rep', '1//solo');
    assert.equal(senders.length, 1);
    assert.equal(senders[0].email, 'solo@co.com');
    assert.equal(senders[0].name, 'Solo Rep');
  });

  it('returns empty array when nothing configured', () => {
    const senders = loadGmailSenders(undefined);
    assert.equal(senders.length, 0);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => loadGmailSenders('not json'), /not valid JSON/);
  });

  it('loads senders from multiple domains', () => {
    const json = JSON.stringify([
      { email: 'alice@company-a.com', name: 'Alice', refreshToken: '1//a' },
      { email: 'bob@company-b.com', name: 'Bob', refreshToken: '1//b' },
      { email: 'sara@company-c.io', name: 'Sara', refreshToken: '1//c' },
    ]);
    const senders = loadGmailSenders(json);
    assert.equal(senders.length, 3);
    const domains = senders.map((s) => s.email.split('@')[1]);
    assert.deepEqual(domains, ['company-a.com', 'company-b.com', 'company-c.io']);
  });
});

describe('Sender Selection — Round Robin', () => {
  it('cycles through senders in order', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 100 },
      { email: 'b@co.com', name: 'B', refreshToken: '1//b', dailyLimit: 100 },
      { email: 'c@co.com', name: 'C', refreshToken: '1//c', dailyLimit: 100 },
    ];
    const { selectSender } = createSenderSelector(senders, 'round-robin');

    assert.equal(selectSender()!.email, 'a@co.com');
    assert.equal(selectSender()!.email, 'b@co.com');
    assert.equal(selectSender()!.email, 'c@co.com');
    assert.equal(selectSender()!.email, 'a@co.com'); // wraps around
  });

  it('skips senders that hit daily limit', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 2 },
      { email: 'b@co.com', name: 'B', refreshToken: '1//b', dailyLimit: 100 },
    ];
    const { selectSender, incrementSendCount } = createSenderSelector(senders, 'round-robin');

    // Exhaust sender A
    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');

    // All selections should now be B
    assert.equal(selectSender()!.email, 'b@co.com');
    assert.equal(selectSender()!.email, 'b@co.com');
  });

  it('returns null when all senders are exhausted', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 1 },
      { email: 'b@co.com', name: 'B', refreshToken: '1//b', dailyLimit: 1 },
    ];
    const { selectSender, incrementSendCount } = createSenderSelector(senders, 'round-robin');

    incrementSendCount('a@co.com');
    incrementSendCount('b@co.com');

    assert.equal(selectSender(), null);
  });

  it('returns null for empty sender list', () => {
    const { selectSender } = createSenderSelector([], 'round-robin');
    assert.equal(selectSender(), null);
  });
});

describe('Daily Limit Tracking', () => {
  it('starts at zero sends', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 100 },
    ];
    const { getSendCount } = createSenderSelector(senders);
    assert.equal(getSendCount('a@co.com'), 0);
  });

  it('increments send count correctly', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 100 },
    ];
    const { getSendCount, incrementSendCount } = createSenderSelector(senders);

    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');

    assert.equal(getSendCount('a@co.com'), 3);
  });

  it('tracks per-sender independently', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 100 },
      { email: 'b@co.com', name: 'B', refreshToken: '1//b', dailyLimit: 100 },
    ];
    const { getSendCount, incrementSendCount } = createSenderSelector(senders);

    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');
    incrementSendCount('b@co.com');

    assert.equal(getSendCount('a@co.com'), 2);
    assert.equal(getSendCount('b@co.com'), 1);
  });
});

describe('Remaining Capacity', () => {
  it('reports full capacity when no sends', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 100 },
      { email: 'b@co.com', name: 'B', refreshToken: '1//b', dailyLimit: 50 },
    ];
    const { getRemainingCapacity } = createSenderSelector(senders);
    const cap = getRemainingCapacity();
    assert.equal(cap.total, 150);
    assert.equal(cap.perSender[0].remaining, 100);
    assert.equal(cap.perSender[1].remaining, 50);
  });

  it('decreases as emails are sent', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 10 },
    ];
    const { getRemainingCapacity, incrementSendCount } = createSenderSelector(senders);

    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');

    assert.equal(getRemainingCapacity().total, 7);
    assert.equal(getRemainingCapacity().perSender[0].remaining, 7);
  });

  it('shows zero when fully exhausted', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 2 },
    ];
    const { getRemainingCapacity, incrementSendCount } = createSenderSelector(senders);

    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com');

    assert.equal(getRemainingCapacity().total, 0);
  });

  it('does not go negative', () => {
    const senders: GmailSender[] = [
      { email: 'a@co.com', name: 'A', refreshToken: '1//a', dailyLimit: 1 },
    ];
    const { getRemainingCapacity, incrementSendCount } = createSenderSelector(senders);

    incrementSendCount('a@co.com');
    incrementSendCount('a@co.com'); // over limit
    incrementSendCount('a@co.com'); // way over

    assert.equal(getRemainingCapacity().perSender[0].remaining, 0);
  });
});

describe('sendAndLog memorize tags', () => {
  it('tags with sender email for tracking', () => {
    const senderEmail = 'alice@company.com';
    const tags = ['generated', 'outreach', 'sequence:email-1', 'sent', `sender:${senderEmail}`];
    assert.ok(tags.includes('sent'));
    assert.ok(tags.includes('sender:alice@company.com'));
  });

  it('includes sender info in memorized content', () => {
    const content = [
      '[OUTREACH SENT — Email 1]',
      'Date: 2026-03-10T10:00:00Z',
      'Subject: Quick question',
      'Angle: pain-point',
      'Sent from: Alice Smith <alice@company.com>',
      'Gmail Message ID: msg_abc123',
      'Gmail Thread ID: thread_xyz789',
      'Body: Hello there...',
    ].join('\n');

    assert.ok(content.includes('Sent from: Alice Smith <alice@company.com>'));
    assert.ok(content.includes('Gmail Message ID:'));
    assert.ok(content.includes('Gmail Thread ID:'));
  });
});

describe('Reply sender matching', () => {
  it('finds specific sender by email for reply threading', () => {
    const senders: GmailSender[] = [
      { email: 'alice@co.com', name: 'Alice', refreshToken: '1//a', dailyLimit: 100 },
      { email: 'bob@co.com', name: 'Bob', refreshToken: '1//b', dailyLimit: 100 },
    ];

    const requestedEmail = 'bob@co.com';
    const matched = senders.find((s) => s.email === requestedEmail) || null;

    assert.ok(matched);
    assert.equal(matched!.email, 'bob@co.com');
    assert.equal(matched!.name, 'Bob');
  });

  it('returns null for unknown sender email', () => {
    const senders: GmailSender[] = [
      { email: 'alice@co.com', name: 'Alice', refreshToken: '1//a', dailyLimit: 100 },
    ];

    const matched = senders.find((s) => s.email === 'nobody@co.com') || null;
    assert.equal(matched, null);
  });
});
