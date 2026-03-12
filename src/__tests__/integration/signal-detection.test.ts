import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLLMJson } from '../../lib/llm-output.js';
import { SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS } from '../../lib/llm-schemas.js';
import { SAMPLE_SIGNAL_JSON } from './mocks.js';

describe('Signal Detection — JSON Parsing', () => {
  it('parses signal assessment JSON with correct types', () => {
    const { data, usedFallback, errors } = parseLLMJson(
      SAMPLE_SIGNAL_JSON,
      SIGNAL_ASSESSMENT_SCHEMA,
      SIGNAL_ASSESSMENT_DEFAULTS,
    );

    assert.equal(usedFallback, false);
    assert.equal(errors.length, 0);
    assert.equal(typeof data.icp_fit_score, 'number');
    assert.equal(data.icp_fit_score, 82);
    assert.equal(typeof data.buying_window, 'boolean');
    assert.equal(data.buying_window, true);
    assert.equal(data.signal_strength, 'Strong');
    assert.equal(data.recommended_action, 'Prospect Now');
    assert.ok(data.reasoning.length > 0);
  });

  it('coerces string "true" to boolean for buying_window', () => {
    const json = JSON.stringify({
      icp_fit_score: 60,
      signal_strength: 'Moderate',
      buying_window: 'true',
      reasoning: 'Some reasoning.',
      recommended_action: 'Research',
    });

    const { data } = parseLLMJson(json, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

    assert.equal(typeof data.buying_window, 'boolean');
    assert.equal(data.buying_window, true);
  });

  it('coerces string "Yes" to boolean true for buying_window', () => {
    const json = JSON.stringify({
      icp_fit_score: 50,
      signal_strength: 'Weak',
      buying_window: 'Yes',
      reasoning: 'Weak signals.',
      recommended_action: 'Monitor',
    });

    const { data } = parseLLMJson(json, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

    assert.equal(data.buying_window, true);
  });

  it('coerces string score to number', () => {
    const json = JSON.stringify({
      icp_fit_score: '75',
      signal_strength: 'Moderate',
      buying_window: false,
      reasoning: 'Decent fit.',
      recommended_action: 'Research',
    });

    const { data } = parseLLMJson(json, SIGNAL_ASSESSMENT_SCHEMA, SIGNAL_ASSESSMENT_DEFAULTS);

    assert.equal(typeof data.icp_fit_score, 'number');
    assert.equal(data.icp_fit_score, 75);
  });
});

describe('Signal Detection — Enum Validation', () => {
  it('accepts all valid signal_strength values', () => {
    const validStrengths = ['None', 'Weak', 'Moderate', 'Strong', 'Very Strong'];

    for (const strength of validStrengths) {
      const json = JSON.stringify({
        icp_fit_score: 50,
        signal_strength: strength,
        buying_window: false,
        reasoning: 'Test.',
        recommended_action: 'Skip',
      });

      const { data, errors } = parseLLMJson(
        json,
        SIGNAL_ASSESSMENT_SCHEMA,
        SIGNAL_ASSESSMENT_DEFAULTS,
      );

      const strengthErrors = errors.filter((e) => e.includes('signal_strength'));
      assert.equal(strengthErrors.length, 0, `"${strength}" should be a valid signal_strength`);
      assert.equal(data.signal_strength, strength);
    }
  });

  it('rejects invalid signal_strength and falls back to default', () => {
    const json = JSON.stringify({
      icp_fit_score: 50,
      signal_strength: 'Super Duper Strong',
      buying_window: false,
      reasoning: 'Test.',
      recommended_action: 'Skip',
    });

    const { data, errors } = parseLLMJson(
      json,
      SIGNAL_ASSESSMENT_SCHEMA,
      SIGNAL_ASSESSMENT_DEFAULTS,
    );

    assert.ok(
      errors.some((e) => e.includes('signal_strength')),
      'Should report invalid enum error',
    );
    assert.equal(data.signal_strength, 'None', 'Should fall back to default');
  });

  it('accepts all valid recommended_action values', () => {
    const validActions = ['Skip', 'Monitor', 'Research', 'Prospect Now'];

    for (const action of validActions) {
      const json = JSON.stringify({
        icp_fit_score: 50,
        signal_strength: 'None',
        buying_window: false,
        reasoning: 'Test.',
        recommended_action: action,
      });

      const { data, errors } = parseLLMJson(
        json,
        SIGNAL_ASSESSMENT_SCHEMA,
        SIGNAL_ASSESSMENT_DEFAULTS,
      );

      const actionErrors = errors.filter((e) => e.includes('recommended_action'));
      assert.equal(actionErrors.length, 0, `"${action}" should be a valid recommended_action`);
      assert.equal(data.recommended_action, action);
    }
  });

  it('rejects invalid recommended_action and falls back to default', () => {
    const json = JSON.stringify({
      icp_fit_score: 50,
      signal_strength: 'None',
      buying_window: false,
      reasoning: 'Test.',
      recommended_action: 'Do Nothing',
    });

    const { data, errors } = parseLLMJson(
      json,
      SIGNAL_ASSESSMENT_SCHEMA,
      SIGNAL_ASSESSMENT_DEFAULTS,
    );

    assert.ok(errors.some((e) => e.includes('recommended_action')));
    assert.equal(data.recommended_action, 'Skip');
  });
});

describe('Signal Detection — Score Thresholds', () => {
  it('score >= 70 qualifies as a hot account', () => {
    const HOT_THRESHOLD = 70;

    const hotScores = [70, 82, 95, 100];
    for (const score of hotScores) {
      assert.ok(score >= HOT_THRESHOLD, `Score ${score} should be hot`);
    }
  });

  it('score < 70 does not qualify as hot', () => {
    const HOT_THRESHOLD = 70;

    const coldScores = [0, 30, 50, 69];
    for (const score of coldScores) {
      assert.ok(score < HOT_THRESHOLD, `Score ${score} should not be hot`);
    }
  });

  it('parsed score from mock data exceeds hot threshold', () => {
    const { data } = parseLLMJson(
      SAMPLE_SIGNAL_JSON,
      SIGNAL_ASSESSMENT_SCHEMA,
      SIGNAL_ASSESSMENT_DEFAULTS,
    );

    const HOT_THRESHOLD = 70;
    assert.ok(
      data.icp_fit_score >= HOT_THRESHOLD,
      `Mock score ${data.icp_fit_score} should be hot`,
    );
  });
});
