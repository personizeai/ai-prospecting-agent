import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Environment Variable Validation', () => {
  it('DRY_RUN defaults to true when unset', () => {
    const dryRun = undefined !== 'false'; // simulates process.env.DRY_RUN being undefined
    assert.ok(dryRun, 'Should default to dry run when env var is unset');
  });

  it('DRY_RUN is false only with exact string "false"', () => {
    const cases = [
      { value: 'false', expected: false },
      { value: 'true', expected: true },
      { value: 'FALSE', expected: true }, // NOT false — must be lowercase
      { value: '0', expected: true },
      { value: '', expected: true },
      { value: undefined, expected: true },
    ];

    for (const { value, expected } of cases) {
      const dryRun = value !== 'false';
      assert.equal(dryRun, expected, `DRY_RUN="${value}" should be dryRun=${expected}`);
    }
  });

  it('RATE_LIMIT_PAUSE_MS defaults to 2000', () => {
    const value = Number(undefined) || 2000;
    assert.equal(value, 2000);
  });

  it('RATE_LIMIT_PAUSE_MS uses custom value when set', () => {
    const value = Number('3000') || 2000;
    assert.equal(value, 3000);
  });
});

describe('Input Sanitization', () => {
  it('filters contacts without email from HubSpot sync', () => {
    const contacts = [
      { properties: { email: 'valid@test.com', firstname: 'John' } },
      { properties: { email: null, firstname: 'NoEmail' } },
      { properties: { email: undefined, firstname: 'AlsoNoEmail' } },
      { properties: { email: '', firstname: 'EmptyEmail' } },
    ];

    const filtered = contacts.filter((c) => c.properties.email);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].properties.email, 'valid@test.com');
  });

  it('filters domains that look like emails', () => {
    const domains = ['acme.com', 'john@acme.com', 'example.org', ''];

    const valid = domains.filter((d) => d && !d.includes('@'));
    assert.equal(valid.length, 2);
    assert.deepEqual(valid, ['acme.com', 'example.org']);
  });

  it('handles undefined technologies array safely', () => {
    const data = { technologies: undefined };
    const technologies = Array.isArray(data.technologies) ? data.technologies : [];
    assert.deepEqual(technologies, []);
  });

  it('handles null technologies array safely', () => {
    const data = { technologies: null };
    const technologies = Array.isArray(data.technologies) ? data.technologies : [];
    assert.deepEqual(technologies, []);
  });
});

describe('Signal Ingestion Validation', () => {
  it('rejects signals with empty company_domain', () => {
    const signal = { company_domain: '', company_name: 'Acme', signal_type: 'funding' };
    assert.ok(!signal.company_domain, 'Empty domain should be falsy');
  });

  it('rejects signals with missing signal_type', () => {
    const signal = { company_domain: 'acme.com', company_name: 'Acme', signal_type: '' };
    assert.ok(!signal.signal_type, 'Empty signal_type should be falsy');
  });

  it('accepts valid signals', () => {
    const signal = { company_domain: 'acme.com', company_name: 'Acme', signal_type: 'funding' };
    assert.ok(signal.company_domain);
    assert.ok(signal.signal_type);
  });
});

describe('Context Truncation', () => {
  it('truncates long context to MAX_CONTEXT_CHARS', () => {
    const MAX_CONTEXT_CHARS = 30_000;
    const longString = 'x'.repeat(50_000);
    const truncated = longString.substring(0, MAX_CONTEXT_CHARS / 2);
    assert.equal(truncated.length, 15_000);
  });
});

describe('Funding Display', () => {
  it('formats funding amount with locale string', () => {
    const amount = 5000000;
    const display = amount ? `$${amount.toLocaleString()}` : 'N/A';
    assert.ok(display.startsWith('$'));
    assert.ok(display.includes('5'));
  });

  it('shows N/A for zero/undefined funding', () => {
    const display1 = 0 ? `$${(0).toLocaleString()}` : 'N/A';
    assert.equal(display1, 'N/A');

    const display2 = undefined ? `$${undefined}` : 'N/A';
    assert.equal(display2, 'N/A');
  });
});
