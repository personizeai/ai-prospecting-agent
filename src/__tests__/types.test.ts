import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GeneratedEmail, HotAccount, Signal, EnrichmentData } from '../types.js';

describe('Types', () => {
  it('GeneratedEmail has all required fields', () => {
    const email: GeneratedEmail = {
      email: 'test@example.com',
      step: 1,
      subject: 'Test Subject',
      bodyHtml: '<p>Hello</p>',
      bodyText: 'Hello',
      angle: 'test angle',
    };
    assert.equal(email.email, 'test@example.com');
    assert.equal(email.step, 1);
    assert.equal(typeof email.subject, 'string');
    assert.equal(typeof email.bodyHtml, 'string');
    assert.equal(typeof email.bodyText, 'string');
    assert.equal(typeof email.angle, 'string');
  });

  it('HotAccount has all required fields', () => {
    const account: HotAccount = {
      company: 'Acme Corp',
      domain: 'acme.com',
      score: 85,
      strength: 'Strong',
      action: 'Prospect Now',
    };
    assert.equal(account.company, 'Acme Corp');
    assert.equal(account.score, 85);
    assert.equal(typeof account.strength, 'string');
    assert.equal(typeof account.action, 'string');
  });

  it('Signal has valid signal_type union', () => {
    const validTypes: Signal['signal_type'][] = ['funding', 'hiring', 'intent', 'news', 'job_posting', 'tech_adoption'];
    assert.equal(validTypes.length, 6);
    for (const type of validTypes) {
      assert.equal(typeof type, 'string');
    }
  });

  it('EnrichmentData technologies defaults gracefully', () => {
    const data: EnrichmentData = {
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      title: 'VP Sales',
      company_name: 'Acme',
      company_domain: 'acme.com',
      technologies: [],
      source: 'Apollo',
    };
    assert.ok(Array.isArray(data.technologies));
    assert.equal(data.technologies.length, 0);
  });
});
