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

/** Generated LinkedIn message (connection request or InMail). */
export interface GeneratedLinkedInMessage {
  email: string;
  step: number;
  type: 'connection_request' | 'inmail' | 'message';
  /** Connection request note (max 300 chars) or full message. */
  message: string;
  /** Personalization angle used. */
  angle: string;
  /** LinkedIn profile URL of the recipient. */
  linkedinUrl: string;
}

/** Generated call script for a sales call. */
export interface GeneratedCallScript {
  email: string;
  step: number;
  /** Who to call — name and title. */
  contactName: string;
  contactTitle: string;
  phone: string;
  /** 2-sentence opener: who you are + why calling. */
  opener: string;
  /** 1 sentence connecting to their specific situation. */
  hook: string;
  /** 1 sentence — the meeting request. */
  ask: string;
  /** 2-3 common objections with 1-sentence responses. */
  objectionHandlers: Array<{ objection: string; response: string }>;
  /** Short playbook for human callers: mindset, do's, don'ts. */
  humanPlaybook: string;
  /** Full verbatim script for AI callers (Bland.ai, Vapi, etc.). */
  aiCallerScript: string;
  /** Personalization angle used. */
  angle: string;
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

/** Normalized call result from any voice AI provider (Bland.ai, Vapi, ElevenLabs). */
export interface CallResult {
  /** Provider that handled the call. */
  provider: 'bland-ai' | 'vapi' | 'elevenlabs';
  /** Provider-specific call/conversation ID. */
  callId: string;
  /** Contact email (resolved from metadata passed when triggering the call). */
  email: string;
  /** Call status: completed, no-answer, busy, voicemail, failed. */
  status: 'completed' | 'no-answer' | 'busy' | 'voicemail' | 'failed' | 'unknown';
  /** Who answered: human, voicemail, unknown. */
  answeredBy: 'human' | 'voicemail' | 'unknown' | 'no-answer';
  /** Call duration in seconds. */
  durationSecs: number;
  /** Full transcript as a single string. */
  transcript: string;
  /** Structured transcript turns (if available from provider). */
  turns: Array<{ role: 'user' | 'agent'; message: string; timeSecs?: number }>;
  /** Provider-generated summary (if available). */
  summary: string;
  /** Who ended the call: assistant or user. */
  endedBy: 'assistant' | 'user' | 'system' | 'unknown';
  /** Why the call ended (provider-specific reason string). */
  endedReason: string;
  /** Cost in USD (if reported by provider). */
  costUsd: number;
  /** Recording URL (if available — stored by provider, not by us). */
  recordingUrl: string;
  /** Original metadata passed when triggering the call. */
  metadata: Record<string, unknown>;
}

/** AI analysis of a completed call transcript. */
export interface CallAnalysis {
  /** Overall call outcome. */
  outcome: 'interested' | 'meeting_booked' | 'not_interested' | 'callback_requested' | 'voicemail' | 'no_answer' | 'wrong_person' | 'neutral';
  /** 2-3 sentence summary of what happened on the call. */
  summary: string;
  /** Key points discussed. */
  keyPoints: string[];
  /** Contact's sentiment during the call. */
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Urgency of follow-up. */
  urgency: 'high' | 'medium' | 'low';
  /** Specific next action to take. */
  nextAction: string;
  /** Objections raised by the contact. */
  objectionsRaised: string[];
  /** If callback requested, when (e.g., "next Tuesday", "after Q1"). */
  callbackTime?: string;
  /** If referred to another person, who. */
  referredContact?: string;
}

/** HeyReach webhook event types.
 *  Docs: HeyReach dashboard → Integrations → Webhooks.
 *  Source: Composio toolkit + Make module triggers. */
export type HeyReachEventType =
  | 'CONNECTION_REQUEST_SENT'
  | 'CONNECTION_REQUEST_ACCEPTED'
  | 'MESSAGE_SENT'
  | 'MESSAGE_REPLY_RECEIVED'
  | 'INMAIL_SENT'
  | 'INMAIL_REPLY_RECEIVED'
  | 'FOLLOW_SENT'
  | 'LIKED_POST'
  | 'VIEWED_PROFILE'
  | 'CAMPAIGN_COMPLETED'
  | 'LEAD_TAG_UPDATED';

/** Normalized LinkedIn event from HeyReach webhook. */
export interface LinkedInEvent {
  /** HeyReach webhook event type. */
  eventType: HeyReachEventType;
  /** Campaign ID the event belongs to. */
  campaignId: string;
  /** Lead's LinkedIn profile URL. */
  profileUrl: string;
  /** Lead's LinkedIn member ID. */
  linkedInId: string;
  /** Lead's first name (if available). */
  firstName: string;
  /** Lead's last name (if available). */
  lastName: string;
  /** Lead's email (if available). */
  email: string;
  /** Lead's company (if available). */
  company: string;
  /** Message content (for MESSAGE_REPLY_RECEIVED, INMAIL_REPLY_RECEIVED). */
  messageContent: string;
  /** Conversation ID (for message events). */
  conversationId: string;
  /** HeyReach sender LinkedIn account ID. */
  senderAccountId: string;
  /** Raw webhook payload for debugging. */
  rawPayload: Record<string, unknown>;
}

/** AI analysis of a LinkedIn event (reply, connection acceptance, etc.). */
export interface LinkedInEventAnalysis {
  /** Classification of the event's significance. */
  outcome: 'interested' | 'not_interested' | 'question' | 'referral' | 'neutral' | 'positive_signal';
  /** 1-2 sentence summary. */
  summary: string;
  /** Contact's sentiment. */
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Urgency of follow-up. */
  urgency: 'high' | 'medium' | 'low';
  /** Specific next action to take. */
  nextAction: string;
  /** Key points from the message (if reply). */
  keyPoints: string[];
}

// ─── Interview Types ───────────────────────────────────────────────

/** Interview purpose — determines the question framework and analysis focus. */
export type InterviewPurpose =
  | 'discovery'          // Qualify leads deeper (BANT/MEDDIC extraction)
  | 'win_loss'           // Post-deal analysis — why they bought or didn't
  | 'customer_health'    // Periodic check-in for churn prevention
  | 'feature_validation' // Quick customer pulse on product direction
  | 'nps_followup';      // Deep-dive after NPS score

/** A single topic with probing questions for the AI interviewer. */
export interface InterviewTopic {
  /** Topic name (e.g., "Current Pain Points", "Budget & Timeline"). */
  topic: string;
  /** Why we're asking about this — context for the AI interviewer. */
  objective: string;
  /** Primary question to ask. */
  primaryQuestion: string;
  /** Follow-up probes if the answer is vague or interesting. */
  probes: string[];
  /** Max time in minutes to spend on this topic before moving on. */
  maxMinutes: number;
}

/** Generated interview guide — the AI interviewer's playbook. */
export interface InterviewGuide {
  email: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  /** Interview purpose that shaped this guide. */
  purpose: InterviewPurpose;
  /** Opening: how to introduce the interview (consent, framing, rapport). */
  opening: string;
  /** Ordered list of topics to cover. */
  topics: InterviewTopic[];
  /** Closing: how to wrap up (thank, next steps, any asks). */
  closing: string;
  /** System prompt for the AI voice agent — full conversational instructions. */
  aiInterviewerPrompt: string;
  /** Target duration in minutes. */
  targetDurationMins: number;
  /** What we already know — gaps this interview should fill. */
  knowledgeGaps: string[];
}

/** Structured data extracted from an interview transcript. */
export interface InterviewAnalysis {
  /** Overall interview quality. */
  quality: 'excellent' | 'good' | 'partial' | 'poor';
  /** 3-5 sentence executive summary. */
  summary: string;
  /** Per-topic findings. */
  topicFindings: Array<{
    topic: string;
    /** What we learned — key insight from this topic. */
    finding: string;
    /** Direct quotes that support this finding. */
    quotes: string[];
    /** Confidence: how well did the contact answer? */
    confidence: 'high' | 'medium' | 'low';
  }>;
  /** BANT/MEDDIC fields extracted (for discovery interviews). */
  qualification: {
    budget: string;
    authority: string;
    need: string;
    timeline: string;
    decisionProcess: string;
    metrics: string;
    champion: string;
  };
  /** Competitive intelligence gathered. */
  competitiveIntel: Array<{ competitor: string; context: string }>;
  /** Feature requests or product feedback mentioned. */
  productFeedback: string[];
  /** Objections or concerns raised. */
  concerns: string[];
  /** Sentiment arc: how did the contact's tone change over the interview? */
  sentimentArc: 'warming' | 'steady_positive' | 'steady_neutral' | 'cooling' | 'mixed';
  /** Recommended next steps based on interview findings. */
  nextSteps: string[];
  /** Overall contact sentiment. */
  sentiment: 'positive' | 'neutral' | 'negative';
  /** Urgency of follow-up. */
  urgency: 'high' | 'medium' | 'low';
}

/** Result from scheduling/triggering an interview call. */
export interface InterviewCallResult {
  /** Reuses the standard CallResult for transcript/metadata. */
  callResult: CallResult;
  /** The guide that was used for this interview. */
  guide: InterviewGuide;
}

// ─── Ecommerce Types ──────────────────────────────────────────────

/** Ecommerce campaign type for outreach generation. */
export type EcommerceCampaignType = 'winback' | 'post-purchase' | 'promotional' | 'seasonal';

/** Personalized email variables for ecommerce campaigns.
 *  Designed to be injected into ESP templates (Klaviyo, Mailchimp, Braze, etc.). */
export interface EcommerceVariables {
  email: string;
  campaignType: EcommerceCampaignType;
  /** Primary headline, 5-12 words, emotionally compelling. */
  headline: string;
  /** 1 sentence connecting to their personal style or purchase pattern. */
  subheadline: string;
  /** 2-3 sentences. The hook — why this matters to THEM. */
  shortParagraph: string;
  /** 4-6 sentences. Product recommendations with context. */
  longParagraph: string;
  /** AI image generation prompt for a lifestyle hero image. */
  imagePrompt: string;
  /** CTA button text. */
  ctaText: string;
  /** Recommended product IDs from catalog, ordered by relevance. */
  productRecommendations: string[];
  /** Personalization angle used. */
  angle: string;
  /** Email subject line. */
  subjectLine: string;
  /** Preview text shown after subject in inbox. */
  previewText: string;
}

/** Result from ecommerce preference inference. */
export interface PreferenceInference {
  email: string;
  stylePreferences: string;
  priceTier: 'Budget' | 'Mid-Range' | 'Premium' | 'Luxury';
  segment: 'New' | 'Active' | 'Loyal' | 'VIP' | 'At-Risk' | 'Lapsed' | 'Win-Back';
  recommendations: string[];
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
