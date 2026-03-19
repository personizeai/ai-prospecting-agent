import { client } from '../config.js';
import { getRemainingCapacity } from '../delivery/gmail.js';
import { GMAIL_CONFIG } from '../config/prospecting.config.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, { status: string; latency_ms: number; detail?: string }>;
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {};
  let hasUnhealthy = false;
  let hasDegraded = false;

  // ─── Personize API ──────────────────────────────────────────────────
  const personizeStart = Date.now();
  try {
    await client.me();
    checks['personize'] = {
      status: 'ok',
      latency_ms: Date.now() - personizeStart,
    };
  } catch (err) {
    hasUnhealthy = true;
    checks['personize'] = {
      status: 'error',
      latency_ms: Date.now() - personizeStart,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ─── Gmail Capacity ────────────────────────────────────────────────
  const gmailStart = Date.now();
  try {
    const capacity = getRemainingCapacity();
    const totalLimit = GMAIL_CONFIG.senders.reduce((sum, s) => sum + s.dailyLimit, 0);
    const percentRemaining = totalLimit > 0 ? (capacity.total / totalLimit) * 100 : 0;
    const storeDetail = capacity.store.mode === 'file'
      ? `tracked via ${capacity.store.path}`
      : `using in-memory fallback (${capacity.store.lastError || 'store unavailable'})`;

    if (GMAIL_CONFIG.senders.length === 0) {
      hasDegraded = true;
      checks['gmail'] = {
        status: 'not_configured',
        latency_ms: Date.now() - gmailStart,
        detail: 'No Gmail senders configured',
      };
    } else if (capacity.store.mode !== 'file') {
      hasDegraded = true;
      checks['gmail'] = {
        status: 'estimated_capacity',
        latency_ms: Date.now() - gmailStart,
        detail: `${capacity.total}/${totalLimit} sends remaining; ${storeDetail}`,
      };
    } else if (percentRemaining < 20) {
      hasDegraded = true;
      checks['gmail'] = {
        status: 'low_capacity',
        latency_ms: Date.now() - gmailStart,
        detail: `${capacity.total}/${totalLimit} sends remaining (${Math.round(percentRemaining)}%); ${storeDetail}`,
      };
    } else {
      checks['gmail'] = {
        status: 'ok',
        latency_ms: Date.now() - gmailStart,
        detail: `${capacity.total}/${totalLimit} sends remaining; ${storeDetail}`,
      };
    }
  } catch (err) {
    hasDegraded = true;
    checks['gmail'] = {
      status: 'error',
      latency_ms: Date.now() - gmailStart,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ─── Apollo API Key ────────────────────────────────────────────────
  const apolloConfigured = !!process.env.APOLLO_API_KEY;
  if (!apolloConfigured) hasDegraded = true;
  checks['apollo'] = {
    status: apolloConfigured ? 'ok' : 'not_configured',
    latency_ms: 0,
    detail: apolloConfigured ? 'API key configured' : 'APOLLO_API_KEY not set',
  };

  // ─── Tavily API Key ───────────────────────────────────────────────
  const tavilyConfigured = !!process.env.TAVILY_API_KEY;
  if (!tavilyConfigured) hasDegraded = true;
  checks['tavily'] = {
    status: tavilyConfigured ? 'ok' : 'not_configured',
    latency_ms: 0,
    detail: tavilyConfigured ? 'API key configured' : 'TAVILY_API_KEY not set',
  };

  // ─── HubSpot Access Token ─────────────────────────────────────────
  const hubspotConfigured = !!process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hubspotConfigured) hasDegraded = true;
  checks['hubspot'] = {
    status: hubspotConfigured ? 'ok' : 'not_configured',
    latency_ms: 0,
    detail: hubspotConfigured ? 'Access token configured' : 'HUBSPOT_ACCESS_TOKEN not set',
  };

  // ─── Governance ──────────────────────────────────────────────────
  const govStart = Date.now();
  try {
    const guidelines = await client.ai.smartGuidelines({
      message: 'brand voice, outreach playbook, ICP definition',
      mode: 'fast',
    });
    const content = guidelines.data?.compiledContext || '';
    if (!content || content.length < 50) {
      hasDegraded = true;
      checks['governance'] = {
        status: 'not_configured',
        latency_ms: Date.now() - govStart,
        detail: 'Governance variables empty or not set — emails will generate without brand voice. Run: npm run setup:governance',
      };
    } else {
      checks['governance'] = {
        status: 'ok',
        latency_ms: Date.now() - govStart,
        detail: `${content.length} chars of governance context available`,
      };
    }
  } catch (err) {
    hasDegraded = true;
    checks['governance'] = {
      status: 'error',
      latency_ms: Date.now() - govStart,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ─── Aggregate Status ─────────────────────────────────────────────
  let status: HealthCheckResult['status'] = 'healthy';
  if (hasUnhealthy) status = 'unhealthy';
  else if (hasDegraded) status = 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
  };
}
