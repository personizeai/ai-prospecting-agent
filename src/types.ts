/** Shared output of the outreach generation pipeline. */
export interface GeneratedEmail {
  email: string;
  step: number;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  angle: string;
}

/** Account that scored above the hot-prospect threshold. */
export interface HotAccount {
  company: string;
  domain: string;
  score: number;
  strength: string;
  action: string;
}

/** Buying signal from an external data source. */
export interface Signal {
  company_domain: string;
  company_name: string;
  signal_type: 'funding' | 'hiring' | 'intent' | 'news' | 'job_posting' | 'tech_adoption';
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  source: string;
  detected_at: string;
}

/** Enrichment data from Apollo, ZoomInfo, Surfe, or Clearbit. */
export interface EnrichmentData {
  email: string;
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  company_domain: string;
  linkedin_url?: string;
  phone?: string;
  seniority?: string;
  department?: string;
  technologies: string[];
  employee_count?: number;
  funding_amount?: number;
  industry?: string;
  source: string;
}

/** Company enrichment data from Apollo Organization Enrichment. */
export interface CompanyEnrichment {
  domain: string;
  name: string;
  industry: string;
  employee_count: number;
  annual_revenue: number;
  annual_revenue_printed: string;
  total_funding: number;
  total_funding_printed: string;
  latest_funding_stage: string;
  latest_funding_round_date: string;
  technologies: string[];
  city: string;
  state: string;
  country: string;
  linkedin_url: string;
  founded_year: number;
  keywords: string[];
  short_description: string;
  source: string;
}

/** Result summary from an enrichment pipeline run. */
export interface EnrichmentRunResult {
  enriched: number;
  skipped: number;
  failed: number;
  timestamp: string;
}

/** Result summary from a discovery pipeline run. */
export interface DiscoveryRunResult {
  accountsProcessed: number;
  contactsDiscovered: number;
  timestamp: string;
}

/** Web research result from Tavily search + AI analysis. */
export interface WebResearchResult {
  domain: string;
  company_name: string;
  queries: string[];
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
  ai_summary: string;
  signals_found: string[];
  personalization_angles: string[];
  researched_at: string;
  source: 'tavily';
}
