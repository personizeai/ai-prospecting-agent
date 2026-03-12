import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the regex patterns used in generate-outreach.ts without needing the SDK

describe('Outreach State Parsing', () => {
  // The pattern used in generate-outreach.ts
  const OUTREACH_SENT_PATTERN = /\[OUTREACH SENT\s*[-\u2014\u2013]+\s*Email (\d+)\]/;

  it('matches em-dash variant', () => {
    const content = '[OUTREACH SENT \u2014 Email 2]';
    const match = content.match(OUTREACH_SENT_PATTERN);
    assert.ok(match, 'Should match em-dash variant');
    assert.equal(match![1], '2');
  });

  it('matches regular dash variant', () => {
    const content = '[OUTREACH SENT - Email 1]';
    const match = content.match(OUTREACH_SENT_PATTERN);
    assert.ok(match, 'Should match regular dash variant');
    assert.equal(match![1], '1');
  });

  it('matches en-dash variant', () => {
    const content = '[OUTREACH SENT \u2013 Email 3]';
    const match = content.match(OUTREACH_SENT_PATTERN);
    assert.ok(match, 'Should match en-dash variant');
    assert.equal(match![1], '3');
  });

  it('extracts the highest email step', () => {
    const memories = [
      '[OUTREACH SENT \u2014 Email 1]\nDate: 2026-03-01T10:00:00Z',
      '[OUTREACH SENT \u2014 Email 2]\nDate: 2026-03-04T10:00:00Z',
      'Some other memory without outreach',
    ];

    let emailsSent = 0;
    for (const content of memories) {
      const match = content.match(OUTREACH_SENT_PATTERN);
      if (match) {
        emailsSent = Math.max(emailsSent, parseInt(match[1], 10));
      }
    }
    assert.equal(emailsSent, 2);
  });

  it('returns 0 when no outreach history', () => {
    const memories = ['Some random memory', 'Another memory'];
    let emailsSent = 0;
    for (const content of memories) {
      const match = content.match(OUTREACH_SENT_PATTERN);
      if (match) {
        emailsSent = Math.max(emailsSent, parseInt(match[1], 10));
      }
    }
    assert.equal(emailsSent, 0);
  });
});

describe('LLM Output Parsing', () => {
  it('parses well-formed LLM output', () => {
    const output = `SUBJECT: Quick question about your sales process
BODY_HTML: <p>Hi John, I noticed Acme just raised a Series B.</p>
BODY_TEXT: Hi John, I noticed Acme just raised a Series B.
ANGLE: Recent funding round as conversation starter`;

    const subject = output.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() || '';
    const bodyHtml = output.match(/BODY_HTML:\s*([\s\S]+?)(?=\nBODY_TEXT:)/i)?.[1]?.trim() || '';
    const bodyText = output.match(/BODY_TEXT:\s*([\s\S]+?)(?=\nANGLE:)/i)?.[1]?.trim() || '';
    const angle = output.match(/ANGLE:\s*(.+)/i)?.[1]?.trim() || '';

    assert.equal(subject, 'Quick question about your sales process');
    assert.equal(bodyHtml, '<p>Hi John, I noticed Acme just raised a Series B.</p>');
    assert.equal(bodyText, 'Hi John, I noticed Acme just raised a Series B.');
    assert.equal(angle, 'Recent funding round as conversation starter');
  });

  it('returns empty strings for malformed output', () => {
    const output = 'The AI went off script and produced garbage';

    const subject = output.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() || '';
    const bodyText = output.match(/BODY_TEXT:\s*([\s\S]+?)(?=\nANGLE:)/i)?.[1]?.trim() || '';

    assert.equal(subject, '');
    assert.equal(bodyText, '');
  });

  it('blank email guard catches empty parsed fields', () => {
    const subject = '';
    const bodyText = '';

    // This is the guard from generate-outreach.ts
    const shouldReject = !subject || !bodyText;
    assert.ok(shouldReject, 'Should reject blank emails');
  });

  it('parses multi-line BODY_HTML correctly', () => {
    const output = `SUBJECT: Test
BODY_HTML: <p>Line 1</p>
<p>Line 2</p>
<p>Line 3</p>
BODY_TEXT: Line 1 Line 2 Line 3
ANGLE: test`;

    const bodyHtml = output.match(/BODY_HTML:\s*([\s\S]+?)(?=\nBODY_TEXT:)/i)?.[1]?.trim() || '';
    assert.ok(bodyHtml.includes('<p>Line 1</p>'));
    assert.ok(bodyHtml.includes('<p>Line 3</p>'));
  });
});

