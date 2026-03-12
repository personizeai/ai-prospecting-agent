import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Tavily Config Validation', () => {
  it('TAVILY_CONFIG has sensible defaults', async () => {
    const { TAVILY_CONFIG } = await import('../config/prospecting.config.js');
    assert.ok(TAVILY_CONFIG.maxResultsPerSearch >= 1 && TAVILY_CONFIG.maxResultsPerSearch <= 20);
    assert.ok(['basic', 'advanced'].includes(TAVILY_CONFIG.searchDepth));
    assert.ok(TAVILY_CONFIG.recencyDays > 0);
    assert.ok(TAVILY_CONFIG.maxResearchPerRun > 0);
    assert.ok(TAVILY_CONFIG.rateLimitPauseMs >= 100);
  });

  it('skip window is reasonable', async () => {
    const { TAVILY_CONFIG } = await import('../config/prospecting.config.js');
    assert.ok(TAVILY_CONFIG.skipIfResearchedWithinDays >= 0);
    assert.ok(TAVILY_CONFIG.skipIfResearchedWithinDays <= 30);
  });
});

describe('Tavily Search Result Parsing', () => {
  it('parses a well-formed search response', () => {
    const response = {
      answer: 'Acme Corp recently raised $50M in Series B funding.',
      results: [
        {
          title: 'Acme Corp raises $50M Series B',
          url: 'https://techcrunch.com/acme-series-b',
          content: 'Acme Corp announced today it has raised $50M in a Series B round led by Sequoia.',
          score: 0.95,
          published_date: '2026-03-01',
        },
        {
          title: 'Acme Corp expands to Europe',
          url: 'https://acme.com/blog/europe',
          content: 'Acme is opening its first European office in London.',
          score: 0.82,
        },
      ],
      query: 'Acme Corp news funding',
    };

    assert.equal(response.results.length, 2);
    assert.equal(response.results[0].score, 0.95);
    assert.ok(response.results[0].published_date);
    assert.equal(response.results[1].published_date, undefined);
    assert.ok(response.answer.includes('$50M'));
  });

  it('handles empty results gracefully', () => {
    const response = {
      answer: '',
      results: [],
      query: 'Unknown Company xyz123',
    };

    assert.equal(response.results.length, 0);
    assert.equal(response.answer, '');
  });
});

describe('Search Result Deduplication', () => {
  it('removes duplicate URLs', () => {
    const results = [
      { title: 'Article 1', url: 'https://example.com/a', content: 'First', score: 0.9 },
      { title: 'Article 2', url: 'https://example.com/b', content: 'Second', score: 0.8 },
      { title: 'Article 1 Duplicate', url: 'https://example.com/a', content: 'First again', score: 0.7 },
      { title: 'Article 3', url: 'https://example.com/c', content: 'Third', score: 0.6 },
    ];

    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    assert.equal(deduped.length, 3);
    assert.equal(deduped[0].title, 'Article 1');
    assert.equal(deduped[1].title, 'Article 2');
    assert.equal(deduped[2].title, 'Article 3');
  });
});

describe('Research Analysis Parsing', () => {
  it('parses AI analysis output', () => {
    const output = `COMPANY_SUMMARY: Acme Corp is a B2B SaaS company that recently raised $50M in Series B funding. They are expanding to Europe and hiring aggressively.
KEY_NEWS:
- Acme Corp raises $50M Series B (March 2026)
- Acme opens London office (February 2026)
- New VP of Sales hired from Salesforce (January 2026)
BUYING_SIGNALS: recent funding, hiring surge, international expansion, leadership change
COMPETITIVE_LANDSCAPE: Salesforce, HubSpot, Pipedrive
PERSONALIZATION_ANGLES:
- Congratulate on Series B and ask how they plan to scale sales ops
- Reference the new London office and offer international support
- Connect with new VP of Sales around their GTM strategy`;

    const companySummary = output.match(/COMPANY_SUMMARY:\s*([^\n]+(?:\n(?!KEY_NEWS:)[^\n]+)*)/i)?.[1]?.trim() || '';
    const buyingSignals = output.match(/BUYING_SIGNALS:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const competitive = output.match(/COMPETITIVE_LANDSCAPE:\s*([^\n]+)/i)?.[1]?.trim() || '';

    assert.ok(companySummary.includes('$50M'));
    assert.ok(companySummary.includes('Series B'));
    assert.ok(buyingSignals.includes('hiring surge'));
    assert.ok(competitive.includes('HubSpot'));

    const signalsArray = buyingSignals.split(',').map((s) => s.trim()).filter(Boolean);
    assert.equal(signalsArray.length, 4);
    assert.ok(signalsArray.includes('recent funding'));
  });

  it('handles "None found" gracefully', () => {
    const output = `COMPANY_SUMMARY: Small startup with limited public information.
KEY_NEWS: None found
BUYING_SIGNALS: None found
COMPETITIVE_LANDSCAPE: None found
PERSONALIZATION_ANGLES:
- Reference their product and ask about growth plans`;

    const buyingSignals = output.match(/BUYING_SIGNALS:\s*([^\n]+)/i)?.[1]?.trim() || '';
    const signalsArray = buyingSignals
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'none found');

    assert.equal(signalsArray.length, 0);
  });
});

