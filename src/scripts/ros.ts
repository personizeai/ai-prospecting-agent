#!/usr/bin/env npx tsx
/**
 * Revenue OS CLI — Simple commands for campaign management.
 *
 * Usage:
 *   npx tsx src/scripts/ros.ts campaign:create --name "Fintech Q2" --market "US Fintech" --cadence standard
 *   npx tsx src/scripts/ros.ts campaign:list
 *   npx tsx src/scripts/ros.ts campaign:stats fintech-q2
 *   npx tsx src/scripts/ros.ts campaign:pause fintech-q2
 *   npx tsx src/scripts/ros.ts campaign:enroll fintech-q2 --emails a@x.com,b@y.com
 *   npx tsx src/scripts/ros.ts sender:list
 *   npx tsx src/scripts/ros.ts status
 *
 * Or via npm script (add to package.json):
 *   "ros": "npx tsx src/scripts/ros.ts"
 *   npm run ros -- campaign:list
 */

import 'dotenv/config';
import { client } from '../config.js';
import { memory } from '../lib/memory.js';
import { campaigns, type CampaignConfig } from '../lib/campaign.js';
import { senderProfiles } from '../lib/sender-profiles.js';
import { collectDailyMetrics } from '../lib/metrics.js';
import { memoryCrud } from '../lib/personize-crud.js';
import { logger } from '../lib/logger.js';

const [,, command, ...args] = process.argv;

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      parsed[key] = val;
    } else if (!parsed._positional) {
      parsed._positional = args[i];
    }
  }
  return parsed;
}

function generateCampaignId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─── Commands ───────────────────────────────────────────────────────

async function campaignCreate(args: Record<string, string>) {
  const name = args.name;
  if (!name) {
    console.error('Usage: ros campaign:create --name "Campaign Name" [--market "..."] [--cadence standard] [--daily-cap 30] [--sender sp_xxx] [--max-emails 3]');
    process.exit(1);
  }

  const campaignId = args.id || generateCampaignId(name);

  await memory.save({
    email: campaignId,
    collectionName: 'campaigns',
    content: `Campaign "${name}" created`,
    properties: {
      campaign_id: { value: campaignId, extractMemories: false },
      name: { value: name, extractMemories: false },
      status: { value: 'Draft', extractMemories: false },
      market: { value: args.market || '', extractMemories: false },
      agent_mode: { value: args.mode || 'outbound-sdr', extractMemories: false },
      icp_criteria: { value: args.icp || '', extractMemories: false },
      sender_profile_ids: { value: args.sender ? [args.sender] : [], extractMemories: false },
      daily_send_cap: { value: Number(args['daily-cap']) || 0, extractMemories: false },
      cadence: { value: args.cadence || 'standard', extractMemories: false },
      max_emails: { value: Number(args['max-emails']) || 3, extractMemories: false },
      governance_overrides: { value: args.governance ? args.governance.split(',') : [], extractMemories: false },
      contacts_enrolled: { value: 0, extractMemories: false },
      contacts_reached: { value: 0, extractMemories: false },
      emails_sent: { value: 0, extractMemories: false },
      replies: { value: 0, extractMemories: false },
      positive_replies: { value: 0, extractMemories: false },
      meetings_booked: { value: 0, extractMemories: false },
      bounced: { value: 0, extractMemories: false },
      opted_out: { value: 0, extractMemories: false },
      emails_sent_today: { value: 0, extractMemories: false },
      created_at: { value: new Date().toISOString(), extractMemories: false },
    },
    tags: ['campaign', campaignId],
  });

  console.log(`\n✓ Campaign created: "${name}" (${campaignId})`);
  console.log(`  Status: Draft (set to Active when ready)`);
  console.log(`  Cadence: ${args.cadence || 'standard'}`);
  console.log(`  Daily cap: ${args['daily-cap'] || 'unlimited'}`);
  if (args.sender) console.log(`  Sender: ${args.sender}`);
  console.log(`\nTo activate: npx tsx src/scripts/ros.ts campaign:activate ${campaignId}`);
}

