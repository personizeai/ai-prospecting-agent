import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractCompanyDomain, extractCompanyName } from '../lib/company-search-result.js';

describe('Company Search Result Helpers', () => {
  it('extracts domain and name from mainProperties kebab-case fields', () => {
    const company = {
      mainProperties: {
        'website-url': 'https://vividseats.com',
        'company-name': 'Vivid Seats',
      },
    };

    assert.equal(extractCompanyDomain(company), 'https://vividseats.com');
    assert.equal(extractCompanyName(company), 'Vivid Seats');
  });

  it('extracts values nested under properties.value', () => {
    const company = {
      properties: {
        website_url: { value: 'https://dermani.com' },
        company_name: { value: 'Dermani Medspa' },
      },
    };

    assert.equal(extractCompanyDomain(company), 'https://dermani.com');
    assert.equal(extractCompanyName(company), 'Dermani Medspa');
  });

  it('falls back to the provided fallback name when no company name exists', () => {
    const company = {
      mainProperties: {
        website_url: 'https://example.com',
      },
    };

    assert.equal(extractCompanyName(company, 'example.com'), 'example.com');
  });

  it('returns unknown when no usable fields are available', () => {
    assert.equal(extractCompanyDomain({}), undefined);
    assert.equal(extractCompanyName({}), 'unknown');
  });
});