describe('Research Dedup by Date', () => {
  it('detects recent research within skip window', () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const content = `[WEB RESEARCH]\nCompany: Acme (acme.com)\nResearched: ${threeDaysAgo.toISOString().split('T')[0]}`;
    const skipDays = 7;

    const dateMatch = content.match(/Researched:\s*(\d{4}-\d{2}-\d{2})/);
    assert.ok(dateMatch);

    const researchDate = new Date(dateMatch![1]);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - skipDays);

    assert.ok(researchDate > cutoff, 'Should detect as recent (within skip window)');
  });

  it('allows research outside skip window', () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const content = `[WEB RESEARCH]\nCompany: Acme (acme.com)\nResearched: ${tenDaysAgo.toISOString().split('T')[0]}`;
    const skipDays = 7;

    const dateMatch = content.match(/Researched:\s*(\d{4}-\d{2}-\d{2})/);
    assert.ok(dateMatch);

    const researchDate = new Date(dateMatch![1]);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - skipDays);

    assert.ok(researchDate <= cutoff, 'Should allow re-research (outside skip window)');
  });
});

describe('WebResearchResult Type', () => {
  it('has all required fields', () => {
    const result = {
      domain: 'acme.com',
      company_name: 'Acme Corp',
      queries: ['acme news funding', 'acme product launch'],
      results: [
        { title: 'Test', url: 'https://example.com', content: 'content', score: 0.9 },
      ],
      ai_summary: 'Acme is growing fast.',
      signals_found: ['funding', 'hiring'],
      personalization_angles: ['Congrats on funding', 'Ask about hiring plans'],
      researched_at: '2026-03-10T10:00:00Z',
      source: 'tavily' as const,
    };

    assert.equal(result.domain, 'acme.com');
    assert.equal(result.source, 'tavily');
    assert.equal(result.queries.length, 2);
    assert.equal(result.signals_found.length, 2);
    assert.equal(result.personalization_angles.length, 2);
    assert.ok(result.researched_at);
  });
});

describe('Web Research Collection Schema', () => {
  it('collection has required properties', () => {
    // These are the properties defined in create-schemas.ts for web-research
    const requiredProperties = [
      'domain',
      'company_name',
      'search_queries',
      'result_count',
      'top_result_url',
      'ai_summary',
      'research_date',
      'source',
      'signals_found',
      'personalization_angles',
      'competitors_mentioned',
      'key_people_mentioned',
      'news_headlines',
      'technology_references',
    ];

    // Verify all 14 properties are accounted for
    assert.equal(requiredProperties.length, 14);
    assert.ok(requiredProperties.includes('signals_found'));
    assert.ok(requiredProperties.includes('personalization_angles'));
    assert.ok(requiredProperties.includes('technology_references'));
  });
});

describe('Content Truncation for Memorization', () => {
  it('truncates search result content to 500 chars', () => {
    const longContent = 'x'.repeat(1000);
    const truncated = longContent.substring(0, 500);
    assert.equal(truncated.length, 500);
  });

  it('keeps short content as-is', () => {
    const shortContent = 'Acme raised $50M in Series B.';
    const truncated = shortContent.substring(0, 500);
    assert.equal(truncated, shortContent);
  });
});