async function campaignList() {
  const allCampaigns = await memoryCrud.filterByProperty({
    type: 'Campaign',
    conditions: [{ propertyName: 'campaign_id', operator: 'exists' }],
    limit: 50,
  });

  if (allCampaigns.records.length === 0) {
    console.log('\nNo campaigns found. Create one with: ros campaign:create --name "My Campaign"');
    return;
  }

  console.log('\n┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ Campaigns                                                       │');
  console.log('├─────────────────────────────────────────────────────────────────┤');

  for (const record of allCampaigns.records) {
    const p = record.matchedProperties || {};
    const enrolled = Number(p.contacts_enrolled) || 0;
    const reached = Number(p.contacts_reached) || 0;
    const replies = Number(p.replies) || 0;
    const positive = Number(p.positive_replies) || 0;
    const replyRate = reached > 0 ? Math.round((replies / reached) * 100) : 0;

    const statusIcon = p.status === 'Active' ? '🟢' : p.status === 'Paused' ? '🟡' : '⚪';

    console.log(`│ ${statusIcon} ${String(p.name || '').padEnd(20)} ${String(p.campaign_id || '').padEnd(20)} ${String(p.status || '').padEnd(10)} │`);
    console.log(`│   ${enrolled} enrolled, ${reached} reached, ${replies} replies (${replyRate}%), ${positive} positive │`);
  }
  console.log('└─────────────────────────────────────────────────────────────────┘');
}

async function campaignStats(campaignId: string) {
  if (!campaignId) {
    console.error('Usage: ros campaign:stats <campaign-id>');
    process.exit(1);
  }

  const config = await campaigns.getConfig(campaignId);
  if (!config) {
    console.error(`Campaign "${campaignId}" not found`);
    process.exit(1);
  }

  const stats = await campaigns.getStats(campaignId);
  const replyRate = stats.contacts_reached > 0 ? Math.round((stats.replies / stats.contacts_reached) * 100) : 0;
  const positiveRate = stats.contacts_reached > 0 ? Math.round((stats.positive_replies / stats.contacts_reached) * 100) : 0;
  const bounceRate = stats.emails_sent > 0 ? Math.round((stats.bounced / stats.emails_sent) * 100) : 0;

  console.log(`\n${config.name} (${campaignId})`);
  console.log(`Status: ${config.status} | Market: ${config.market || 'not set'} | Cadence: ${config.cadence}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Enrolled:       ${stats.contacts_enrolled}`);
  console.log(`Reached:        ${stats.contacts_reached}`);
  console.log(`Emails sent:    ${stats.emails_sent} (${stats.emails_sent_today} today)`);
  console.log(`Replies:        ${stats.replies} (${replyRate}%)`);
  console.log(`Positive:       ${stats.positive_replies} (${positiveRate}%)`);
  console.log(`Meetings:       ${stats.meetings_booked}`);
  console.log(`Bounced:        ${stats.bounced} (${bounceRate}%)`);
  console.log(`Opted out:      ${stats.opted_out}`);
  if (config.dailySendCap > 0) {
    console.log(`Daily cap:      ${stats.emails_sent_today}/${config.dailySendCap}`);
  }
}

async function campaignActivate(campaignId: string) {
  if (!campaignId) { console.error('Usage: ros campaign:activate <campaign-id>'); process.exit(1); }

  await memoryCrud.update({
    recordId: campaignId,
    type: 'Campaign',
    propertyName: 'status',
    propertyValue: 'Active',
    updatedBy: 'cli',
  });
  await memoryCrud.update({
    recordId: campaignId,
    type: 'Campaign',
    propertyName: 'started_at',
    propertyValue: new Date().toISOString(),
    updatedBy: 'cli',
  });

  console.log(`\n✓ Campaign "${campaignId}" is now Active`);
  console.log(`  Outreach engine will pick up contacts in the next scheduler cycle.`);

  const dryRun = process.env.DRY_RUN !== 'false';
  if (dryRun) {
    console.log(`\n⚠️  DRY_RUN is enabled — emails will be generated but NOT sent.`);
    console.log(`  Set DRY_RUN=false in .env when ready to send.`);
  }
}

async function campaignPause(campaignId: string) {
  if (!campaignId) { console.error('Usage: ros campaign:pause <campaign-id>'); process.exit(1); }

  await memoryCrud.update({
    recordId: campaignId,
    type: 'Campaign',
    propertyName: 'status',
    propertyValue: 'Paused',
    updatedBy: 'cli',
  });
  await memoryCrud.update({
    recordId: campaignId,
    type: 'Campaign',
    propertyName: 'paused_at',
    propertyValue: new Date().toISOString(),
    updatedBy: 'cli',
  });

  console.log(`\n✓ Campaign "${campaignId}" paused. No new outreach will be sent.`);
  console.log(`  In-flight sequences will complete their current email but won't send the next.`);
}

