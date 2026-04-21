import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SALES_ROLES,
  inferRoleFromStatus,
  getHandoffTarget,
  getTaskOwnersForRole,
  getAllActiveTaskOwners,
  type SalesRoleId,
  type SalesRole,
} from '../config/sales-roles.js';

// ─── inferRoleFromStatus() ──────────────────────────────────────────

describe('inferRoleFromStatus()', () => {
  it("maps 'New' → sdr", () => {
    assert.equal(inferRoleFromStatus('New'), 'sdr');
  });

  it("maps 'Engaged' → ae", () => {
    assert.equal(inferRoleFromStatus('Engaged'), 'ae');
  });

  it("maps 'Qualified' → sdr (SDR owns qualification)", () => {
    assert.equal(inferRoleFromStatus('Qualified'), 'sdr');
  });

  it("maps 'Meeting Set' → ae", () => {
    assert.equal(inferRoleFromStatus('Meeting Set'), 'ae');
  });

  it("maps 'Customer' → csm", () => {
    assert.equal(inferRoleFromStatus('Customer'), 'csm');
  });

  it("maps 'Churned' → csm (CSM handles churn)", () => {
    assert.equal(inferRoleFromStatus('Churned'), 'csm');
  });

  it("returns 'unassigned' for unknown status", () => {
    assert.equal(inferRoleFromStatus('SomeRandomStatus'), 'unassigned');
  });

  it("returns 'unassigned' for empty input", () => {
    assert.equal(inferRoleFromStatus(''), 'unassigned');
  });

  it("returns 'unassigned' for null-ish input", () => {
    // Runtime safety: LLM output or DB values may be null/undefined
    assert.equal(inferRoleFromStatus(null as unknown as string), 'unassigned');
    assert.equal(inferRoleFromStatus(undefined as unknown as string), 'unassigned');
  });
});

// ─── getHandoffTarget() ────────────────────────────────────────────

describe('getHandoffTarget()', () => {
  it("SDR handoff from 'Engaged' → ae", () => {
    const result = getHandoffTarget('sdr', 'Engaged');
    assert.ok(result, 'Should return a handoff trigger');
    assert.equal(result.toRole, 'ae');
  });

  it("SDR handoff from 'Meeting Set' → ae", () => {
    const result = getHandoffTarget('sdr', 'Meeting Set');
    assert.ok(result, 'Should return a handoff trigger');
    assert.equal(result.toRole, 'ae');
  });

  it("AE handoff from 'Customer' → csm", () => {
    const result = getHandoffTarget('ae', 'Customer');
    assert.ok(result, 'Should return a handoff trigger');
    assert.equal(result.toRole, 'csm');
  });

  it("CSM handoff from 'New' → sdr (churned re-engage)", () => {
    const result = getHandoffTarget('csm', 'New');
    assert.ok(result, 'Should return a handoff trigger');
    assert.equal(result.toRole, 'sdr');
  });

  it('returns null for non-handoff status', () => {
    const result = getHandoffTarget('sdr', 'Researching');
    assert.equal(result, null);
  });

  it('returns null for unknown role', () => {
    const result = getHandoffTarget('nonexistent' as SalesRoleId, 'Engaged');
    assert.equal(result, null);
  });

  it('returns null when role has no handoff triggers', () => {
    const result = getHandoffTarget('sales-ops', 'Engaged');
    assert.equal(result, null);
  });
});

// ─── getAllActiveTaskOwners() ───────────────────────────────────────

