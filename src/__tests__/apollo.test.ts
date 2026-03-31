import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { APOLLO_PEOPLE_SEARCH_ENDPOINT, buildPeopleSearchBody } from '../lib/apollo.js';

describe('Apollo Search Helpers', () => {
  it('uses the non-deprecated people search endpoint', () => {
    assert.equal(APOLLO_PEOPLE_SEARCH_ENDPOINT, '/v1/mixed_people/api_search');
  });

  it('builds a request body with populated optional filters', () => {
    const body = buildPeopleSearchBody({
      organizationDomains: ['acme.com'],
      personTitles: ['VP Sales'],
      personSeniorities: ['vp'],
      personDepartments: ['sales'],
      perPage: 5,
      page: 2,
    });

    assert.deepEqual(body, {
      organization_domains: ['acme.com'],
      person_titles: ['VP Sales'],
      person_seniorities: ['vp'],
      person_departments: ['sales'],
      per_page: 5,
      page: 2,
    });
  });

  it('omits empty optional arrays from the request body', () => {
    const body = buildPeopleSearchBody({
      organizationDomains: ['acme.com'],
      personTitles: [],
      personSeniorities: [],
      personDepartments: [],
    });

    assert.deepEqual(body, {
      organization_domains: ['acme.com'],
      per_page: 25,
      page: 1,
    });
  });
});