async function campaignEnroll(campaignId: string, args: Record<string, string>) {
  if (!campaignId) {
    console.error('Usage: ros campaign:enroll <campaign-id> --emails a@x.com,b@y.com');
    console.error('       ros campaign:enroll <campaign-id> --filter \'{"icp_match": true}\'');
    process.exit(1);
  }

  if (args.emails) {
    const emails = args.emails.split(',').map(e => e.trim());
    let enrolled = 0;
    let skipped = 0;

    for (const email of emails) {
      const result = await campaigns.enroll(email, campaignId);
      if (result.enrolled) {
        enrolled++;
        console.log(`  ✓ ${email} → sender: ${result.senderId || 'none'}`);
      } else {
        skipped++;
        console.log(`  ✗ ${email} — ${result.reason}`);
      }
    }

    console.log(`\n${enrolled} enrolled, ${skipped} skipped`);
  } else {
    console.error('Provide --emails (comma-separated) to enroll specific contacts.');
  }
}

async function senderList() {
  const profiles = await senderProfiles.list();

  if (profiles.length === 0) {
    console.log('\nNo sender profiles found. Create one with setup:senders.');
    return;
  }

  console.log('\n┌───────────────────────────────────────────────────────────┐');
  console.log('│ Sender Profiles                                           │');
  console.log('├───────────────────────────────────────────────────────────┤');

  for (const p of profiles) {
    const statusIcon = p.active ? '🟢' : '🔴';
    const warmupLabel = p.isWarmingUp ? ` (warmup day ${p.warmupDay})` : '';
    const remaining = senderProfiles.getRemainingCapacity(p);
    const limit = senderProfiles.getEffectiveDailyLimit(p);

    console.log(`│ ${statusIcon} ${p.name.padEnd(20)} ${p.id.padEnd(18)} ${p.persona.padEnd(12)} │`);
    console.log(`│   Health: ${p.healthScore}/100 | Today: ${p.sentToday}/${limit} (${remaining} remaining)${warmupLabel} │`);
    console.log(`│   Lifetime: ${p.totalSent} sent, ${p.totalBounces} bounced, ${p.totalReplies} replies │`);
    if (p.pauseReason) console.log(`│   ⚠️  ${p.pauseReason} │`);
  }
  console.log('└───────────────────────────────────────────────────────────┘');
}

async function status() {
  console.log('\nRevenue OS — Status\n');

  // Metrics
  try {
    const metrics = await collectDailyMetrics();
    console.log('Outreach Today:');
    console.log(`  Emails sent: ${metrics.outreach.emailsSent}`);
    console.log(`  Replies: ${metrics.replies.total}`);
    console.log(`  Sequences completed: ${metrics.outreach.sequencesCompleted}`);
    console.log(`  Opted out: ${metrics.outreach.optedOut}`);

    if (metrics.needsAttention.length > 0) {
      console.log('\nNeeds Attention:');
      for (const item of metrics.needsAttention) {
        const icon = item.priority === 'high' ? '🔴' : '🟡';
        console.log(`  ${icon} ${item.description}`);
      }
    }
  } catch (err) {
    console.log('  (metrics unavailable)');
  }

  // Campaigns
  console.log('');
  await campaignList();

  // Senders
  console.log('');
  await senderList();

  // DRY_RUN warning
  const dryRun = process.env.DRY_RUN !== 'false';
  if (dryRun) {
    console.log('\n⚠️  DRY_RUN is enabled — emails are generated but NOT sent.');
  }
}

// ─── Router ─────────────────────────────────────────────────────────

const parsed = parseArgs(args);

switch (command) {
  case 'campaign:create':
    await campaignCreate(parsed);
    break;
  case 'campaign:list':
    await campaignList();
    break;
  case 'campaign:stats':
    await campaignStats(parsed._positional || args[0]);
    break;
  case 'campaign:activate':
    await campaignActivate(parsed._positional || args[0]);
    break;
  case 'campaign:pause':
    await campaignPause(parsed._positional || args[0]);
    break;
  case 'campaign:enroll':
    await campaignEnroll(parsed._positional || args[0], parsed);
    break;
  case 'sender:list':
    await senderList();
    break;
  case 'status':
    await status();
    break;
  default:
    console.log(`
Revenue OS CLI

Commands:
  campaign:create    Create a new campaign
  campaign:list      List all campaigns with stats
  campaign:stats     Show detailed stats for a campaign
  campaign:activate  Set campaign status to Active
  campaign:pause     Pause a campaign
  campaign:enroll    Enroll contacts in a campaign
  sender:list        Show sender profiles with health
  status             Full system status

Usage: npx tsx src/scripts/ros.ts <command> [args]
    `);
}
