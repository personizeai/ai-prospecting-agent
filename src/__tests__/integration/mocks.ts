/**
 * Mock factories and fixtures for integration tests.
 *
 * Creates fake Personize client responses so pipelines can be tested
 * end-to-end without network calls.
 */

export function createMockClient() {
  return {
    ai: {
      prompt: async (params: any) => ({
        data: '{}', // Override per test
      }),
      smartGuidelines: async () => ({
        data: { compiledContext: 'Mock brand voice guidelines...' },
      }),
    },
    memory: {
      recall: async () => ({ data: [] }),
      memorize: async () => ({ data: {} }),
      smartDigest: async () => ({
        data: {
          compiledContext: 'Mock contact profile...',
          properties: {
            pending_tasks: { value: [] },
            open_issues: { value: [] },
            emails_sent: { value: 0 },
            last_sent_at: { value: '' },
            sequence_status: { value: 'Active' },
            messages_sent: { value: [] },
            context: { value: '' },
          },
        },
      }),
      search: async () => ({ data: [] }),
      memorizeBatch: async () => ({ data: {} }),
      // Memory CRUD methods (used by workspace layer)
      update: async () => ({ data: { success: true, previousValue: null, newValue: null, version: 1, stores: { snapshot: 'updated', lancedb: 'updated', freeform: 'skipped' } } }),
      bulkUpdate: async () => ({ data: { success: true, results: [], version: 1 } }),
      filterByProperty: async () => ({ data: { records: [], totalMatched: 0 } }),
      propertyHistory: async () => ({ data: { entries: [] } }),
      deleteRecord: async () => ({ data: { success: true, deletedCount: 0 } }),
      cancelDeletion: async () => ({ data: { success: true, restoredCounts: { snapshot: 'restored', freeform: 'restored', lancedb: 'restored' } } }),
    },
    guidelines: {
      list: async () => ({ data: [] }),
      create: async () => ({ data: {} }),
    },
    me: async () => ({
      data: { organization: 'Test Org', plan: { limits: { maxApiCallsPerMinute: 100 } } },
    }),
  };
}

// ─── Sample Fixtures ──────────────────────────────────────────────────

export const SAMPLE_OUTREACH_JSON = JSON.stringify({
  subject: "Quick thought on your Series B",
  body_html: "<p>Hi Sarah,</p><p>Congrats on the <b>Series B</b>. Scaling sales teams post-funding is our sweet spot.</p><p>Worth a quick look?</p><p>James</p>",
  body_text: "Hi Sarah,\n\nCongrats on the Series B. Scaling sales teams post-funding is our sweet spot.\n\nWorth a quick look?\n\nJames",
  angle: "Post-Series B sales scaling",
});

export const SAMPLE_SIGNAL_JSON = JSON.stringify({
  icp_fit_score: 82,
  signal_strength: "Strong",
  buying_window: true,
  reasoning: "Recent Series B and hiring 5 sales roles indicates growth phase.",
  recommended_action: "Prospect Now",
});

export const SAMPLE_REPLY_POSITIVE_JSON = JSON.stringify({
  sentiment: "positive",
  summary: "Lead wants to schedule a demo call next week",
  key_points: ["interested in demo", "available next week", "wants pricing"],
  urgency: "high",
  next_action: "Schedule a 15-min demo call",
  suggested_response: "Great to hear! I have availability Tuesday or Thursday at 2pm — which works better?",
  return_date: "N/A",
  referred_contact: "N/A",
});

export const SAMPLE_REPLY_NEGATIVE_JSON = JSON.stringify({
  sentiment: "negative",
  summary: "Not interested, asked to be removed",
  key_points: ["not interested", "remove from list"],
  urgency: "low",
  next_action: "Remove from all sequences",
  suggested_response: "N/A",
  return_date: "N/A",
  referred_contact: "N/A",
});
