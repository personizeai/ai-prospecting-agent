import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLLMJson } from '../../lib/llm-output.js';
import { REPLY_ANALYSIS_SCHEMA, REPLY_ANALYSIS_DEFAULTS } from '../../lib/llm-schemas.js';
import { SAMPLE_REPLY_POSITIVE_JSON, SAMPLE_REPLY_NEGATIVE_JSON } from './mocks.js';

describe('Reply Analysis — Positive Sentiment', () => {
  it('parses a positive reply with all fields', () => {
    const { data, usedFallback, errors } = parseLLMJson(
      SAMPLE_REPLY_POSITIVE_JSON,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(usedFallback, false);
    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'positive');
    assert.equal(data.urgency, 'high');
    assert.ok(data.summary.includes('demo'));
    assert.ok(Array.isArray(data.key_points));
    assert.equal(data.key_points.length, 3);
    assert.ok(data.next_action.length > 0);
    assert.ok(data.suggested_response.length > 0);
  });
});

describe('Reply Analysis — Negative Sentiment', () => {
  it('parses a negative reply with removal request', () => {
    const { data, errors } = parseLLMJson(
      SAMPLE_REPLY_NEGATIVE_JSON,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'negative');
    assert.equal(data.urgency, 'low');
    assert.ok(data.summary.includes('Not interested'));
    assert.ok(data.key_points.some((p: string) => p.includes('remove')));
    assert.ok(data.next_action.includes('Remove'));
  });
});

describe('Reply Analysis — OOO Sentiment', () => {
  it('parses an out-of-office reply with return date', () => {
    const oooJson = JSON.stringify({
      sentiment: 'ooo',
      summary: 'Auto-reply: out of office until March 20',
      key_points: ['out of office', 'back March 20'],
      urgency: 'low',
      next_action: 'Reschedule follow-up after return date',
      suggested_response: 'N/A',
      return_date: '2026-03-20',
      referred_contact: 'N/A',
    });

    const { data, errors } = parseLLMJson(
      oooJson,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'ooo');
    assert.equal(data.return_date, '2026-03-20');
    assert.equal(data.urgency, 'low');

    // Return date should be a parseable date
    const returnTime = new Date(data.return_date).getTime();
    assert.ok(!isNaN(returnTime), 'return_date should be a valid date');
  });

  it('handles OOO without a specific return date', () => {
    const oooJson = JSON.stringify({
      sentiment: 'ooo',
      summary: 'Out of office, no return date specified',
      key_points: ['out of office'],
      urgency: 'low',
      next_action: 'Retry in 2 weeks',
      suggested_response: 'N/A',
      return_date: 'N/A',
      referred_contact: 'N/A',
    });

    const { data } = parseLLMJson(oooJson, REPLY_ANALYSIS_SCHEMA, REPLY_ANALYSIS_DEFAULTS);

    assert.equal(data.sentiment, 'ooo');
    assert.equal(data.return_date, 'N/A');
  });
});

describe('Reply Analysis — Referral Sentiment', () => {
  it('parses a referral reply with referred contact info', () => {
    const referralJson = JSON.stringify({
      sentiment: 'referral',
      summary: 'Not the right person, referred to Jane Smith in procurement',
      key_points: ['wrong contact', 'referred to Jane Smith', 'jane.smith@acme.com'],
      urgency: 'medium',
      next_action: 'Reach out to Jane Smith at jane.smith@acme.com',
      suggested_response: 'Thanks for pointing me in the right direction! I will reach out to Jane.',
      return_date: 'N/A',
      referred_contact: 'Jane Smith <jane.smith@acme.com>',
    });

    const { data, errors } = parseLLMJson(
      referralJson,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'referral');
    assert.ok(data.referred_contact.includes('Jane Smith'));
    assert.ok(data.referred_contact.includes('jane.smith@acme.com'));
    assert.ok(data.suggested_response.length > 0);
  });
});

describe('Reply Analysis — Question Sentiment', () => {
  it('parses a question reply asking for more info', () => {
    const questionJson = JSON.stringify({
      sentiment: 'question',
      summary: 'Asking about pricing and integration with Salesforce',
      key_points: ['wants pricing info', 'uses Salesforce', 'team of 20 reps'],
      urgency: 'high',
      next_action: 'Send pricing deck and Salesforce integration docs',
      suggested_response: 'Great questions! We integrate natively with Salesforce. I will send over our pricing and a quick integration overview.',
      return_date: 'N/A',
      referred_contact: 'N/A',
    });

    const { data, errors } = parseLLMJson(
      questionJson,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'question');
    assert.equal(data.urgency, 'high');
    assert.ok(data.key_points.length >= 2);
    assert.ok(data.suggested_response.includes('Salesforce'));
  });
});

describe('Reply Analysis — Neutral Sentiment (Default Fallback)', () => {
  it('parses a neutral/ambiguous reply', () => {
    const neutralJson = JSON.stringify({
      sentiment: 'neutral',
      summary: 'Acknowledged receipt but gave no clear signal',
      key_points: ['received the email', 'no commitment'],
      urgency: 'medium',
      next_action: 'Follow up in 5 days with more context',
      suggested_response: 'Thanks for getting back to me! Happy to share more details whenever it makes sense.',
      return_date: 'N/A',
      referred_contact: 'N/A',
    });

    const { data, errors } = parseLLMJson(
      neutralJson,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(errors.length, 0);
    assert.equal(data.sentiment, 'neutral');
    assert.equal(data.urgency, 'medium');
  });

  it('defaults to neutral when sentiment is missing entirely', () => {
    const incompleteJson = JSON.stringify({
      summary: 'Got a reply',
      key_points: [],
      urgency: 'low',
      next_action: 'Review',
    });

    const { data } = parseLLMJson(
      incompleteJson,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.equal(data.sentiment, 'neutral', 'Should fall back to default neutral sentiment');
  });

  it('defaults to neutral when sentiment is an invalid enum value', () => {
    const badSentiment = JSON.stringify({
      sentiment: 'confused',
      summary: 'Unclear reply',
      key_points: [],
      urgency: 'medium',
      next_action: 'Review',
      return_date: 'N/A',
      referred_contact: 'N/A',
    });

    const { data, errors } = parseLLMJson(
      badSentiment,
      REPLY_ANALYSIS_SCHEMA,
      REPLY_ANALYSIS_DEFAULTS,
    );

    assert.ok(errors.some((e) => e.includes('sentiment')), 'Should report invalid sentiment');
    assert.equal(data.sentiment, 'neutral', 'Should fall back to default');
  });
});

describe('Reply Analysis — All Six Sentiment Paths', () => {
  const sentiments = ['positive', 'question', 'negative', 'ooo', 'referral', 'neutral'] as const;

  for (const sentiment of sentiments) {
    it(`accepts "${sentiment}" as a valid sentiment value`, () => {
      const json = JSON.stringify({
        sentiment,
        summary: `Testing ${sentiment} path`,
        key_points: ['test'],
        urgency: 'medium',
        next_action: 'Test action',
        return_date: 'N/A',
        referred_contact: 'N/A',
      });

      const { data, errors } = parseLLMJson(
        json,
        REPLY_ANALYSIS_SCHEMA,
        REPLY_ANALYSIS_DEFAULTS,
      );

      const sentimentErrors = errors.filter((e) => e.includes('sentiment'));
      assert.equal(sentimentErrors.length, 0, `"${sentiment}" should be accepted`);
      assert.equal(data.sentiment, sentiment);
    });
  }
});