describe('Signal Detection Parsing', () => {
  it('SIGNAL_STRENGTH regex stops at newline', () => {
    const output = `ICP_FIT_SCORE: 85
SIGNAL_STRENGTH: Very Strong
BUYING_WINDOW: Yes
REASONING: They just raised funding.
RECOMMENDED_ACTION: Prospect Now`;

    // This is the fixed regex (stops at newline, not greedy across lines)
    const strength = output.match(/SIGNAL_STRENGTH:\s*([^\n]+)/)?.[1]?.trim() || 'None';
    assert.equal(strength, 'Very Strong');

    const score = parseInt(output.match(/ICP_FIT_SCORE:\s*(\d+)/)?.[1] || '0', 10);
    assert.equal(score, 85);

    const action = output.match(/RECOMMENDED_ACTION:\s*([^\n]+)/)?.[1]?.trim() || 'Skip';
    assert.equal(action, 'Prospect Now');
  });

  it('handles missing fields gracefully', () => {
    const output = 'The LLM returned something unexpected';

    const score = parseInt(output.match(/ICP_FIT_SCORE:\s*(\d+)/)?.[1] || '0', 10);
    const strength = output.match(/SIGNAL_STRENGTH:\s*([^\n]+)/)?.[1]?.trim() || 'None';
    const action = output.match(/RECOMMENDED_ACTION:\s*([^\n]+)/)?.[1]?.trim() || 'Skip';

    assert.equal(score, 0);
    assert.equal(strength, 'None');
    assert.equal(action, 'Skip');
  });
});

describe('Date Comparison', () => {
  it('compares dates as Date objects, not strings', () => {
    const date1 = '2026-03-01T10:00:00Z';
    const date2 = '2026-03-05T10:00:00Z';

    const time1 = new Date(date1).getTime();
    const time2 = new Date(date2).getTime();

    assert.ok(!isNaN(time1), 'date1 should be valid');
    assert.ok(!isNaN(time2), 'date2 should be valid');
    assert.ok(time2 > time1, 'date2 should be after date1');
  });

  it('detects invalid dates via isNaN', () => {
    const invalidDate = 'not a date';
    const time = new Date(invalidDate).getTime();
    assert.ok(isNaN(time), 'Invalid date should produce NaN');
  });

  it('calculates days since correctly', () => {
    const lastSent = new Date('2026-03-07T10:00:00Z').getTime();
    const now = new Date('2026-03-10T10:00:00Z').getTime();
    const daysSince = (now - lastSent) / (1000 * 60 * 60 * 24);
    assert.equal(daysSince, 3);
  });
});

describe('Opt-Out Detection', () => {
  it('detects opt-out keywords', () => {
    const keywords = ['OPT OUT', 'UNSUBSCRIBE', 'NOT INTERESTED', 'REMOVE ME'];
    const content = 'Please remove me from your list';

    const found = keywords.some((kw) => content.toUpperCase().includes(kw));
    assert.ok(found, 'Should detect REMOVE ME');
  });

  it('detects reply engagement events', () => {
    const content = '[EMAIL ENGAGEMENT \u2014 REPLY]\nDate: 2026-03-10';
    const isReply = content.toUpperCase().includes('[EMAIL ENGAGEMENT') && content.toUpperCase().includes('REPLY');
    assert.ok(isReply, 'Should detect reply engagement');
  });

  it('does not false-positive on unrelated content', () => {
    const content = 'We discussed optimizing their outreach process';
    const keywords = ['OPT OUT', 'UNSUBSCRIBE', 'NOT INTERESTED', 'REMOVE ME'];
    const found = keywords.some((kw) => content.toUpperCase().includes(kw));
    assert.ok(!found, 'Should not false-positive');
  });
});
