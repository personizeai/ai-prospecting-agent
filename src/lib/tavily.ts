/**
 * Tavily Web Search API Client
 *
 * Tavily is a search API designed for AI agents. It returns clean, structured
 * results — no HTML parsing needed. We use it to research companies before
 * outreach: recent news, funding, product launches, hiring, competition.
 *
 * API docs: https://docs.tavily.com/docs/rest-api/api-reference
 *
 * Cost: ~$0.01 per search. Rate limit: 1,000 req/min.
 */

import { TAVILY_CONFIG } from '../config/prospecting.config.js';
import { logger } from './logger.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface TavilySearchResponse {
  answer: string;
  results: TavilySearchResult[];
  query: string;
}

// ─── Client ────────────────────────────────────────────────────────

const TAVILY_API_URL = 'https://api.tavily.com/search';

/** Returns true if TAVILY_API_KEY is set. */
export function isTavilyConfigured(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

/**
 * Search the web via Tavily.
 *
 * @param query - Search query (e.g., "Acme Corp funding news")
 * @param options - Override default config values
 * @returns Structured search results with AI summary
 */
export async function searchTavily(
  query: string,
  options?: {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    days?: number;
  },
): Promise<TavilySearchResponse | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    logger.warn('TAVILY_API_KEY not set — skipping web search.');
    return null;
  }

  const maxResults = options?.maxResults ?? TAVILY_CONFIG.maxResultsPerSearch;
  const searchDepth = options?.searchDepth ?? TAVILY_CONFIG.searchDepth;
  const days = options?.days ?? TAVILY_CONFIG.recencyDays;

  try {
    const res = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
        days,
      }),
    });

    if (res.status === 429) {
      logger.warn('Tavily rate limited — retrying after pause.');
      await new Promise((r) => setTimeout(r, 2000));
      return searchTavily(query, options);
    }

    if (!res.ok) {
      logger.error('Tavily API error', { status: res.status, statusText: res.statusText });
      return null;
    }

    const data = await res.json();

    return {
      answer: data.answer || '',
      results: (data.results || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score || 0,
        published_date: r.published_date || undefined,
      })),
      query,
    };
  } catch (err) {
    logger.error('Tavily search failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