describe('getAllActiveTaskOwners()', () => {
  it('returns correct owners for SDR role', () => {
    const owners = getAllActiveTaskOwners(['sdr']);
    assert.ok(owners.includes('sdr-outreach-agent'));
    assert.ok(owners.includes('outreach-agent'));
  });

  it('returns combined owners for multiple roles', () => {
    const owners = getAllActiveTaskOwners(['sdr', 'ae', 'csm']);
    assert.ok(owners.includes('sdr-outreach-agent'));
    assert.ok(owners.includes('outreach-agent'));
    assert.ok(owners.includes('ae-outreach-agent'));
    assert.ok(owners.includes('csm-engagement-agent'));
  });

  it('returns no duplicates', () => {
    const owners = getAllActiveTaskOwners(['sdr', 'sdr']);
    const unique = [...new Set(owners)];
    assert.equal(owners.length, unique.length);
  });

  it('returns empty array for empty input', () => {
    const owners = getAllActiveTaskOwners([]);
    assert.equal(owners.length, 0);
  });

  it('returns sales-ops task owners', () => {
    const owners = getAllActiveTaskOwners(['sales-ops']);
    assert.ok(owners.includes('enrichment-agent'));
    assert.ok(owners.includes('signal-agent'));
  });
});

// ─── getTaskOwnersForRole() ────────────────────────────────────────

describe('getTaskOwnersForRole()', () => {
  it('returns owners for each role', () => {
    assert.ok(getTaskOwnersForRole('sdr').length > 0);
    assert.ok(getTaskOwnersForRole('ae').length > 0);
    assert.ok(getTaskOwnersForRole('csm').length > 0);
    assert.ok(getTaskOwnersForRole('sales-ops').length > 0);
  });

  it('returns empty array for revenue-analyst (no task owners)', () => {
    assert.equal(getTaskOwnersForRole('revenue-analyst').length, 0);
  });

  it('returns empty array for unknown role', () => {
    assert.deepEqual(getTaskOwnersForRole('nonexistent' as SalesRoleId), []);
  });
});

// ─── SalesRole config validation ───────────────────────────────────

describe('SalesRole config validation', () => {
  const roleIds = Object.keys(SALES_ROLES) as SalesRoleId[];

  it('each role has required fields', () => {
    for (const roleId of roleIds) {
      const role: SalesRole = SALES_ROLES[roleId];
      assert.ok(role.id, `${roleId} must have id`);
      assert.ok(role.name, `${roleId} must have name`);
      assert.ok(role.description, `${roleId} must have description`);
      assert.ok(Array.isArray(role.ownsStatuses), `${roleId} must have ownsStatuses array`);
      assert.ok(Array.isArray(role.claimTriggers), `${roleId} must have claimTriggers array`);
      assert.ok(Array.isArray(role.handoffTriggers), `${roleId} must have handoffTriggers array`);
      assert.ok(Array.isArray(role.taskOwners), `${roleId} must have taskOwners array`);
      assert.ok(Array.isArray(role.governanceOverlays), `${roleId} must have governanceOverlays array`);
      assert.ok(typeof role.defaultAgentMode === 'string', `${roleId} must have defaultAgentMode string`);
      assert.ok(role.schedule, `${roleId} must have schedule`);
      assert.ok(typeof role.schedule.outreachCron === 'string', `${roleId} must have outreachCron`);
      assert.ok(typeof role.schedule.taskExecutorCron === 'string', `${roleId} must have taskExecutorCron`);
    }
  });

  it('role IDs are unique and match their keys', () => {
    const ids = roleIds.map((k) => SALES_ROLES[k].id);
    const unique = [...new Set(ids)];
    assert.equal(ids.length, unique.length, 'Role IDs should be unique');
    for (const roleId of roleIds) {
      assert.equal(SALES_ROLES[roleId].id, roleId, `Role key "${roleId}" must match its .id`);
    }
  });

  it('handoff targets reference valid roles', () => {
    for (const roleId of roleIds) {
      const role = SALES_ROLES[roleId];
      for (const trigger of role.handoffTriggers) {
        assert.ok(
          trigger.toRole in SALES_ROLES,
          `${roleId} has handoff to "${trigger.toRole}" which is not a valid role`,
        );
      }
    }
  });

  it('no circular handoff chains (A->B->A in single step)', () => {
    for (const roleId of roleIds) {
      const role = SALES_ROLES[roleId];
      for (const trigger of role.handoffTriggers) {
        const targetRole = SALES_ROLES[trigger.toRole];
        // Check if the target role hands off back to this role for the same fromStatus
        const reverseHandoff = targetRole.handoffTriggers.find(
          (t: { toRole: SalesRoleId; fromStatus: string }) => t.toRole === roleId && t.fromStatus === trigger.fromStatus,
        );
        assert.equal(
          reverseHandoff,
          undefined,
          `Circular handoff: ${roleId} -> ${trigger.toRole} -> ${roleId} on status "${trigger.fromStatus}"`,
        );
      }
    }
  });

  it('AE defaultAgentMode is abm, not outbound-sdr', () => {
    assert.equal(SALES_ROLES.ae.defaultAgentMode, 'abm');
  });

  it('SDR defaultAgentMode is outbound-sdr', () => {
    assert.equal(SALES_ROLES.sdr.defaultAgentMode, 'outbound-sdr');
  });

  it('CSM defaultAgentMode is member-renewal', () => {
    assert.equal(SALES_ROLES.csm.defaultAgentMode, 'member-renewal');
  });

  it('has all 5 roles', () => {
    assert.equal(roleIds.length, 5);
    assert.ok(roleIds.includes('sdr'));
    assert.ok(roleIds.includes('ae'));
    assert.ok(roleIds.includes('csm'));
    assert.ok(roleIds.includes('sales-ops'));
    assert.ok(roleIds.includes('revenue-analyst'));
  });
});

