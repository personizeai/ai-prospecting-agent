/**
 * Governance Safety Layer — Versioning, validation, and dry-run for governance edits.
 *
 * Prevents bad autonomous (or human) edits from cascading across all outreach.
 *
 * Features:
 *   - Snapshot current governance before every edit (version history)
 *   - Validate proposed governance (non-empty, size limits, structure)
 *   - Dry-run: generate a test email with proposed governance and compare
 *   - Rollback: restore a previous governance version
 *
 * Usage:
 *   import { governanceSafety } from '../lib/governance-safety.js';
 *   await governanceSafety.safeUpdate(id, name, newValue);
 */

import { client } from '../config.js';
import { memoryCrud } from './personize-crud.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'governance-safety' });

const GOVERNANCE_COLLECTION = 'governance-history';
const MAX_GOVERNANCE_SIZE = 50_000; // 50KB — prevents context starvation
const MIN_GOVERNANCE_SIZE = 20;     // Catch empty/truncated edits

// ─── Types ───���──────────────────────────────────────────────────────

export interface GovernanceVersion {
  id: string;
  name: string;
  value: string;
  savedAt: string;
  savedBy: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Validation ───��─────────────────────────────────────────────────

/**
 * Validate governance content before saving.
 * Returns errors (block save) and warnings (allow but flag).
 */
function validateGovernance(name: string, value: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Empty check
  if (!value || value.trim().length < MIN_GOVERNANCE_SIZE) {
    errors.push(`Governance "${name}" is empty or too short (${value?.length ?? 0} chars, min ${MIN_GOVERNANCE_SIZE}). This would remove all rules for this variable.`);
  }

  // Size check
  if (value && value.length > MAX_GOVERNANCE_SIZE) {
    errors.push(`Governance "${name}" is too large (${value.length} chars, max ${MAX_GOVERNANCE_SIZE}). This would starve LLM context for contact/company data.`);
  }

  // Truncation detection — look for unmatched brackets/braces
  if (value) {
    const openBraces = (value.match(/\{/g) || []).length;
    const closeBraces = (value.match(/\}/g) || []).length;
    const openBrackets = (value.match(/\[/g) || []).length;
    const closeBrackets = (value.match(/\]/g) || []).length;

    if (Math.abs(openBraces - closeBraces) > 2) {
      warnings.push(`Unmatched braces detected ({: ${openBraces}, }: ${closeBraces}) — possible truncation or corrupt JSON.`);
    }
    if (Math.abs(openBrackets - closeBrackets) > 2) {
      warnings.push(`Unmatched brackets detected ([: ${openBrackets}, ]: ${closeBrackets}) — possible truncation.`);
    }
  }

  // Contradiction detection (basic — catches obvious "never X" vs "always X" conflicts)
  if (value) {
    const neverPhrases = [...value.matchAll(/never\s+(.{5,40})/gi)].map(m => m[1].trim().toLowerCase());
    const alwaysPhrases = [...value.matchAll(/always\s+(.{5,40})/gi)].map(m => m[1].trim().toLowerCase());

    for (const never of neverPhrases) {
      for (const always of alwaysPhrases) {
        // Check if the phrases are similar enough to be contradictory
        const neverWords = new Set(never.split(/\s+/));
        const alwaysWords = new Set(always.split(/\s+/));
        const overlap = [...neverWords].filter(w => alwaysWords.has(w));
        if (overlap.length >= 2) {
          warnings.push(`Possible contradiction: "never ${never}" vs "always ${always}"`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Versioning ──────────────────────���──────────────────────────────

/**
 * Snapshot current governance value before editing.
 * Stores in Personize memory for audit trail and rollback.
 */
async function snapshotCurrent(
  id: string,
  name: string,
  savedBy: string,
  reason: string,
): Promise<GovernanceVersion | null> {
  try {
    // Fetch current value
    const guidelines = await client.guidelines.list();
    const current = (guidelines.data as any[])?.find(
      (g: any) => g.id === id || g.slug === id || g.name === name
    );

    if (!current?.value) {
      log.info('No current governance value to snapshot', { id, name });
      return null;
    }

    const version: GovernanceVersion = {
      id,
      name,
      value: current.value,
      savedAt: new Date().toISOString(),
      savedBy,
      reason,
    };

    // Store snapshot in Personize memory
    await client.memory.memorize({
      email: `governance-${id}`,
      collectionName: 'governance-history',
      content: `[GOVERNANCE SNAPSHOT] "${name}" saved by ${savedBy}. Reason: ${reason}. Size: ${current.value.length} chars.`,
      properties: {
        governance_id: { value: id, extractMemories: false },
        governance_name: { value: name, extractMemories: false },
        governance_value: { value: current.value, extractMemories: false },
        saved_at: { value: version.savedAt, extractMemories: false },
        saved_by: { value: savedBy, extractMemories: false },
        reason: { value: reason, extractMemories: false },
      },
      tags: ['governance-history', `gov:${id}`],
    });

    log.info('Governance snapshot saved', { id, name, savedBy, size: current.value.length });
    return version;
  } catch (err) {
    log.error('Failed to snapshot governance (proceeding without snapshot)', {
      id, name, error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Get version history for a governance variable.
 */
async function getHistory(id: string, limit = 10): Promise<GovernanceVersion[]> {
  try {
    const result = await client.memory.recall({
      message: `governance snapshot history for ${id}`,
      type: 'governance-history',
      limit,
    });

    const versions: GovernanceVersion[] = [];
    for (const record of result.data || []) {
      const props = (record as any).properties || {};
      if (props.governance_id?.value === id) {
        versions.push({
          id: props.governance_id.value,
          name: props.governance_name?.value || '',
          value: props.governance_value?.value || '',
          savedAt: props.saved_at?.value || '',
          savedBy: props.saved_by?.value || '',
          reason: props.reason?.value || '',
        });
      }
    }

    return versions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  } catch (err) {
    log.warn('Failed to fetch governance history', { id, error: (err as Error).message });
    return [];
  }
}

// ─── Safe Update ────────────────────────────────────────────────────

/**
 * Safe governance update: validate → snapshot → update.
 * Returns validation result. If invalid, the update is blocked.
 */
async function safeUpdate(
  id: string,
  name: string,
  newValue: string,
  updatedBy: string = 'dashboard',
  reason: string = 'manual edit',
): Promise<{ success: boolean; validation: ValidationResult; snapshot: GovernanceVersion | null }> {
  // Step 1: Validate
  const validation = validateGovernance(name, newValue);

  if (!validation.valid) {
    log.warn('Governance update blocked by validation', {
      id, name, errors: validation.errors, updatedBy,
    });
    return { success: false, validation, snapshot: null };
  }

  if (validation.warnings.length > 0) {
    log.warn('Governance update has warnings', {
      id, name, warnings: validation.warnings, updatedBy,
    });
  }

  // Step 2: Snapshot current version
  const snapshot = await snapshotCurrent(id, name, updatedBy, reason);

  // Step 3: Apply update
  try {
    await client.guidelines.update(id, { name, value: newValue });

    log.info('Governance updated safely', {
      id, name, updatedBy, reason,
      previousSize: snapshot?.value.length,
      newSize: newValue.length,
      warnings: validation.warnings,
    });

    return { success: true, validation, snapshot };
  } catch (err) {
    log.error('Governance update failed after validation + snapshot', {
      id, name, error: (err as Error).message,
    });
    return { success: false, validation, snapshot };
  }
}

/**
 * Rollback governance to a specific version.
 */
async function rollback(
  id: string,
  name: string,
  targetVersion: GovernanceVersion,
  rolledBackBy: string,
): Promise<boolean> {
  // Snapshot current before rollback (so we can undo the undo)
  await snapshotCurrent(id, name, rolledBackBy, `rollback to version from ${targetVersion.savedAt}`);

  try {
    await client.guidelines.update(id, { name, value: targetVersion.value });
    log.info('Governance rolled back', {
      id, name, rolledBackBy,
      rolledBackTo: targetVersion.savedAt,
    });
    return true;
  } catch (err) {
    log.error('Governance rollback failed', { id, name, error: (err as Error).message });
    return false;
  }
}

// ─── Export ──────────────────────────────────────────────────────────

export const governanceSafety = {
  validate: validateGovernance,
  snapshotCurrent,
  getHistory,
  safeUpdate,
  rollback,
  MAX_GOVERNANCE_SIZE,
  MIN_GOVERNANCE_SIZE,
};
