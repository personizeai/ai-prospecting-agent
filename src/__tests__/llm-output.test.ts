import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseLLMJson, buildJsonInstruction } from '../lib/llm-output.js';
import type { SchemaMap } from '../lib/llm-output.js';

// ─── Test Schema ─────────────────────────────────────────────────────

const testSchema: SchemaMap = {
  subject: { description: 'Subject line', type: 'string', required: true },
  score: { description: 'Score', type: 'number', required: true },
  active: { description: 'Is active', type: 'boolean', required: false, default: false },
  tags: { description: 'Tags', type: 'string[]', required: false, default: [] },
  status: {
    description: 'Status',
    type: 'string',
    required: true,
    enumValues: ['open', 'closed', 'pending'],
  },
};

const testDefaults = {
  subject: '',
  score: 0,
  active: false,
  tags: [] as string[],
  status: 'pending',
};

// ─── JSON Parsing ────────────────────────────────────────────────────

describe('parseLLMJson — JSON parsing', () => {
  it('parses clean JSON object', () => {
    const raw = '{"subject": "Hello", "score": 85, "active": true, "tags": ["a", "b"], "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, false);
    assert.equal(result.data.subject, 'Hello');
    assert.equal(result.data.score, 85);
    assert.equal(result.data.active, true);
    assert.deepEqual(result.data.tags, ['a', 'b']);
    assert.equal(result.data.status, 'open');
    assert.equal(result.errors.length, 0);
  });

  it('parses code-fenced JSON', () => {
    const raw = 'Here is my analysis:\n```json\n{"subject": "Test", "score": 50, "status": "closed"}\n```\nDone.';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, false);
    assert.equal(result.data.subject, 'Test');
    assert.equal(result.data.score, 50);
    assert.equal(result.data.status, 'closed');
  });

  it('parses code-fenced without json tag', () => {
    const raw = '```\n{"subject": "Bare", "score": 10, "status": "open"}\n```';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, false);
    assert.equal(result.data.subject, 'Bare');
  });

  it('extracts JSON embedded in text', () => {
    const raw = 'The result is: {"subject": "Embedded", "score": 99, "status": "open"} — that is my answer.';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, false);
    assert.equal(result.data.subject, 'Embedded');
    assert.equal(result.data.score, 99);
  });
});

// ─── Regex Fallback ──────────────────────────────────────────────────

describe('parseLLMJson — regex KEY:VALUE fallback', () => {
  it('falls back to regex when JSON is invalid', () => {
    const raw = 'SUBJECT: Hello World\nSCORE: 75\nACTIVE: true\nTAGS: a, b, c\nSTATUS: open';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, true);
    assert.equal(result.data.subject, 'Hello World');
    assert.equal(result.data.score, 75);
    assert.equal(result.data.status, 'open');
  });

  it('handles mixed-case keys in regex fallback', () => {
    const raw = 'Subject: Test\nScore: 42\nStatus: closed';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, true);
    assert.equal(result.data.subject, 'Test');
    assert.equal(result.data.score, 42);
    assert.equal(result.data.status, 'closed');
  });

  it('returns defaults when both parsers fail', () => {
    const raw = 'This is just random text with no structure.';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.usedFallback, true);
    assert.equal(result.data.subject, '');
    assert.equal(result.data.score, 0);
    assert.equal(result.data.status, 'pending');
    assert.ok(result.errors.length > 0);
  });
});

// ─── Type Coercion ───────────────────────────────────────────────────

describe('parseLLMJson — type coercion', () => {
  it('coerces string to number', () => {
    const raw = '{"subject": "Test", "score": "85", "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.score, 85);
  });

  it('coerces string "yes" to boolean true', () => {
    const raw = '{"subject": "Test", "score": 1, "active": "yes", "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.active, true);
  });

  it('coerces string "false" to boolean false', () => {
    const raw = '{"subject": "Test", "score": 1, "active": "false", "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.active, false);
  });

  it('splits comma-separated string into array', () => {
    const raw = '{"subject": "Test", "score": 1, "tags": "funding, hiring, expansion", "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.deepEqual(result.data.tags, ['funding', 'hiring', 'expansion']);
  });

  it('handles NaN number gracefully', () => {
    const raw = '{"subject": "Test", "score": "not-a-number", "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.score, 0); // falls back to default
    assert.ok(result.errors.some((e) => e.includes('Invalid number')));
  });
});

// ─── Enum Validation ─────────────────────────────────────────────────

describe('parseLLMJson — enum validation', () => {
  it('accepts valid enum value', () => {
    const raw = '{"subject": "Test", "score": 1, "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.status, 'open');
  });

  it('accepts case-insensitive enum value', () => {
    const raw = '{"subject": "Test", "score": 1, "status": "OPEN"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.status, 'open');
  });

  it('rejects invalid enum value and uses default', () => {
    const raw = '{"subject": "Test", "score": 1, "status": "invalid_status"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.equal(result.data.status, 'pending'); // default
    assert.ok(result.errors.some((e) => e.includes('Invalid enum value')));
  });
});

// ─── Missing Required Fields ─────────────────────────────────────────

describe('parseLLMJson — required fields', () => {
  it('reports missing required fields', () => {
    const raw = '{"score": 50, "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    assert.ok(result.errors.some((e) => e.includes('Missing required field: subject')));
  });

  it('does not report missing optional fields', () => {
    const raw = '{"subject": "Test", "score": 50, "status": "open"}';
    const result = parseLLMJson(raw, testSchema, testDefaults);

    // active and tags are optional — should not appear in errors
    assert.ok(!result.errors.some((e) => e.includes('active')));
    assert.ok(!result.errors.some((e) => e.includes('tags')));
  });
});

// ─── buildJsonInstruction ────────────────────────────────────────────

describe('buildJsonInstruction', () => {
  it('generates instruction containing all field keys', () => {
    const instruction = buildJsonInstruction(testSchema);

    assert.ok(instruction.includes('"subject"'));
    assert.ok(instruction.includes('"score"'));
    assert.ok(instruction.includes('"status"'));
    assert.ok(instruction.includes('valid JSON only'));
  });

  it('includes enum values for enum fields', () => {
    const instruction = buildJsonInstruction(testSchema);

    assert.ok(instruction.includes('open'));
    assert.ok(instruction.includes('closed'));
    assert.ok(instruction.includes('pending'));
  });
});
