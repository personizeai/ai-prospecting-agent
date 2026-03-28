/**
 * Role Governance — Per-role governance overlay resolution.
 *
 * Each role can have governance overlays that modify the base guidelines:
 *   - brand-voice--sdr: Challenger tone, short punchy emails
 *   - brand-voice--ae: Consultative tone, deal-focused language
 *   - brand-voice--csm: Supportive tone, retention-focused
 *
 * Overlays only specify DIFFERENCES from the base. Missing overlays inherit global.
 *
 * Naming convention: `{base-slug}--{role-id}`
 *   e.g., brand-voice--sdr, outreach-playbook--ae, brand-voice--csm
 *
 * Usage:
 *   import { getGovernanceForRole } from '../lib/role-governance.js';
 *   const context = await getGovernanceForRole('sdr', 'outreach, personalization');
 */

import { client } from '../config.js';
import { SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { SALES_ROLES, type SalesRoleId } from '../config/sales-roles.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'role-governance' });

/**
 * Fetch governance context with role-specific overlays merged in.
 *
 * When SALES_ORG is disabled, returns base governance (backward compat).
 * When enabled, fetches base + role overlays and concatenates them,
 * with the role overlay section clearly marked.
 */
export async function getGovernanceForRole(
  roleId: SalesRoleId | undefined,
  baseMessage: string,
): Promise<string> {
  // Fetch base governance (always needed)
  const baseResult = await client.ai.smartGuidelines({
    message: baseMessage,
    mode: 'fast',
  });
  const baseContext = baseResult.data?.compiledContext || '';

  // If no role or sales org disabled, return base only
  if (!roleId || !SALES_ORG_CONFIG.enabled) return baseContext;

  const role = SALES_ROLES[roleId];
  if (!role || role.governanceOverlays.length === 0) return baseContext;

  // Fetch role-specific overlays
  const overlayMessage = role.governanceOverlays.join(', ') + ', ' + baseMessage;

  try {
    const overlayResult = await client.ai.smartGuidelines({
      message: overlayMessage,
      mode: 'fast',
    });
    const overlayContext = overlayResult.data?.compiledContext || '';

    if (!overlayContext) return baseContext;

    // Merge: base context + role overlay clearly marked
    return [
      baseContext,
      '',
      `## Role-Specific Guidelines (${role.name})`,
      `You are operating as the ${role.name} (${role.description}).`,
      overlayContext,
    ].join('\n');
  } catch (err) {
    log.warn('Failed to fetch role governance overlays, using base only', {
      roleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return baseContext;
  }
}