// ─── Role assignment logic (testable without SDK) ──────────────────

describe('Role assignment logic', () => {
  it('assigns correct role based on lead status', () => {
    const statusToRole: Record<string, string> = {
      'New': 'sdr',
      'Researching': 'sdr',
      'Contacted': 'sdr',
      'Qualified': 'sdr',
      'Engaged': 'ae',
      'Meeting Set': 'ae',
      'Opportunity': 'ae',
      'Customer': 'csm',
      'Churned': 'csm',
    };

    for (const [status, expectedRole] of Object.entries(statusToRole)) {
      const role = inferRoleFromStatus(status);
      assert.equal(role, expectedRole, `Status "${status}" should map to "${expectedRole}", got "${role}"`);
    }
  });

  it('Disqualified status returns unassigned (not owned by any role)', () => {
    assert.equal(inferRoleFromStatus('Disqualified'), 'unassigned');
  });
});

// ─── processHandoff validation (structural tests) ──────────────────

describe('processHandoff validation (structural)', () => {
  it('rejects invalid fromRole at runtime via SALES_ROLES lookup', () => {
    // processHandoff accesses SALES_ROLES[fromRole] — if invalid, it would be undefined
    const invalidRole = 'invalid-role' as SalesRoleId;
    assert.equal(SALES_ROLES[invalidRole], undefined, 'Invalid role should not exist in SALES_ROLES');
  });

  it('rejects invalid toRole at runtime via SALES_ROLES lookup', () => {
    const invalidRole = 'fake-role' as SalesRoleId;
    assert.equal(SALES_ROLES[invalidRole], undefined, 'Invalid role should not exist in SALES_ROLES');
  });

  it('all valid roles are accessible in SALES_ROLES', () => {
    const validRoles: SalesRoleId[] = ['sdr', 'ae', 'csm', 'sales-ops', 'revenue-analyst'];
    for (const role of validRoles) {
      assert.ok(SALES_ROLES[role], `${role} should exist in SALES_ROLES`);
      assert.equal(SALES_ROLES[role].id, role);
    }
  });

  it('isValidRoleId pattern works for validation', () => {
    // This tests the validation pattern used in account-strategy.ts
    const isValid = (value: string): value is SalesRoleId => value in SALES_ROLES;

    assert.ok(isValid('sdr'));
    assert.ok(isValid('ae'));
    assert.ok(isValid('csm'));
    assert.ok(isValid('sales-ops'));
    assert.ok(isValid('revenue-analyst'));
    assert.ok(!isValid('invalid'));
    assert.ok(!isValid(''));
    assert.ok(!isValid('SDR')); // case-sensitive
  });
});
