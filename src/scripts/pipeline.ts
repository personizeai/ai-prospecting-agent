#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PIPELINES, PIPELINE_NAMES } from '../pipelines/registry.js';
import { logger } from '../lib/logger.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean' },
    input: { type: 'string', short: 'i' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.list) {
  console.log('Available pipelines:');
  for (const name of PIPELINE_NAMES) {
    console.log(`  ${name.padEnd(32)} ${PIPELINES[name].description}`);
  }
  process.exit(0);
}

const pipelineName = positionals[0];
if (!pipelineName || values.help) {
  console.error(`Usage:
  pipeline <name> [--input '<json>']
  pipeline --list            # show all pipelines
  pipeline <name> -i '<json>' # short form for --input

Examples:
  pipeline research-company -i '{"domain":"personize.ai"}'
  pipeline detect-signals
  pipeline --list`);
  process.exit(values.help ? 0 : 1);
}

const entry = PIPELINES[pipelineName];
if (!entry) {
  console.error(`Unknown pipeline: ${pipelineName}. Run "pipeline --list" to see available pipelines.`);
  process.exit(1);
}

let input: unknown = {};
if (values.input) {
  try {
    input = JSON.parse(values.input);
  } catch (err) {
    console.error(`Invalid JSON in --input: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

entry
  .run(input)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    logger.error(`Pipeline ${pipelineName} failed`, { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
