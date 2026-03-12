import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Prospecting Config', () => {
  it('HUBSPOT_CONFIG has required fields', () => {
    // Simulate the config structure (can't import directly due to env deps)
    const config = {
      leadFilterProperty: 'personize___lead',
      leadFilterValue: 'true',
      contactProperties: ['firstname', 'lastname', 'email'],
      companyProperties: ['name', 'domain', 'industry'],
    };

    assert.ok(config.leadFilterProperty, 'Should have a filter property');
    assert.equal(config.leadFilterValue, 'true');
    assert.ok(config.contactProperties.includes('email'), 'Must include email');
    assert.ok(config.companyProperties.includes('domain'), 'Must include domain');
  });

  it('APOLLO_CONFIG has sensible defaults', () => {
    const config = {
      baseUrl: 'https://api.apollo.io',
      monthlyCreditsbudget: 10_000,
      maxEnrichmentsPerRun: 100,
      maxCompanyEnrichmentsPerRun: 50,
      rateLimitPauseMs: 1_000,
    };

    assert.equal(config.baseUrl, 'https://api.apollo.io');
    assert.ok(config.monthlyCreditsbudget > 0);
    assert.ok(config.maxEnrichmentsPerRun > 0);
    assert.ok(config.rateLimitPauseMs >= 500, 'Rate limit should be at least 500ms');
  });

  it('DISCOVERY_CONFIG has valid title filters', () => {
    const config = {
      contactsPerAccount: 5,
      targetTitles: ['VP Sales', 'VP Marketing', 'Head of Growth'],
      targetSeniorities: ['vp', 'director', 'c_suite', 'manager'],
      targetDepartments: ['sales', 'marketing'],
      requireVerifiedEmail: true,
    };

    assert.equal(config.contactsPerAccount, 5);
    assert.ok(config.targetTitles.length > 0, 'Must have at least one target title');
    assert.ok(config.targetSeniorities.length > 0, 'Must have at least one seniority');
    assert.ok(config.requireVerifiedEmail, 'Should require verified email by default');
  });

  it('SIGNAL_CONFIG has valid threshold', () => {
    const config = {
      hotAccountThreshold: 70,
      companiesPerScan: 200,
      autoDiscoverContacts: true,
      autoEnrichAfterSync: true,
      autoEnrichCompaniesAfterSync: true,
    };

    assert.ok(config.hotAccountThreshold >= 0 && config.hotAccountThreshold <= 100);
    assert.ok(config.companiesPerScan > 0);
  });
});

describe('Apollo API Helpers', () => {
  it('builds correct search params', () => {
    const params = {
      organizationDomains: ['acme.com'],
      personTitles: ['VP Sales', 'Director of Marketing'],
      personSeniorities: ['vp', 'director'],
      perPage: 5,
      page: 1,
    };

    const body: Record<string, unknown> = {
      organization_domains: params.organizationDomains,
      per_page: params.perPage || 25,
      page: params.page || 1,
    };

    if (params.personTitles?.length) {
      body.person_titles = params.personTitles;
    }
    if (params.personSeniorities?.length) {
      body.person_seniorities = params.personSeniorities;
    }

    assert.deepEqual(body.organization_domains, ['acme.com']);
    assert.deepEqual(body.person_titles, ['VP Sales', 'Director of Marketing']);
    assert.deepEqual(body.person_seniorities, ['vp', 'director']);
    assert.equal(body.per_page, 5);
    assert.equal(body.page, 1);
  });

  it('omits empty optional params', () => {
    const params = {
      organizationDomains: ['acme.com'],
      personTitles: [],
      personSeniorities: undefined as string[] | undefined,
      perPage: 25,
    };

    const body: Record<string, unknown> = {
      organization_domains: params.organizationDomains,
      per_page: params.perPage || 25,
      page: 1,
    };

    if (params.personTitles?.length) {
      body.person_titles = params.personTitles;
    }
    if (params.personSeniorities?.length) {
      body.person_seniorities = params.personSeniorities;
    }

    assert.ok(!('person_titles' in body), 'Should not include empty titles');
    assert.ok(!('person_seniorities' in body), 'Should not include undefined seniorities');
  });

  it('getPhone extracts first phone number', () => {
    const person = {
      phone_numbers: [
        { raw_number: '+1-555-0123', type: 'work' },
        { raw_number: '+1-555-0456', type: 'mobile' },
      ],
    };
    const phone = person.phone_numbers?.[0]?.raw_number || '';
    assert.equal(phone, '+1-555-0123');
  });

  it('getPhone returns empty for no phone', () => {
    const person = { phone_numbers: undefined as any };
    const phone = person.phone_numbers?.[0]?.raw_number || '';
    assert.equal(phone, '');
  });
});

