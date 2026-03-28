/**
 * Role Assignment — Auto-assigns role_owner to contacts based on lead_status.
 *
 * Called by:
 *   - personize-webhook.ts (new contacts)
 *   - account-strategy.ts (unassigned contacts flagged by strategizer)
 *   - backfillRoles() (one-time migration for existing contacts)
 *
 * Assignment rules:
 *   1. If contact already has a role_owner, skip (don't override manual assignments)
 *   2. Infer role from lead_status using SALES_ROLES.claimTriggers
 *   3. Fall back to SALES_ORG_CONFIG.defaultRole (usually 'sdr')
 */

import { client } from '../config.js';
import { workspace } from '../lib/workspace.js';
import { SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { inferRoleFromStatus, type SalesRoleId } from '../config/sales-roles.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'assign-role' });

/**
 * Assign a role to a single contact if they don't have one.
 * Returns the assigned role, or null if already assigned.
 */
export async function assignRoleToContact(
  email: string,
  leadStatus?: string,
): Promise<SalesRoleId | null> {
  if (!SALES_ORG_CONFIG.enabled) return null;

  // Check if already assigned
  const current = await workspace.getRoleOwner(email);
  if (current && current !== 'unassigned') return null;

  // Determine role from lead_status
  let status = leadStatus;
  if (!status) {
    try {
      const digest = await client.memory.smartDigest({
        email,
        type: 'Contact',
        token_budget: 100,
        include_properties: true,
      });
      status = (digest.data as any)?.properties?.lead_status?.value || 'New';
    } catch {
      status = 'New';
    }
  }

  const roleId = inferRoleFromStatus(status || 'New');

  if (roleId === 'unassigned') {
    log.info('No role inferred for status, skipping assignment', { email, leadStatus: status });
    return null;
  }

  await workspace.setRoleOwner(email, roleId, `Auto-assigned from lead_status: ${status}`, 'role-assigner');

  log.info('Role assigned', { email, role: roleId, leadStatus: status });
  return roleId;
}

/**
 * Backfill role_owner for all existing contacts that don't have one.
 * Run this once as a migration when enabling SALES_ORG for the first time.
 */
export async function backfillRoles(): Promise<{ assigned: number; skipped: number }> {
  if (!SALES_ORG_CONFIG.enabled) {
    log.info('Sales org not enabled, skipping backfill');
    return { assigned: 0, skipped: 0 };
  }

  log.info('Starting role backfill');

  let assigned = 0;
  let skipped = 0;

  // Search for contacts without role_owner
  try {
    const result = await client.memory.search({
      type: 'Contact',
      query: 'all contacts',
      limit: 200,
    });

    const records = (result.data as any)?.records || result.data || [];
    if (!Array.isArray(records)) return { assigned: 0, skipped: 0 };

    for (const record of records) {
      const email = record.email || record.id;
      if (!email) continue;

      const existingRole = record.properties?.role_owner?.value;
      if (existingRole && existingRole !== 'unassigned') {
        skipped++;
        continue;
      }

      const leadStatus = record.properties?.lead_status?.value || 'New';
      const roleId = inferRoleFromStatus(leadStatus);

      await workspace.setRoleOwner(email, roleId, `Backfill from lead_status: ${leadStatus}`, 'role-backfill');
      assigned++;
    }
  } catch (err) {
    log.error('Role backfill failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('Role backfill complete', { assigned, skipped });
  return { assigned, skipped };
}
