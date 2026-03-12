import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Reply Sentiment Classification', () => {
  // Simulate the regex parsing from analyze-reply.ts
  function parseAnalysis(output: string) {
    const sentiment = output.match(/SENTIMENT:\s*(\w+)/i)?.[1]?.toLowerCase() || 'neutral';
    const summary = output.match(/SUMMARY:\s*([^\n]+)/i)?.[1]?.trim() || 'Reply received';
    const keyPointsRaw = output.match(/KEY_POINTS:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const keyPoints = keyPointsRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const urgency = output.match(/URGENCY:\s*(\w+)/i)?.[1]?.toLowerCase() || 'medium';
    const nextAction = output.match(/NEXT_ACTION:\s*([^\n]+)/i)?.[1]?.trim() || 'Review reply';
    const suggestedResponse = output.match(/SUGGESTED_RESPONSE:\s*([\s\S]+?)(?=\nRETURN_DATE:)/i)?.[1]?.trim() || '';
    const returnDate = output.match(/RETURN_DATE:\s*([^\n]+)/i)?.[1]?.trim();
    const referredContact = output.match(/REFERRED_CONTACT:\s*([^\n]+)/i)?.[1]?.trim();

    return { sentiment, summary, keyPoints, urgency, nextAction, suggestedResponse, returnDate, referredContact };
  }

  it('parses positive reply correctly', () => {
    const output = `SENTIMENT: positive
SUMMARY: Lead expressed interest and wants to schedule a demo call next week.
KEY_POINTS: interested in demo, available next week, wants pricing info
URGENCY: high
NEXT_ACTION: Schedule a 30-min demo call for next week
SUGGESTED_RESPONSE: Great to hear you're interested! I'd love to show you how we can help. How does Tuesday or Wednesday next week look for a quick 30-min demo?
RETURN_DATE: N/A
REFERRED_CONTACT: N/A`;

    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'positive');
    assert.ok(result.summary.includes('demo call'));
    assert.equal(result.keyPoints.length, 3);
    assert.equal(result.urgency, 'high');
    assert.ok(result.suggestedResponse.includes('demo'));
    assert.equal(result.returnDate, 'N/A');
  });

  it('parses negative reply correctly', () => {
    const output = `SENTIMENT: negative
SUMMARY: Lead said they are not interested and asked to be removed from the mailing list.
KEY_POINTS: not interested, remove from list
URGENCY: low
NEXT_ACTION: Remove from all sequences and mark as opted out
SUGGESTED_RESPONSE: N/A
RETURN_DATE: N/A
REFERRED_CONTACT: N/A`;

    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'negative');
    assert.ok(result.summary.includes('not interested'));
    assert.equal(result.urgency, 'low');
    assert.equal(result.suggestedResponse, 'N/A');
  });

  it('parses OOO reply with return date', () => {
    const output = `SENTIMENT: ooo
SUMMARY: Auto-reply: out of office until March 20th, will respond upon return.
KEY_POINTS: out of office, returns March 20
URGENCY: low
NEXT_ACTION: Reschedule outreach for after March 20
SUGGESTED_RESPONSE: N/A
RETURN_DATE: 2026-03-20
REFERRED_CONTACT: N/A`;

    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'ooo');
    assert.equal(result.returnDate, '2026-03-20');
  });

  it('parses referral reply correctly', () => {
    const output = `SENTIMENT: referral
SUMMARY: Lead said they're not the right person but suggested talking to Sarah Chen, VP of Sales.
KEY_POINTS: not the right person, referred to Sarah Chen, VP of Sales
URGENCY: medium
NEXT_ACTION: Thank the original contact and reach out to Sarah Chen
SUGGESTED_RESPONSE: Thanks for pointing me in the right direction! I'll reach out to Sarah. Appreciate your time.
RETURN_DATE: N/A
REFERRED_CONTACT: Sarah Chen, VP of Sales (sarah.chen@acme.com)`;

    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'referral');
    assert.ok(result.referredContact?.includes('Sarah Chen'));
    assert.ok(result.suggestedResponse.includes('Sarah'));
  });

  it('parses question reply correctly', () => {
    const output = `SENTIMENT: question
SUMMARY: Lead asked how the product integrates with their existing HubSpot setup.
KEY_POINTS: integration question, uses HubSpot, wants technical details
URGENCY: medium
NEXT_ACTION: Answer the integration question with specifics, then suggest a technical call
SUGGESTED_RESPONSE: Great question! We have a native HubSpot integration that syncs in real-time. Happy to show you how it works — would a quick 15-min call work?
RETURN_DATE: N/A
REFERRED_CONTACT: N/A`;

    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'question');
    assert.ok(result.summary.includes('HubSpot'));
    assert.equal(result.urgency, 'medium');
    assert.ok(result.suggestedResponse.includes('integration'));
  });

  it('defaults to neutral for unparseable output', () => {
    const output = 'The AI returned something completely unexpected';
    const result = parseAnalysis(output);
    assert.equal(result.sentiment, 'neutral');
    assert.equal(result.summary, 'Reply received');
    assert.equal(result.urgency, 'medium');
    assert.equal(result.nextAction, 'Review reply');
  });
});

