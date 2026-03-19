/**
 * Tavily Web Search API Client
 *
 * Tavily is a search API designed for AI agents. It returns clean, structured
 * results without HTML parsing. We use it to research companies before
 * outreach: recent news, funding, product launches, hiring, and competition.
 *
 * API docs: https://docs.tavily.com/api-reference/endpoint/search
 */

import { TAVILY_CONFIG } from '../config/prospecting.config.js';
import { logger } from './logger.js';

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

const TAVILY_API_URL = 'https://api.tavily.com/search';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTavilyConfigured(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

export function buildTavilyRequest(
  apiKey: string,
  query: string,
  options?: {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    days?: number;
  },
): RequestInit {
  const maxResults = options?.maxResults ?? TAVILY_CONFIG.maxResultsPerSearch;
  const searchDepth = options?.searchDepth ?? TAVILY_CONFIG.searchDepth;
  const days = options?.days ?? TAVILY_CONFIG.recencyDays;

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: true,
      include_raw_content: false,
      days,
    }),
  };
}

/**
 * Search the web via Tavily.
 *
 * @param query - Search query (e.g. "Acme Corp funding news")
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

  const request = buildTavilyRequest(apiKey, query, options);

  try {
    for (let attempt = 0; attempt <= TAVILY_CONFIG.maxRetries; attempt++) {
      const response = await fetch(TAVILY_API_URL, request);

      if (response.status === 429) {
        if (attempt === TAVILY_CONFIG.maxRetries) {
          logger.error('Tavily rate limit retries exhausted', {
            query,
            attempts: attempt + 1,
          });
          return null;
        }

        const backoffMs = TAVILY_CONFIG.rateLimitPauseMs * (attempt + 1);
        logger.warn('Tavily rate limited — retrying with backoff', {
          query,
          attempt: attempt + 1,
          maxRetries: TAVILY_CONFIG.maxRetries,
          backoffMs,
        });
        await wait(backoffMs);
        continue;
      }

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        logger.error('Tavily API error', {
          query,
          status: response.status,
          statusText: response.statusText,
          detail,
        });
        return null;
      }

      const data = await response.json() as {
        answer?: string;
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          score?: number;
          published_date?: string;
        }>;
      };

      return {
        answer: data.answer || '',
        results: (data.results || []).map((result) => ({
          title: result.title || '',
          url: result.url || '',
          content: result.content || '',
          score: result.score || 0,
          published_date: result.published_date || undefined,
        })),
        query,
      };
    }

    return null;
  } catch (error) {
    logger.error('Tavily search failed', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
