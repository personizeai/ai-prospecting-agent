import { client, aiOptions } from '../config.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ pipeline: 'weekly-report' });

const MAX_CONTEXT_CHARS = 30_000; // ~7,500 tokens — keeps within LLM context budget

export async function generateWeeklyReport(): Promise<string> {
  const [recentOutreach, engagements] = await Promise.all([
    client.memory.search({
      type: 'Contact',
      query: 'outreach sent last 7 days',
      limit: 100,
    }),
    client.memory.recall({
      message: 'email engagement opens clicks replies bounces last 7 days',
      limit: 100,
    }),
  ]);

  const outreachContent = recentOutreach.data?.map((r: any) => r.content).join('\n') || '';
  const engagementContent = engagements.data?.map((r: any) => r.content).join('\n') || '';

  // Truncate to prevent token overflow
  const context = [
    `OUTREACH ACTIVITY (last 7 days): ${recentOutreach.data?.length || 0} records`,
    outreachContent.substring(0, MAX_CONTEXT_CHARS / 2),
    `ENGAGEMENT DATA: ${engagements.data?.length || 0} events`,
    engagementContent.substring(0, MAX_CONTEXT_CHARS / 2),
  ].join('\n\n');

  try {
    const report = await client.ai.prompt({
      ...aiOptions,
      context,
      instructions: [
        {
          prompt: `Generate a weekly prospecting performance report. Include:
SUMMARY: [2-3 sentence overview]
EMAILS_SENT: [count]
OPEN_RATE: [percentage or "insufficient data"]
REPLY_RATE: [percentage or "insufficient data"]
TOP_PERFORMING_ANGLES: [which personalization approaches got the best engagement]
HOT_PROSPECTS: [contacts showing the most engagement]
RECOMMENDATIONS: [2-3 specific improvements for next week]`,
          maxSteps: 3,
        },
      ],
    });

    return String(report.data || 'Report generation returned empty.');
  } catch (err) {
    log.error('Weekly report generation failed', { error: err instanceof Error ? err.message : String(err) });
    return `Report generation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