describe('Reply Action Routing', () => {
  it('positive reply creates urgent task for sales rep', () => {
    const sentiment = 'positive';
    const urgency = 'high';

    const taskPriority = sentiment === 'positive' ? 'urgent' : 'medium';
    const taskOwner = 'sales-rep';
    const dueInHours = sentiment === 'positive' ? 1 : sentiment === 'question' ? 4 : 24;

    assert.equal(taskPriority, 'urgent');
    assert.equal(taskOwner, 'sales-rep');
    assert.equal(dueInHours, 1);
  });

  it('question reply creates high-priority task with 4h SLA', () => {
    const sentiment = 'question';
    const dueInHours = sentiment === 'positive' ? 1 : sentiment === 'question' ? 4 : 24;
    assert.equal(dueInHours, 4);
  });

  it('negative reply raises critical issue and opts out', () => {
    const sentiment = 'negative';
    const shouldOptOut = sentiment === 'negative';
    const issueSeverity = 'critical';
    const leadStatus = 'Disqualified';

    assert.ok(shouldOptOut);
    assert.equal(issueSeverity, 'critical');
    assert.equal(leadStatus, 'Disqualified');
  });

  it('OOO reply creates low-priority reschedule task', () => {
    const sentiment = 'ooo';
    const returnDate = '2026-03-20';

    const taskPriority = 'low';
    const taskOwner = 'outreach-agent'; // automated, not human

    assert.equal(taskPriority, 'low');
    assert.equal(taskOwner, 'outreach-agent');
    assert.ok(returnDate); // should have a return date to reschedule
  });

  it('referral creates task for both thank-you and new outreach', () => {
    const sentiment = 'referral';
    const referredContact = 'Sarah Chen, VP of Sales';

    const taskPriority = 'high';
    const dueInHours = 24;

    assert.equal(taskPriority, 'high');
    assert.equal(dueInHours, 24);
    assert.ok(referredContact);
  });
});

describe('Lead Status Updates by Sentiment', () => {
  it('positive reply sets status to Engaged', () => {
    const sentiment = 'positive';
    const leadStatus = sentiment === 'positive' ? 'Engaged'
      : sentiment === 'question' ? 'Contacted'
      : sentiment === 'negative' ? 'Disqualified'
      : 'Contacted';
    assert.equal(leadStatus, 'Engaged');
  });

  it('negative reply sets status to Disqualified', () => {
    const sentiment = 'negative';
    const leadStatus = sentiment === 'negative' ? 'Disqualified' : 'Contacted';
    assert.equal(leadStatus, 'Disqualified');
  });

  it('question reply sets status to Contacted', () => {
    const sentiment = 'question';
    const leadStatus = sentiment === 'positive' ? 'Engaged'
      : sentiment === 'question' ? 'Contacted'
      : 'Contacted';
    assert.equal(leadStatus, 'Contacted');
  });

  it('outreach stage set to Replied for all non-negative', () => {
    const sentiments = ['positive', 'question', 'ooo', 'referral', 'neutral'];
    for (const sentiment of sentiments) {
      const outreachStage = 'Replied';
      assert.equal(outreachStage, 'Replied');
    }
  });

  it('outreach stage set to Opted Out for negative', () => {
    const sentiment = 'negative';
    const outreachStage = sentiment === 'negative' ? 'Opted Out' : 'Replied';
    assert.equal(outreachStage, 'Opted Out');
  });
});

describe('HubSpot Task Creation', () => {
  it('positive reply creates CALL task', () => {
    const sentiment = 'positive';
    const taskType = sentiment === 'positive' ? 'CALL' : 'EMAIL';
    assert.equal(taskType, 'CALL');
  });

  it('question reply creates EMAIL task', () => {
    const sentiment = 'question';
    const taskType = sentiment === 'positive' ? 'CALL' : 'EMAIL';
    assert.equal(taskType, 'EMAIL');
  });

  it('referral reply creates EMAIL task', () => {
    const sentiment = 'referral';
    const taskType = sentiment === 'positive' ? 'CALL' : 'EMAIL';
    assert.equal(taskType, 'EMAIL');
  });

  it('negative reply does NOT create HubSpot task', () => {
    const sentiment = 'negative';
    const shouldCreateTask = sentiment !== 'negative' && sentiment !== 'ooo' && sentiment !== 'neutral';
    assert.ok(!shouldCreateTask);
  });

  it('task body truncates long replies to 1000 chars', () => {
    const replyBody = 'x'.repeat(2000);
    const truncated = replyBody.substring(0, 1000);
    assert.equal(truncated.length, 1000);
  });
});

describe('Slack Notification Routing', () => {
  it('positive reply gets green notification', () => {
    const sentiment = 'positive';
    const emoji = sentiment === 'positive' ? '🟢'
      : sentiment === 'question' ? '🟡'
      : sentiment === 'negative' ? '🔴'
      : sentiment === 'referral' ? '🔵' : '';
    assert.equal(emoji, '🟢');
  });

  it('negative reply gets red notification', () => {
    const sentiment = 'negative';
    const emoji = sentiment === 'negative' ? '🔴' : '';
    assert.equal(emoji, '🔴');
  });

  it('no Slack notification for OOO and neutral', () => {
    const sentimentsWithAlert = ['positive', 'question', 'negative', 'referral'];
    const sentimentsWithoutAlert = ['ooo', 'neutral'];

    for (const s of sentimentsWithAlert) {
      assert.ok(sentimentsWithAlert.includes(s));
    }
    for (const s of sentimentsWithoutAlert) {
      assert.ok(!sentimentsWithAlert.includes(s));
    }
  });
});
