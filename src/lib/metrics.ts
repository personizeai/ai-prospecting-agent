import { client } from '../config.js';
import { getRemainingCapacity } from '../delivery/gmail.js';
import { GMAIL_CONFIG } from '../config/prospecting.config.js';

export interface DailyMetrics {
  timestamp: string;
  outreach: {
    emailsSent: number;
    byStep: Record<string, number>;
    sequencesCompleted: number;
    optedOut: number;
  };
  replies: {
    total: number;
    bySentiment: Record<string, number>;
  };
  pipeline: {
    signalsDetected: number;
    contactsEnriched: number;
    companiesResearched: number;
  };
  capacity: {
    gmailRemaining: number;
    gmailTotal: number;
  };
  needsAttention: Array<{ type: string; description: string; priority: string }>;
}

export async function collectDailyMetrics(): Promise<DailyMetrics> {
  const needsAttention: DailyMetrics['needsAttention'] = [];

  // ─── Outreach Metrics ──────────────────────────────────────────────
  const outreachMemory = await client.memory.recall({
    message: 'outreach sent today',
    limit: 100,
  });

  let emailsSent = 0;
  const byStep: Record<string, number> = {};
  let sequencesCompleted = 0;
  let optedOut = 0;

  for (const entry of outreachMemory.data?.results ?? []) {
    const text = entry.memory ?? '';

    if (text.includes('[OUTREACH SENT]')) {
      emailsSent++;
      const stepMatch = text.match(/step[:\s]*(\w+[\s\w]*\d*)/i);
      const stepKey = stepMatch ? stepMatch[1].trim() : 'unknown';
      byStep[stepKey] = (byStep[stepKey] || 0) + 1;
    }

    if (text.includes('[SEQUENCE COMPLETED]')) {
      sequencesCompleted++;
    }

    if (text.includes('[OPT-OUT]') || text.includes('[OPTED OUT]')) {
      optedOut++;
    }
  }

  // ─── Reply Metrics ─────────────────────────────────────────────────
  const replyMemory = await client.memory.recall({
    message: 'reply received today',
    limit: 50,
  });

  let totalReplies = 0;
  const bySentiment: Record<string, number> = {};

  for (const entry of replyMemory.data?.results ?? []) {
    const text = entry.memory ?? '';

    if (text.includes('[REPLY')) {
      totalReplies++;

      const sentimentMatch = text.match(/sentiment[:\s]*(\w+)/i);
      const sentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : 'unknown';
      bySentiment[sentiment] = (bySentiment[sentiment] || 0) + 1;
    }
  }

  // Flag replies needing follow-up
  const positiveCount = bySentiment['positive'] || 0;
  const questionCount = bySentiment['question'] || 0;

  if (positiveCount > 0) {
    needsAttention.push({
      type: 'positive_reply',
      description: `${positiveCount} positive repl${positiveCount === 1 ? 'y' : 'ies'} awaiting follow-up`,
      priority: 'high',
    });
  }

  if (questionCount > 0) {
    needsAttention.push({
      type: 'question_reply',
      description: `${questionCount} question repl${questionCount === 1 ? 'y' : 'ies'} need${questionCount === 1 ? 's' : ''} response`,
      priority: 'medium',
    });
  }

  // ─── Pipeline Metrics ──────────────────────────────────────────────
  const signalMemory = await client.memory.recall({
    message: 'signal detected today',
    limit: 100,
  });
  const signalsDetected = (signalMemory.data?.results ?? []).filter(
    (e: any) => (e.memory ?? '').includes('[SIGNAL')
  ).length;

  const enrichmentMemory = await client.memory.recall({
    message: 'contact enriched today',
    limit: 100,
  });
  const contactsEnriched = (enrichmentMemory.data?.results ?? []).filter(
    (e: any) => (e.memory ?? '').includes('[ENRICHED')
  ).length;

  const researchMemory = await client.memory.recall({
    message: 'company researched today',
    limit: 100,
  });
  const companiesResearched = (researchMemory.data?.results ?? []).filter(
    (e: any) => (e.memory ?? '').includes('[RESEARCH')
  ).length;

  // ─── Gmail Capacity ────────────────────────────────────────────────
  const capacity = getRemainingCapacity();
  const totalLimit = GMAIL_CONFIG.senders.reduce((sum, s) => sum + s.dailyLimit, 0);

  return {
    timestamp: new Date().toISOString(),
    outreach: { emailsSent, byStep, sequencesCompleted, optedOut },
    replies: { total: totalReplies, bySentiment },
    pipeline: { signalsDetected, contactsEnriched, companiesResearched },
    capacity: { gmailRemaining: capacity.total, gmailTotal: totalLimit },
    needsAttention,
  };
}
