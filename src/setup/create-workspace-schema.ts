/**
 * Creates the Lead Workspace schema in Personize.
 *
 * This turns every contact into a shared workspace where agents contribute:
 * - Enrichment agent writes notes (Apollo data)
 * - Signal agent writes updates (buying signals detected)
 * - Outreach agent writes messages sent + tasks
 * - Engagement webhook writes updates (opens, clicks, replies)
 * - Reply handler writes notes (reply analysis) + tasks (follow-up actions)
 *
 * Run once: npm run setup:workspace
 */

import { client } from '../config.js';
import { logger } from '../lib/logger.js';

async function createWorkspaceSchema() {
  try {
    // Check if workspace collection already exists
    const existing = await client.collections.list();
    const hasWorkspace = (existing.data || []).some(
      (c: any) => c.systemName === 'lead_workspace' || c.name === 'Lead Workspace'
    );

    if (hasWorkspace) {
      logger.info('Lead Workspace collection already exists. Skipping creation.');
      return;
    }

    await client.collections.create({
      collectionName: 'Lead Workspace',
      description: 'Shared coordination surface for outreach sequences. Every agent — enrichment, signals, outreach, engagement — contributes to the same lead record. The workspace tracks sequence state, messages sent, replies received, and next actions. Read via smartDigest() to get the full picture before any outreach step.',
      properties: [
        {
          propertyName: 'context',
          type: 'text',
          description: 'Current lead state summary. Rewritten each cycle. Covers: enrichment status, ICP score, sequence step, last engagement, recommended next action. Any agent can rewrite when they have a materially updated understanding. This is the "start here" for any agent or human engaging with this lead.',
        },
        {
          propertyName: 'updates',
          type: 'array',
          description: 'Chronological timeline of everything that happened. Each entry: { author, type (enrichment | signal | outreach | engagement | system), summary, details, timestamp }. Append only — never edit existing entries. This is how agents and humans see what others have done.',
        },
        {
          propertyName: 'tasks',
          type: 'array',
          description: 'Action items for this lead. Each entry: { title, description, status (pending | in_progress | done | cancelled), owner (outreach-agent | enrichment-agent | sales-rep | system), priority (low | medium | high | urgent), dueDate, outcome }. A task assigned to an agent IS a handoff. Tasks can be updated (status changes as work progresses).',
        },
        {
          propertyName: 'notes',
          type: 'array',
          description: 'Knowledge and observations from any contributor. Each entry: { author, content, category (observation | analysis | enrichment | signal | reply-analysis), timestamp }. Append only. Enrichment data, signal analysis, reply sentiment, strategic observations all go here.',
        },
        {
          propertyName: 'issues',
          type: 'array',
          description: 'Problems, risks, and blockers. Each entry: { title, description, severity (low | medium | high | critical), status (open | resolved | dismissed), raisedBy, resolution, timestamp }. Email bounces, opt-outs, competitor mentions in replies, stale sequences — all flagged here.',
        },
        {
          propertyName: 'messages_sent',
          type: 'array',
          description: 'Every outreach message sent to this lead. Each entry: { channel (email | call | linkedin), subject, bodyPreview (first 200 chars), step (sequence step number), angle (personalization angle used), sentAt (ISO 8601), sentBy (agent or human), status (sent | delivered | opened | clicked | replied | bounced) }. Append only. This is the definitive record of what was communicated.',
        },
      ],
    });

    logger.info('Created Lead Workspace collection.');
    logger.info('Schema includes: context, updates, tasks, notes, issues, messages_sent');
  } catch (err) {
    logger.error('Failed to create workspace schema', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

createWorkspaceSchema();
