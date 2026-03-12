import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLLMJson, buildJsonInstruction } from '../../lib/llm-output.js';
import { OUTREACH_EMAIL_SCHEMA, OUTREACH_EMAIL_DEFAULTS } from '../../lib/llm-schemas.js';
import { validateEmailHtml } from '../../lib/email-html.js';
import { SAMPLE_OUTREACH_JSON } from './mocks.js';

describe('Outreach Pipeline — JSON Parsing', () => {
  it('parses well-formed outreach JSON into all four fields', () => {
    const { data, usedFallback, errors } = parseLLMJson(
      SAMPLE_OUTREACH_JSON,
      OUTREACH_EMAIL_SCHEMA,
      OUTREACH_EMAIL_DEFAULTS,
    );

    assert.equal(usedFallback, false, 'Should use JSON path, not regex fallback');
    assert.equal(errors.length, 0, 'Should have no parse errors');
    assert.equal(data.subject, 'Quick thought on your Series B');
    assert.ok(data.body_html.includes('<b>Series B</b>'));
    assert.ok(data.body_text.includes('Series B'));
    assert.equal(data.angle, 'Post-Series B sales scaling');
  });

  it('parses JSON wrapped in code fences', () => {
    const fenced = '```json\n' + SAMPLE_OUTREACH_JSON + '\n```';
    const { data, usedFallback } = parseLLMJson(
      fenced,
      OUTREACH_EMAIL_SCHEMA,
      OUTREACH_EMAIL_DEFAULTS,
    );

    assert.equal(usedFallback, false);
    assert.equal(data.subject, 'Quick thought on your Series B');
  });

  it('falls back to KEY:VALUE regex for legacy-formatted LLM output', () => {
    const legacy = `SUBJECT: Fallback subject line
BODY_HTML: <p>Hello from fallback</p>
BODY_TEXT: Hello from fallback
ANGLE: Testing the regex path`;

    const { data, usedFallback } = parseLLMJson(
      legacy,
      OUTREACH_EMAIL_SCHEMA,
      OUTREACH_EMAIL_DEFAULTS,
    );

    assert.equal(usedFallback, true, 'Should use regex fallback');
    assert.equal(data.subject, 'Fallback subject line');
    assert.equal(data.angle, 'Testing the regex path');
  });

  it('returns defaults when parsing completely fails', () => {
    const garbage = 'The LLM returned nothing useful here.';
    const { data, usedFallback, errors } = parseLLMJson(
      garbage,
      OUTREACH_EMAIL_SCHEMA,
      OUTREACH_EMAIL_DEFAULTS,
    );

    assert.equal(usedFallback, true);
    assert.ok(errors.length > 0, 'Should report errors');
    assert.equal(data.subject, '');
    assert.equal(data.body_html, '');
  });
});

describe('Outreach Pipeline — HTML Validation', () => {
  it('accepts clean outreach HTML with allowed tags', () => {
    const parsed = JSON.parse(SAMPLE_OUTREACH_JSON);
    const result = validateEmailHtml(parsed.body_html);

    assert.equal(result.valid, true, 'Clean HTML should pass validation');
    assert.ok(result.sanitized.includes('<b>Series B</b>'));
  });

  it('strips disallowed tags from LLM output', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script><div>world</div>';
    const result = validateEmailHtml(dirty);

    assert.ok(!result.sanitized.includes('<script>'), 'Should strip <script>');
    assert.ok(!result.sanitized.includes('<div>'), 'Should strip <div>');
    assert.ok(result.sanitized.includes('<p>Hello</p>'), 'Should keep <p>');
    assert.ok(result.errors.length > 0, 'Should report stripping');
  });

  it('strips inline styles and event handlers', () => {
    const styled = '<p style="color:red" onclick="hack()">Hi</p>';
    const result = validateEmailHtml(styled);

    assert.ok(!result.sanitized.includes('style='), 'Should strip styles');
    assert.ok(!result.sanitized.includes('onclick'), 'Should strip handlers');
    assert.ok(result.sanitized.includes('<p>Hi</p>'));
  });

  it('rejects empty HTML', () => {
    const result = validateEmailHtml('');
    assert.equal(result.valid, false);
    assert.equal(result.sanitized, '');
  });
});

describe('Outreach Pipeline — Prompt Instruction Builder', () => {
  it('generates instruction text containing all schema field keys', () => {
    const instruction = buildJsonInstruction(OUTREACH_EMAIL_SCHEMA);

    assert.ok(instruction.includes('subject'), 'Should mention subject');
    assert.ok(instruction.includes('body_html'), 'Should mention body_html');
    assert.ok(instruction.includes('body_text'), 'Should mention body_text');
    assert.ok(instruction.includes('angle'), 'Should mention angle');
  });

  it('includes the JSON-only directive', () => {
    const instruction = buildJsonInstruction(OUTREACH_EMAIL_SCHEMA);

    assert.ok(
      instruction.includes('valid JSON only'),
      'Should instruct LLM to respond with JSON only',
    );
  });
});

describe('Outreach Pipeline — Full Flow', () => {
  it('mock JSON → parse → validate HTML → all fields present', () => {
    // Step 1: Parse the mock LLM response
    const { data, usedFallback, errors: parseErrors } = parseLLMJson(
      SAMPLE_OUTREACH_JSON,
      OUTREACH_EMAIL_SCHEMA,
      OUTREACH_EMAIL_DEFAULTS,
    );
    assert.equal(usedFallback, false);
    assert.equal(parseErrors.length, 0);

    // Step 2: Validate and sanitize the HTML body
    const htmlResult = validateEmailHtml(data.body_html);
    assert.equal(htmlResult.valid, true);

    // Step 3: Verify all required fields are non-empty
    assert.ok(data.subject.length > 0, 'subject must be non-empty');
    assert.ok(htmlResult.sanitized.length > 0, 'sanitized HTML must be non-empty');
    assert.ok(data.body_text.length > 0, 'body_text must be non-empty');
    assert.ok(data.angle.length > 0, 'angle must be non-empty');

    // Step 4: The blank-email guard should NOT trigger
    const shouldReject = !data.subject || !data.body_text;
    assert.equal(shouldReject, false, 'Valid email should not be rejected');
  });
});
