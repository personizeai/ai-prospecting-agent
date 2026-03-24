/**
 * Personize Webhook — Receives notifications when records are memorized or updated.
 *
 * This task is the entry point for the "no CRM sync needed" flow:
 *   - User memorizes contacts/companies via HubSpot integration, Zapier, API, CSV, etc.
 *   - Personize fires a webhook to this task
 *   - The agent routes to the right pipeline based on record type and event
 *
 * Setup:
 *   1. Deploy this task to Trigger.dev
 *   2. In Trigger.dev dashboard → Tasks → "personize-webhook" → copy the webhook URL
 *   3. Add the URL to Personize webhook config for memorize/prompt events
 *
 * Pipeline routing (configurable via WEBHOOK_PIPELINES in prospecting.config.ts):
 *   - contact:created  → enrich → score → evaluate account strategy
 *   - contact:updated  → re-score → re-evaluate account strategy
 *   - company:created  → enrich company → research → discover contacts → strategy
 *   - company:updated  → re-research → re-evaluate strategies
 */

import { task } from "@trigger.dev/sdk/v3";
import { client } from '../config.js';
import { workspace } from '../lib/workspace.js';
import { enrichContactsTask } from './enrich-contacts.js';
import { reportFailure } from './error-handler.js';
import { logger, withContext } from '../lib/logger.js';

const log = logger.child({ module: 'personize-webhook' });

// ─── Webhook Payload Types ────────────────────────────────────────

interface PersonizeWebhookPayload {
  /** Event type from Personize. */
  event: 'memorize' | 'memorize.batch' | 'prompt' | 'prompt.batch' | string;
  /** Record type / collection. */
  type?: string;
  /** Record identifier (email for contacts, domain for companies). */
  recordId?: string;
  /** Email (if contact). */
  email?: string;
  /** Domain (if company). */
  domain?: string;
  /** Whether this is a new record or an update to an existing one. */
  isNew?: boolean;
  /** Properties that were set/updated. */
  properties?: Record<string, unknown>;
  /** Batch of records (for batch events). */
  records?: Array<{
    type?: string;
    recordId?: string;
    email?: string;
    domain?: string;
    isNew?: boolean;
  }>;
  /** Timestamp from Personize. */
  timestamp?: string;
  /** Webhook secret for verification. */
  secret?: string;
}

// ─── Pipeline Config ──────────────────────────────────────────────

interface PipelineSteps {
  enrich: boolean;
  score: boolean;
  research: boolean;
  discoverContacts: boolean;
  evaluateStrategy: boolean;
  startSequence: boolean;
  notify: boolean;
}

function getDefaultPipeline(recordType: string, isNew: boolean): PipelineSteps {
  // Read overrides from env (JSON format) or use sensible defaults
  const envOverrides = process.env.WEBHOOK_PIPELINES;
  if (envOverrides) {
    try {
      const parsed = JSON.parse(envOverrides);
      const key = `${recordType}:${isNew ? 'created' : 'updated'}`;
      if (parsed[key]) return { ...getDefaults(recordType, isNew), ...parsed[key] };
    } catch { /* use defaults */ }
  }
  return getDefaults(recordType, isNew);
}

function getDefaults(recordType: string, isNew: boolean): PipelineSteps {
  if (recordType === 'Contact' || recordType === 'contact') {
    return isNew
      ? { enrich: true, score: true, research: false, discoverContacts: false, evaluateStrategy: true, startSequence: true, notify: true }
      : { enrich: false, score: true, research: false, discoverContacts: false, evaluateStrategy: true, startSequence: false, notify: false };
  }
  if (recordType === 'Company' || recordType === 'company') {
    return isNew
      ? { enrich: true, score: true, research: true, discoverContacts: true, evaluateStrategy: true, startSequence: false, notify: true }
      : { enrich: false, score: false, research: true, discoverContacts: false, evaluateStrategy: true, startSequence: false, notify: false };
  }
  // Unknown type — minimal pipeline
  return { enrich: false, score: false, research: false, discoverContacts: false, evaluateStrategy: false, startSequence: false, notify: false };
}

// ─── Record Processing ────────────────────────────────────────────

