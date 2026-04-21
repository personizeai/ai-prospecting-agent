#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { researchCompany } from './research-company.js';
import { logger } from '../lib/logger.js';

const { values } = parseArgs({
  options: {
    domain: { type: 'string', short: 'd' },
    name: { type: 'string', short: 'n' },
  },
  strict: true,
});

if (!values.domain) {
  console.error('Usage: research-company --domain <domain> [--name <company-name>]');
  console.error('  -d, --domain   Company domain to research (required)');
  console.error('  -n, --name     Company display name (defaults to domain if omitted)');
  process.exit(1);
}

const domain = values.domain;
const companyName = values.name ?? domain;

researchCompany(domain, companyName)
  .then((result) => {
    if (result === null) {
      console.log(JSON.stringify({ domain, result: null, reason: 'Tavily not configured or company researched recently' }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  })
  .catch((err) => {
    logger.error('research-company failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
