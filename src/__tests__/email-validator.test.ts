import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isValidEmail, validateEmail } from '../lib/email-validator.js';

// ─── isValidEmail ────────────────────────────────────────────────────

describe('isValidEmail — format validation', () => {
  it('accepts standard email', () => {
    assert.equal(isValidEmail('user@example.com'), true);
  });

  it('accepts email with dots in local part', () => {
    assert.equal(isValidEmail('first.last@example.com'), true);
  });

  it('accepts email with plus sign', () => {
    assert.equal(isValidEmail('user+tag@example.com'), true);
  });

  it('accepts email with subdomain', () => {
    assert.equal(isValidEmail('user@mail.example.co.uk'), true);
  });

  it('rejects empty string', () => {
    assert.equal(isValidEmail(''), false);
  });

  it('rejects null/undefined', () => {
    assert.equal(isValidEmail(null as unknown as string), false);
    assert.equal(isValidEmail(undefined as unknown as string), false);
  });

  it('rejects email without @', () => {
    assert.equal(isValidEmail('userexample.com'), false);
  });

  it('rejects email without domain', () => {
    assert.equal(isValidEmail('user@'), false);
  });

  it('rejects email without TLD', () => {
    assert.equal(isValidEmail('user@example'), false);
  });

  it('rejects email with consecutive dots', () => {
    assert.equal(isValidEmail('user..name@example.com'), false);
  });

  it('rejects email starting with dot', () => {
    assert.equal(isValidEmail('.user@example.com'), false);
  });

  it('rejects email ending with dot in local', () => {
    assert.equal(isValidEmail('user.@example.com'), false);
  });

  it('rejects email over 254 characters', () => {
    const longLocal = 'a'.repeat(200);
    assert.equal(isValidEmail(`${longLocal}@example.com`), false);
  });

  it('rejects email with local part over 64 characters', () => {
    const longLocal = 'a'.repeat(65);
    assert.equal(isValidEmail(`${longLocal}@example.com`), false);
  });
});

// ─── validateEmail — disposable domains ──────────────────────────────

describe('validateEmail — disposable domain detection', () => {
  it('flags mailinator as disposable', () => {
    const result = validateEmail('test@mailinator.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'disposable_domain');
  });

  it('flags guerrillamail as disposable', () => {
    const result = validateEmail('test@guerrillamail.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'disposable_domain');
  });

  it('flags yopmail as disposable', () => {
    const result = validateEmail('test@yopmail.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'disposable_domain');
  });

  it('accepts legitimate domain', () => {
    const result = validateEmail('user@company.com');
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });
});

// ─── validateEmail — role accounts ───────────────────────────────────

describe('validateEmail — role account detection', () => {
  it('flags info@ as role account', () => {
    const result = validateEmail('info@example.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'role_account');
  });

  it('flags sales@ as role account', () => {
    const result = validateEmail('sales@example.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'role_account');
  });

  it('flags noreply@ as role account', () => {
    const result = validateEmail('noreply@example.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'role_account');
  });

  it('flags admin@ as role account', () => {
    const result = validateEmail('admin@example.com');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'role_account');
  });

  it('accepts personal addresses with role words in them', () => {
    // "salesteam" is not an exact match for "sales"
    const result = validateEmail('salesteam@example.com');
    assert.equal(result.valid, true);
  });

  it('accepts normal personal email', () => {
    const result = validateEmail('john.smith@company.com');
    assert.equal(result.valid, true);
  });
});

// ─── validateEmail — edge cases ──────────────────────────────────────

describe('validateEmail — edge cases', () => {
  it('returns missing reason for empty string', () => {
    const result = validateEmail('');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'missing');
  });

  it('returns invalid_format for malformed email', () => {
    const result = validateEmail('not-an-email');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'invalid_format');
  });

  it('handles email with whitespace (trimmed)', () => {
    const result = validateEmail('  user@example.com  ');
    assert.equal(result.valid, true);
  });

  it('is case-insensitive', () => {
    const result = validateEmail('User@Example.COM');
    assert.equal(result.valid, true);
  });
});