async function processRecord(record: {
  type: string;
  recordId: string;
  email?: string;
  domain?: string;
  isNew: boolean;
}): Promise<{ processed: boolean; pipelines: string[] }> {
  const { type, recordId, isNew } = record;
  const email = record.email || recordId;
  const pipeline = getDefaultPipeline(type, isNew);
  const executed: string[] = [];

  log.info('Processing webhook record', { type, recordId, isNew, pipeline });

  // ─── Contact Processing ─────────────────────────────────────
  if (type === 'Contact' || type === 'contact') {
    // Log to workspace
    if (isNew) {
      await workspace.addUpdate(email, {
        author: 'personize-webhook',
        type: 'system',
        summary: `New contact memorized via external integration`,
      });
    } else {
      await workspace.addUpdate(email, {
        author: 'personize-webhook',
        type: 'system',
        summary: `Contact updated via external integration`,
      });
    }

    // Auto-assign role (Sales Org)
    if (isNew) {
      try {
        const { assignRoleToContact } = await import('../pipelines/assign-role.js');
        const assignedRole = await assignRoleToContact(email);
        if (assignedRole) executed.push(`assignRole:${assignedRole}`);
      } catch (err) {
        log.warn('Role assignment failed', { email, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Enrich (Apollo)
    if (pipeline.enrich) {
      try {
        await enrichContactsTask.trigger();
        executed.push('enrich');
      } catch (err) {
        log.warn('Enrich trigger failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Evaluate account strategy (if contact has a company domain)
    if (pipeline.evaluateStrategy) {
      try {
        // Look up the contact's company domain
        const digest = await client.memory.smartDigest({
          email,
          type: 'Contact',
          token_budget: 200,
          include_properties: true,
        });
        const domain = (digest.data as any)?.properties?.company_website?.value || '';

        if (domain) {
          const { evaluateAccountStrategy } = await import('../pipelines/account-strategy.js');
          await evaluateAccountStrategy(domain);
          executed.push('evaluateStrategy');
        }
      } catch (err) {
        log.warn('Account strategy failed', { email, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Start outreach sequence for new high-score contacts
    if (pipeline.startSequence && isNew) {
      try {
        const digest = await client.memory.smartDigest({
          email,
          type: 'Contact',
          token_budget: 200,
          include_properties: true,
        });
        const props = (digest.data as any)?.properties || {};
        const leadScore = Number(props.lead_score?.value) || 0;
        const icpMatch = props.icp_match?.value === true || props.icp_match?.value === 'true';
        const outreachStage = props.outreach_stage?.value || 'Not Started';

        if (icpMatch && outreachStage === 'Not Started' && leadScore >= 40) {
          const { fullSequenceTask } = await import('./outreach-sequence.js');
          const crmId = props.crm_id?.value || '';
          await fullSequenceTask.trigger({ contactEmail: email, crmId, icpScore: leadScore });
          executed.push('startSequence');
        }
      } catch (err) {
        log.warn('Start sequence failed', { email, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // ─── Company Processing ─────────────────────────────────────
  if (type === 'Company' || type === 'company') {
    const domain = record.domain || recordId;

    // Research (Tavily web search)
    if (pipeline.research) {
      try {
        const { researchCompany } = await import('../pipelines/research-company.js');
        await researchCompany(domain, domain);
        executed.push('research');
      } catch (err) {
        log.warn('Research failed', { domain, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Discover contacts (Apollo)
    if (pipeline.discoverContacts && isNew) {
      try {
        const { discoverContactsTask } = await import('./discover-contacts.js');
        await discoverContactsTask.trigger({
          hotAccounts: [{ company: domain, domain, score: 50, strength: 'webhook', action: 'discover' }],
        });
        executed.push('discoverContacts');
      } catch (err) {
        log.warn('Contact discovery failed', { domain, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Account strategy
    if (pipeline.evaluateStrategy) {
      try {
        const { evaluateAccountStrategy } = await import('../pipelines/account-strategy.js');
        await evaluateAccountStrategy(domain);
        executed.push('evaluateStrategy');
      } catch (err) {
        log.warn('Account strategy failed', { domain, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { processed: true, pipelines: executed };
}

// ─── Webhook Task ─────────────────────────────────────────────────

export const personizeWebhookTask = task({
  id: "personize-webhook",
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000 },
  onFailure: async (_payload, error, { ctx }) => {
    await reportFailure("personize-webhook", ctx.run.id, error);
  },
  run: async (payload: PersonizeWebhookPayload, { ctx }: any) => {
    return withContext({ requestId: ctx.run.id, pipeline: "personize-webhook" }, async () => {

      // ─── Verify webhook secret (if configured) ────────────
      const expectedSecret = process.env.PERSONIZE_WEBHOOK_SECRET;
      if (expectedSecret && payload.secret !== expectedSecret) {
        log.warn('Personize webhook secret mismatch, rejecting');
        return { processed: false, reason: 'invalid_secret' };
      }

      // ─── Batch events ─────────────────────────────────────
      if (payload.records && Array.isArray(payload.records)) {
        log.info('Processing batch webhook', { count: payload.records.length, event: payload.event });

        const results = [];
        for (const record of payload.records) {
          const result = await processRecord({
            type: record.type || 'Contact',
            recordId: record.recordId || record.email || record.domain || '',
            email: record.email,
            domain: record.domain,
            isNew: record.isNew ?? true,
          });
          results.push(result);
        }

        return {
          processed: true,
          event: payload.event,
          recordsProcessed: results.length,
          pipelines: results.flatMap((r) => r.pipelines),
          timestamp: new Date().toISOString(),
        };
      }

      // ─── Single record event ──────────────────────────────
      const type = payload.type || 'Contact';
      const recordId = payload.recordId || payload.email || payload.domain || '';

      if (!recordId) {
        log.warn('Webhook has no recordId, email, or domain — skipping', { event: payload.event });
        return { processed: false, reason: 'no_record_id' };
      }

      const result = await processRecord({
        type,
        recordId,
        email: payload.email,
        domain: payload.domain,
        isNew: payload.isNew ?? true,
      });

      return {
        processed: true,
        event: payload.event,
        type,
        recordId,
        pipelines: result.pipelines,
        timestamp: new Date().toISOString(),
      };
    });
  },
});
