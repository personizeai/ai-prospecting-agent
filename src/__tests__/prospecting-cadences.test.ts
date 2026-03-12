import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCadence, getCadenceName, CADENCES, CADENCE_RULES } from '../config/prospecting.config.js';

// ─── getCadence — score-based selection ─────────────────────────────

describe('getCadence — score-based selection', () => {
  it('returns aggressive cadence for score 90', () => {
    const cadence = getCadence(90);
    assert.equal(cadence.maxEmails, 3);
    assert.deepEqual(cadence.waitDays, [2, 3]);
  });

  it('returns aggressive cadence for score 80 (boundary)', () => {
    const cadence = getCadence(80);
    assert.equal(cadence.maxEmails, 3);
    assert.deepEqual(cadence.waitDays, [2, 3]);
  });

  it('returns standard cadence for score 60', () => {
    const cadence = getCadence(60);
    assert.equal(cadence.maxEmails, 3);
    assert.deepEqual(cadence.waitDays, [3, 5]);
  });

  it('returns standard cadence for score 50 (boundary)', () => {
    const cadence = getCadence(50);
    assert.deepEqual(cadence.waitDays, [3, 5]);
  });

  it('returns enterprise cadence for score 30', () => {
    const cadence = getCadence(30);
    assert.equal(cadence.maxEmails, 4);
    assert.deepEqual(cadence.waitDays, [5, 7, 10]);
  });

  it('returns enterprise cadence for score 0 (boundary)', () => {
    const cadence = getCadence(0);
    assert.equal(cadence.maxEmails, 4);
  });

  it('returns standard (default) cadence when score is undefined', () => {
    const cadence = getCadence(undefined);
    assert.equal(cadence.maxEmails, 3);
    assert.deepEqual(cadence.waitDays, [3, 5]);
  });
});

// ─── getCadenceName ─────────────────────────────────────────────────

describe('getCadenceName — returns cadence name string', () => {
  it('returns "aggressive" for score 85', () => {
    assert.equal(getCadenceName(85), 'aggressive');
  });

  it('returns "standard" for score 65', () => {
    assert.equal(getCadenceName(65), 'standard');
  });

  it('returns "enterprise" for score 20', () => {
    assert.equal(getCadenceName(20), 'enterprise');
  });

  it('returns "standard" for undefined score', () => {
    assert.equal(getCadenceName(undefined), 'standard');
  });
});

// ─── Cadence definitions validity ───────────────────────────────────

describe('CADENCES — structural validity', () => {
  it('every cadence has waitDays.length === maxEmails - 1', () => {
    for (const [name, cadence] of Object.entries(CADENCES)) {
      assert.equal(
        cadence.waitDays.length,
        cadence.maxEmails - 1,
        `${name}: waitDays.length (${cadence.waitDays.length}) should be maxEmails - 1 (${cadence.maxEmails - 1})`,
      );
    }
  });

  it('every cadence has positive waitDays values', () => {
    for (const [name, cadence] of Object.entries(CADENCES)) {
      for (const days of cadence.waitDays) {
        assert.ok(days > 0, `${name}: waitDays should be positive, got ${days}`);
      }
    }
  });

  it('every cadence has a non-empty label', () => {
    for (const [name, cadence] of Object.entries(CADENCES)) {
      assert.ok(cadence.label.length > 0, `${name}: label should not be empty`);
    }
  });

  it('all cadences referenced in CADENCE_RULES exist', () => {
    for (const rule of CADENCE_RULES.scoreThresholds) {
      assert.ok(
        CADENCES[rule.cadence],
        `CADENCE_RULES references "${rule.cadence}" but it does not exist in CADENCES`,
      );
    }
    assert.ok(
      CADENCES[CADENCE_RULES.defaultCadence],
      `Default cadence "${CADENCE_RULES.defaultCadence}" does not exist in CADENCES`,
    );
  });
});
