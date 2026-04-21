import { schedules } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { reportFailure } from './error-handler.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ trigger: 'learning-loop' });

/**
 * Weekly Learning Loop — Analyzes outreach outcomes and suggests playbook changes.
 *
 * Flow:
 *   1. Query outreach-log for recent sends + replies (last 14 days)
 *   2. AI groups by angle → computes reply rates → identifies patterns
 *   3. Suggests governance updates (with evidence)
 *   4. Posts to Slack + memorizes for Claude to read
 *
 * Does NOT auto-apply changes — surfaces suggestions for human approval.
 */
export const learningLoopTask = schedules.task({
  id: "learning-loop",
  cron: "0 9 * * 1", // Monday 9am UTC
  retry: { maxAttempts: 2 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("learning-loop", ctx.run.id, error);
  },
  run: async () => {
    log.info('Running weekly learning loop');

    // 1. Gather recent outreach data
    const [sends, replies] = await Promise.all([
      client.memory.recall({
        message: 'OUTREACH SENT emails with angles and subjects from the last 14 days outreach-log',
        limit: 200,
      }),
      client.memory.recall({
        message: 'REPLY received with sentiment and angle attribution from the last 14 days outreach-log reply',
        limit: 100,
      }),
    ]);

    const sendCount = sends.data?.results?.length ?? sends.data?.length ?? 0;
    const replyCount = replies.data?.results?.length ?? replies.data?.length ?? 0;

    if (sendCount < 10) {
      log.info('Not enough data for learning loop', { sends: sendCount });
      return { status: 'insufficient_data', sends: sendCount };
    }

    // 2. AI analysis
    const sendsData = JSON.stringify(sends.data?.results ?? sends.data ?? []);
    const repliesData = JSON.stringify(replies.data?.results ?? replies.data ?? []);

    const analysis = await client.ai.prompt({
      context: `## OUTREACH SENDS (last 14 days)\n${sendsData}\n\n## REPLIES\n${repliesData}`,
      instructions: [{
        prompt: `Analyze outreach outcomes from the last 14 days.

You have ${sendCount} sends and ${replyCount} replies.

Produce a concise report:

1. **ANGLES BY PERFORMANCE** — group sends by angle, compute reply rate per angle. Rank best to worst. Only include angles with 5+ sends.

2. **SENDER OBSERVATIONS** — any patterns by sender? Different reply rates?

3. **TIMING PATTERNS** — any patterns in when replies come?

4. **SUGGESTED CHANGES** — 1-3 specific, actionable changes to the outreach playbook. Only suggest changes with clear statistical evidence (minimum 10 data points). Format each as:
   - What to change
   - Evidence (numbers)
   - Expected impact

Keep the report under 300 words. Be direct — this goes to a busy sales leader.`,
        maxSteps: 3,
      }],
      outputs: [{ name: 'report' }],
    });

    const report = String(analysis.data?.outputs?.report || analysis.data || 'No analysis generated');

    // 3. Post to Slack
    const slackMessage = [
      `📊 *Weekly Learning Loop — ${new Date().toISOString().split('T')[0]}*`,
      '',
      `Data: ${sendCount} sends, ${replyCount} replies`,
      '',
      report,
    ].join('\n');

    await notifySlack(slackMessage);

    // 4. Memorize for Claude
    await client.memory.memorize({
      content: `[LEARNING LOOP ${new Date().toISOString().split('T')[0]}]\n${report}`,
      collectionName: 'system-logs',
      tags: ['learning-loop', 'weekly'],
      enhanced: false,
    });

    log.info('Learning loop complete', { sends: sendCount, replies: replyCount });

    return {
      status: 'complete',
      sends: sendCount,
      replies: replyCount,
      report,
    };
  },
});
