/**
 * Process Handoff — Transfers a contact from one role to another.
 *
 * Called when:
 *   - Reply analyzer detects a positive reply from an SDR-owned contact → AE
 *   - Deal closes (Customer status) → CSM
 *   - Strategizer recommends a handoff
 *   - Manual reassignment from dashboard
 *
 * The handoff:
 *   1. Updates role_owner on the contact
 *   2. Creates a "handoff received" task for the new role with full context
 *   3. Logs the handoff in workspace updates
 *   4. Notifies via Slack
 */

import { workspace } from '../lib/workspace.js';
import { SALES_ORG_CONFIG } from '../config/prospecting.config.js';
import { SALES_ROLES, type SalesRoleId } from '../config/sales-roles.js';
import { notifySlack } from '../delivery/slack-notify.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'process-handoff' });

export async function processHandoff(
  contactEmail: string,
  fromRole: SalesRoleId,
  toRole: SalesRoleId,
  reason: string,
  context?: string,
): Promise<void> {
  if (!SALES_ORG_CONFIG.enabled) return;

  const toRoleDef = SALES_ROLES[toRole];
  const fromRoleDef = SALES_ROLES[fromRole];

  log.info('Processing handoff', { contactEmail, fromRole, toRole, reason });

  // 1. Update role_owner
  await workspace.setRoleOwner(
    contactEmail,
    toRole,
    `Handoff from ${fromRoleDef.name}: ${reason}`,
    `${fromRole}-handoff`,
  );

  // 2. Create handoff task for new role
  const taskDescription = [
    `**Handoff from ${fromRoleDef.name} to ${toRoleDef.name}**`,
    '',
    `**Reason:** ${reason}`,
    context ? `\n**Context:**\n${context}` : '',
    '',
    `**Your role:** ${toRoleDef.description}`,
    '',
    'Review the contact workspace (updates, notes, messages sent) for full history.',
  ].filter(Boolean).join('\n');

  await workspace.addTask(contactEmail, {
    title: `Handoff received from ${fromRoleDef.name} — ${reason}`,
    description: taskDescription,
    status: 'pending',
    owner: toRoleDef.taskOwners[0] || 'sales-rep',
    createdBy: `${fromRole}-handoff`,
    priority: 'high',
    dueDate: new Date(Date.now() + 4 * 3600_000).toISOString(), // 4 hours
  });

  // 3. Log in workspace updates
  await workspace.addUpdate(contactEmail, {
    author: `${fromRole}-handoff`,
    type: 'system',
    summary: `Role handoff: ${fromRoleDef.name} → ${toRoleDef.name}. Reason: ${reason}`,
    details: context,
  });

  // 4. Slack notification
  if (SALES_ORG_CONFIG.handoffNotifySlack) {
    await notifySlack(
      `*Role Handoff*\nContact: ${contactEmail}\nFrom: ${fromRoleDef.name} → To: ${toRoleDef.name}\nReason: ${reason}`,
    );
  }

  log.info('Handoff complete', { contactEmail, fromRole, toRole });
}
