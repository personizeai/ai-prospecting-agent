/**
 * Apollo.io API Client
 *
 * Wraps the Apollo REST API for:
 * - People Enrichment (1 credit/person)
 * - Organization Enrichment (1 credit/company)
 * - People Search (FREE — 0 credits)
 *
 * Uses native fetch() — no extra npm packages needed.
 */

import { APOLLO_CONFIG } from '../config/prospecting.config.js';
import { logger } from './logger.js';

if (!process.env.APOLLO_API_KEY) {
  logger.warn('APOLLO_API_KEY not set — Apollo enrichment will be skipped.');
}

const API_KEY = process.env.APOLLO_API_KEY || '';
const BASE_URL = APOLLO_CONFIG.baseUrl;

// ─── Types ─────────────────────────────────────────────────────────

export interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string;
  email_status: string;
  linkedin_url: string;
  phone_numbers?: Array<{ raw_number: string; type: string }>;
  seniority: string;
  departments: string[];
  organization_id: string;
  organization?: ApolloOrganization;
}

export interface ApolloOrganization {
  id: string;
  name: string;
  website_url: string;
  primary_domain: string;
  industry: string;
  estimated_num_employees: number;
  annual_revenue: number;
  annual_revenue_printed: string;
  total_funding: number;
  total_funding_printed: string;
  latest_funding_round_date: string;
  latest_funding_stage: string;
  technologies: string[];
  city: string;
  state: string;
  country: string;
  linkedin_url: string;
  founded_year: number;
  keywords: string[];
  short_description: string;
}

export interface ApolloSearchResponse {
  people: ApolloPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

export interface ApolloEnrichPersonResponse {
  person: ApolloPerson;
}

export interface ApolloEnrichOrgResponse {
  organization: ApolloOrganization;
}

// ─── Helpers ───────────────────────────────────────────────────────

async function apolloFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  if (!API_KEY) {
    throw new Error('APOLLO_API_KEY is not configured');
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    throw new Error('Apollo rate limit exceeded — retry later');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apollo API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

// ─── People Search (FREE — 0 credits) ─────────────────────────────

export interface PeopleSearchParams {
  /** Company domains to search within. */
  organizationDomains: string[];
  /** Job titles to match (substring match). */
  personTitles?: string[];
  /** Seniority levels: 'c_suite' | 'vp' | 'director' | 'manager' | 'senior' | 'entry'. */
  personSeniorities?: string[];
  /** Departments to filter by. */
  personDepartments?: string[];
  /** Max results per page (1-100). */
  perPage?: number;
  /** Page number (1-based). */
  page?: number;
}

export async function searchPeople(params: PeopleSearchParams): Promise<ApolloSearchResponse> {
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
  if (params.personDepartments?.length) {
    body.person_departments = params.personDepartments;
  }

  return apolloFetch<ApolloSearchResponse>('/v1/mixed_people/api_search', body);
}

// ─── People Enrichment (1 credit/person) ──────────────────────────

export async function enrichPerson(email: string): Promise<ApolloPerson | null> {
  try {
    const result = await apolloFetch<ApolloEnrichPersonResponse>('/v1/people/match', {
      email,
      reveal_personal_emails: false,
    });
    return result.person || null;
  } catch (err) {
    logger.error('Apollo person enrichment failed', { email, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── Organization Enrichment (1 credit/company) ───────────────────

export async function enrichOrganization(domain: string): Promise<ApolloOrganization | null> {
  try {
    const result = await apolloFetch<ApolloEnrichOrgResponse>('/v1/organizations/enrich', {
      domain,
    });
    return result.organization || null;
  } catch (err) {
    logger.error('Apollo org enrichment failed', { domain, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── Utilities ─────────────────────────────────────────────────────

/** Check if Apollo is configured and ready to use. */
export function isApolloConfigured(): boolean {
  return !!API_KEY;
}

/** Format a person's phone number from Apollo's array format. */
export function getPhone(person: ApolloPerson): string {
  return person.phone_numbers?.[0]?.raw_number || '';
}