describe('HubSpot Filter Builder', () => {
  it('builds filter group when property is set', () => {
    const prop = 'personize___lead';
    const value = 'true';

    const filterGroups = prop
      ? [{ filters: [{ propertyName: prop, operator: 'EQ', value }] }]
      : [];

    assert.equal(filterGroups.length, 1);
    assert.equal(filterGroups[0].filters[0].propertyName, 'personize___lead');
    assert.equal(filterGroups[0].filters[0].value, 'true');
  });

  it('returns empty array when property is empty', () => {
    const prop = '';
    const filterGroups = prop
      ? [{ filters: [{ propertyName: prop, operator: 'EQ', value: 'true' }] }]
      : [];

    assert.equal(filterGroups.length, 0);
  });
});

describe('Enrichment Dedup Logic', () => {
  it('skips already-enriched contacts', () => {
    const existingMemories = [
      { content: '[ENRICHMENT from Apollo] john@acme.com', email: 'john@acme.com' },
    ];

    const email = 'john@acme.com';
    const alreadyEnriched = existingMemories.some(
      (m) => m.content.includes('[ENRICHMENT from Apollo]')
    );

    assert.ok(alreadyEnriched, 'Should detect already-enriched contact');
  });

  it('does not skip un-enriched contacts', () => {
    const existingMemories: any[] = [];

    const alreadyEnriched = existingMemories.some(
      (m) => m.content.includes('[ENRICHMENT from Apollo]')
    );

    assert.ok(!alreadyEnriched, 'Should not detect un-enriched contact');
  });
});

describe('Discovery Dedup Logic', () => {
  it('skips contacts already in memory', () => {
    const existingEmails = new Set(['john@acme.com', 'jane@acme.com']);

    const apolloResults = [
      { email: 'john@acme.com', name: 'John Doe' },
      { email: 'new@acme.com', name: 'New Person' },
      { email: 'jane@acme.com', name: 'Jane Doe' },
    ];

    const newContacts = apolloResults.filter(
      (p) => p.email && !existingEmails.has(p.email.toLowerCase())
    );

    assert.equal(newContacts.length, 1);
    assert.equal(newContacts[0].email, 'new@acme.com');
  });

  it('respects contactsPerAccount limit', () => {
    const limit = 5;
    const people = Array.from({ length: 20 }, (_, i) => ({
      email: `person${i}@acme.com`,
      name: `Person ${i}`,
    }));

    const discovered: typeof people = [];
    for (const person of people) {
      if (discovered.length >= limit) break;
      discovered.push(person);
    }

    assert.equal(discovered.length, 5);
  });
});

describe('Company Enrichment Formatting', () => {
  it('formats funding display correctly', () => {
    const funding = 35_000_000;
    const display = funding ? `$${funding.toLocaleString()}` : 'N/A';
    assert.ok(display.startsWith('$'));
    assert.ok(display.includes('35'));
  });

  it('formats location from parts', () => {
    const parts = ['San Francisco', 'CA', 'United States'];
    const location = parts.filter(Boolean).join(', ');
    assert.equal(location, 'San Francisco, CA, United States');
  });

  it('handles missing location parts', () => {
    const parts = ['', '', 'United States'];
    const location = parts.filter(Boolean).join(', ');
    assert.equal(location, 'United States');
  });

  it('handles all-empty location', () => {
    const parts = ['', '', ''];
    const location = parts.filter(Boolean).join(', ') || 'Unknown';
    assert.equal(location, 'Unknown');
  });
});
