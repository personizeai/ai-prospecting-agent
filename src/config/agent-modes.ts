/**
 * Agent Modes — Pre-configured personalities for different use cases.
 *
 * The pipeline architecture (sync → score → research → generate → send → handle replies)
 * is universal. What changes per mode is:
 *   - Terminology (prospect vs patient vs member vs candidate)
 *   - Scoring criteria (ICP vs purchase history vs visit recency)
 *   - Governance (brand voice, playbook, signals)
 *   - Cadences (timing, aggressiveness, sequence length)
 *   - Discovery targets (titles, departments, seniority)
 *
 * Set via AGENT_MODE env var. Default: 'outbound-sdr'.
 *
 * Each mode provides SUGGESTED governance and config overrides.
 * The onboarding skill uses these as starting points, then customizes
 * based on your specific business during the interview.
 */

// ─── Mode Categories ─────────────────────────────────────────────

export type ModeCategory =
  | 'sales-gtm'
  | 'ecommerce'
  | 'membership'
  | 'recruiting'
  | 'education'
  | 'real-estate'
  | 'agency'
  | 'nonprofit';

// ─── Mode Definitions ────────────────────────────────────────────

export interface AgentModeTerminology {
  /** What you call the person being contacted (prospect, member, candidate, donor, etc.) */
  entity: string;
  /** Plural form */
  entityPlural: string;
  /** What you call the organization (company, practice, school, property, etc.) */
  organization: string;
  /** What you call the outreach action (prospecting, outreach, follow-up, nurture, etc.) */
  action: string;
  /** What you call a positive outcome (deal, appointment, renewal, enrollment, etc.) */
  conversion: string;
  /** What you call the score (ICP score, engagement score, health score, etc.) */
  score: string;
}

export interface AgentModeCadencePreset {
  aggressive: { maxEmails: number; waitDays: number[]; label: string };
  standard: { maxEmails: number; waitDays: number[]; label: string };
  enterprise: { maxEmails: number; waitDays: number[]; label: string };
}

export interface AgentModeGovernance {
  icpSummary: string;
  brandVoiceTone: string;
  signalExamples: string[];
  playbookNotes: string;
  emailExampleSubject: string;
  emailExampleOpener: string;
}

export interface AgentModeDiscovery {
  targetTitles: string[];
  targetSeniorities: string[];
  targetDepartments: string[];
}

export interface AgentModeDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ModeCategory;
  emoji: string;
  terminology: AgentModeTerminology;
  governance: AgentModeGovernance;
  cadences: AgentModeCadencePreset;
  discovery: AgentModeDiscovery;
  /** Suggested budget tier for this mode */
  suggestedBudgetTier: 'conservative' | 'balanced' | 'aggressive';
  /** Signals that matter most for this mode */
  keySignals: string[];
}

// ─── Category Labels ─────────────────────────────────────────────

export const MODE_CATEGORIES: Record<ModeCategory, { label: string; description: string }> = {
  'sales-gtm': {
    label: 'Sales & GTM',
    description: 'B2B sales, pipeline generation, and go-to-market motions',
  },
  'ecommerce': {
    label: 'Ecommerce & D2C',
    description: 'Customer lifecycle, win-back, and revenue recovery',
  },
  'membership': {
    label: 'Membership & Community',
    description: 'Member retention, renewals, and community engagement',
  },
  'recruiting': {
    label: 'Recruiting & HR',
    description: 'Talent sourcing, candidate outreach, and employee engagement',
  },
  'education': {
    label: 'Education',
    description: 'Student enrollment, alumni engagement, and fundraising',
  },
  'real-estate': {
    label: 'Real Estate',
    description: 'Buyer/seller lead nurture and agent outreach',
  },
  'agency': {
    label: 'Agency & Services',
    description: 'New business development and client acquisition for agencies',
  },
  'nonprofit': {
    label: 'Nonprofit & Fundraising',
    description: 'Donor engagement, volunteer recruitment, and campaign outreach',
  },
};

// ─── Mode Definitions ────────────────────────────────────────────

export const AGENT_MODES: Record<string, AgentModeDefinition> = {

  // ═══════════════════════════════════════════════════════════════
  // SALES & GTM
  // ═══════════════════════════════════════════════════════════════

  'outbound-sdr': {
    id: 'outbound-sdr',
    name: 'Outbound AI SDR',
    tagline: 'Cold outbound prospecting on autopilot',
    description: 'Classic B2B cold outreach. Scores accounts against your ICP, discovers decision-makers, writes personalized sequences, handles replies. The default mode.',
    category: 'sales-gtm',
    emoji: '🎯',
    terminology: {
      entity: 'prospect',
      entityPlural: 'prospects',
      organization: 'company',
      action: 'prospecting',
      conversion: 'meeting booked',
      score: 'ICP score',
    },
    governance: {
      icpSummary: 'B2B SaaS companies, 50-2000 employees, Series A+, with a sales team',
      brandVoiceTone: 'Confident, conversational, direct. First sentence about them, not us.',
      signalExamples: ['New funding round', 'Hiring sales roles', 'New CRO/VP Sales hired', 'Competitor contract renewal'],
      playbookNotes: '3 emails max. Each email a different angle. Stop on reply.',
      emailExampleSubject: 'Quick thought on [specific observation]',
      emailExampleOpener: 'I noticed [specific fact about them or their company].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [2, 3], label: 'Hot leads (score 80+)' },
      standard: { maxEmails: 3, waitDays: [3, 5], label: 'Default cadence' },
      enterprise: { maxEmails: 4, waitDays: [5, 7, 10], label: 'Large accounts — longer runway' },
    },
    discovery: {
      targetTitles: ['VP Sales', 'VP Marketing', 'Head of Growth', 'CRO', 'Director of Sales', 'Director of Marketing'],
      targetSeniorities: ['vp', 'director', 'c_suite', 'manager'],
      targetDepartments: ['sales', 'marketing', 'business_development', 'c_suite'],
    },
    suggestedBudgetTier: 'balanced',
    keySignals: ['funding', 'hiring', 'new_leadership', 'competitor_contract', 'growth'],
  },

  'abm': {
    id: 'abm',
    name: 'Account-Based Marketing',
    tagline: 'Deep, multi-threaded outreach to strategic accounts',
    description: 'Fewer accounts, deeper research, more contacts per account. Multi-threaded outreach coordinated across the buying committee. Longer sequences with higher-touch messaging.',
    category: 'sales-gtm',
    emoji: '🏢',
    terminology: {
      entity: 'stakeholder',
      entityPlural: 'stakeholders',
      organization: 'target account',
      action: 'account engagement',
      conversion: 'pipeline created',
      score: 'account score',
    },
    governance: {
      icpSummary: 'Named target accounts with 500+ employees. Multi-stakeholder buying committees. Enterprise deal sizes.',
      brandVoiceTone: 'Executive, consultative, insight-led. Lead with industry expertise and research.',
      signalExamples: ['Strategic initiative announced', 'Leadership change', 'Earnings call mentions', 'Industry regulation change', 'M&A activity'],
      playbookNotes: '4-5 emails per stakeholder. Coordinate messaging across the buying committee. Different angles per persona (economic buyer vs technical evaluator vs champion).',
      emailExampleSubject: '[Their initiative] and [your relevant capability]',
      emailExampleOpener: 'Your [recent initiative/announcement] caught my attention — specifically [detail].',
    },
    cadences: {
      aggressive: { maxEmails: 4, waitDays: [3, 5, 5], label: 'Champion contacts — high intent' },
      standard: { maxEmails: 4, waitDays: [5, 7, 7], label: 'Buying committee members' },
      enterprise: { maxEmails: 5, waitDays: [7, 10, 10, 14], label: 'C-suite — slow and respectful' },
    },
    discovery: {
      targetTitles: ['CTO', 'CIO', 'CFO', 'VP Engineering', 'VP Operations', 'Head of IT', 'Director of Strategy', 'Chief Digital Officer'],
      targetSeniorities: ['c_suite', 'vp', 'director'],
      targetDepartments: ['c_suite', 'engineering', 'operations', 'it', 'finance'],
    },
    suggestedBudgetTier: 'aggressive',
    keySignals: ['strategic_initiative', 'leadership_change', 'earnings_mention', 'regulation_change', 'budget_cycle'],
  },

  'cold-deals': {
    id: 'cold-deals',
    name: 'Cold Deal Revival',
    tagline: 'Re-engage stale pipeline and lost deals',
    description: 'Targets closed-lost deals and stale pipeline opportunities. References past conversations, acknowledges history, and offers a fresh angle. Uses deal context and loss reasons to personalize re-engagement.',
    category: 'sales-gtm',
    emoji: '🔄',
    terminology: {
      entity: 'former prospect',
      entityPlural: 'former prospects',
      organization: 'company',
      action: 're-engagement',
      conversion: 'deal reopened',
      score: 'revival score',
    },
    governance: {
      icpSummary: 'Previously qualified companies where deals went cold or were lost. Priority: lost to timing/budget (not competitor losses).',
      brandVoiceTone: 'Warm, acknowledging, not pushy. Reference the history. Lead with what has changed since they last evaluated.',
      signalExamples: ['New budget cycle', 'Leadership change since loss', 'Competitor raised prices', 'Original pain point resurfaced', 'Company grew past original blocker'],
      playbookNotes: '2-3 emails max. Acknowledge the previous conversation. Lead with what is new or different. Never pretend the history did not happen.',
      emailExampleSubject: 'Since we last spoke — [something that changed]',
      emailExampleOpener: 'We chatted [timeframe] ago about [topic]. Since then, [relevant change].',
    },
    cadences: {
      aggressive: { maxEmails: 2, waitDays: [3], label: 'Lost to timing — ready to revisit' },
      standard: { maxEmails: 3, waitDays: [5, 7], label: 'Standard re-engagement' },
      enterprise: { maxEmails: 3, waitDays: [7, 14], label: 'Enterprise — gentle re-engagement' },
    },
    discovery: {
      targetTitles: ['VP Sales', 'VP Marketing', 'Head of Growth', 'CRO', 'Director of Sales'],
      targetSeniorities: ['vp', 'director', 'c_suite'],
      targetDepartments: ['sales', 'marketing', 'business_development', 'c_suite'],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['budget_cycle', 'leadership_change', 'competitor_price_increase', 'growth_milestone', 'pain_point_resurface'],
  },

  'partner-recruitment': {
    id: 'partner-recruitment',
    name: 'Partner Recruitment',
    tagline: 'Find and recruit channel partners, resellers, and agencies',
    description: 'Identifies potential channel partners, agencies, or resellers. Outreach positions mutual value — their clients + your product. References their client base and expertise.',
    category: 'sales-gtm',
    emoji: '🤝',
    terminology: {
      entity: 'partner prospect',
      entityPlural: 'partner prospects',
      organization: 'agency',
      action: 'partner recruitment',
      conversion: 'partnership started',
      score: 'partner fit score',
    },
    governance: {
      icpSummary: 'Agencies, consultancies, and resellers serving your target market. 10-200 employees. Complementary (not competing) offerings.',
      brandVoiceTone: 'Collaborative, peer-to-peer, mutual value focused. Not selling — proposing a partnership.',
      signalExamples: ['Agency won new clients in your space', 'Posted content about your category', 'Hiring for roles that overlap with your product', 'Client case study in your vertical'],
      playbookNotes: '3 emails. Lead with their expertise and client base. Show the revenue opportunity. Make the onboarding friction obvious and low.',
      emailExampleSubject: 'Partnership idea — your [expertise] + our [product]',
      emailExampleOpener: 'Your work with [client type/vertical] caught my eye — specifically [detail].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [3, 5], label: 'High-fit partners' },
      standard: { maxEmails: 3, waitDays: [5, 7], label: 'Standard partner outreach' },
      enterprise: { maxEmails: 3, waitDays: [7, 10], label: 'Large agency — longer cycle' },
    },
    discovery: {
      targetTitles: ['CEO', 'Managing Director', 'Head of Partnerships', 'VP Business Development', 'Director of Strategy', 'Partner'],
      targetSeniorities: ['c_suite', 'vp', 'director', 'owner'],
      targetDepartments: ['c_suite', 'business_development', 'sales', 'partnerships'],
    },
    suggestedBudgetTier: 'balanced',
    keySignals: ['new_client_win', 'content_in_category', 'hiring_overlap', 'vertical_expansion', 'partnership_program_launch'],
  },

  'event-followup': {
    id: 'event-followup',
    name: 'Event Follow-Up',
    tagline: 'Convert conference leads into pipeline',
    description: 'Post-conference, webinar, or trade show follow-up. References the shared event experience. Fast cadence while the event is fresh. Segments by engagement level (booth visit vs badge scan vs session attendee).',
    category: 'sales-gtm',
    emoji: '🎪',
    terminology: {
      entity: 'attendee',
      entityPlural: 'attendees',
      organization: 'company',
      action: 'event follow-up',
      conversion: 'meeting booked',
      score: 'engagement score',
    },
    governance: {
      icpSummary: 'Event attendees who match your ICP. Priority: booth visitors > session attendees > badge scans.',
      brandVoiceTone: 'Warm, referencing shared experience. Time-sensitive — the event connection fades fast.',
      signalExamples: ['Visited booth', 'Attended your session', 'Downloaded content at event', 'Asked a question', 'Scanned badge'],
      playbookNotes: '2-3 emails within 10 days of event. First email within 48 hours. Reference the specific event and interaction. Do not just say "we met at [event]" — be specific.',
      emailExampleSubject: 'From [Event Name] — [specific reference]',
      emailExampleOpener: 'Great connecting at [Event] — especially your question about [topic].',
    },
    cadences: {
      aggressive: { maxEmails: 2, waitDays: [1], label: 'Booth visitors — fast follow-up' },
      standard: { maxEmails: 3, waitDays: [2, 4], label: 'Session attendees' },
      enterprise: { maxEmails: 3, waitDays: [3, 5], label: 'Badge scans — lighter touch' },
    },
    discovery: {
      targetTitles: ['VP Sales', 'VP Marketing', 'Head of Growth', 'Director of Sales', 'CRO'],
      targetSeniorities: ['vp', 'director', 'c_suite', 'manager'],
      targetDepartments: ['sales', 'marketing', 'business_development', 'c_suite'],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['booth_visit', 'session_attendance', 'content_download', 'question_asked', 'badge_scan'],
  },

  // ═══════════════════════════════════════════════════════════════
  // ECOMMERCE & D2C
  // ═══════════════════════════════════════════════════════════════

  'ecommerce-winback': {
    id: 'ecommerce-winback',
    name: 'Ecommerce Win-Back',
    tagline: 'Re-engage lapsed customers before they churn forever',
    description: 'Targets customers who have not purchased in X days. References past purchases, offers incentives, and creates urgency. Segments by customer lifetime value and purchase frequency.',
    category: 'ecommerce',
    emoji: '🛒',
    terminology: {
      entity: 'customer',
      entityPlural: 'customers',
      organization: 'brand',
      action: 'win-back',
      conversion: 'repeat purchase',
      score: 'churn risk score',
    },
    governance: {
      icpSummary: 'Customers with no purchase in 60-180 days. Priority by CLV: high-value customers first. Exclude recent returns or complaints.',
      brandVoiceTone: 'Warm, personal, not desperate. Reference their specific purchase history. Make it feel like you noticed they have been away.',
      signalExamples: ['Days since last purchase crossed threshold', 'Browsed site without buying', 'Opened emails but did not click', 'Anniversary of first purchase', 'Product they bought was restocked or updated'],
      playbookNotes: '3 emails over 2-3 weeks. Email 1: "We miss you" + personalized recommendation. Email 2: Social proof or new arrivals relevant to them. Email 3: Incentive (discount, free shipping, loyalty points).',
      emailExampleSubject: 'We saved something for you',
      emailExampleOpener: 'It has been a while since you picked up [their last purchase] — and we have something you might like.',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [3, 5], label: 'High-CLV customers — act fast' },
      standard: { maxEmails: 3, waitDays: [5, 7], label: 'Standard win-back sequence' },
      enterprise: { maxEmails: 3, waitDays: [7, 14], label: 'Low-frequency buyers — gentle nudge' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['lapsed_purchase', 'browse_no_buy', 'email_open_no_click', 'purchase_anniversary', 'product_restock'],
  },

  'post-purchase': {
    id: 'post-purchase',
    name: 'Post-Purchase Upsell',
    tagline: 'Cross-sell and upsell after purchase',
    description: 'Follows up after a purchase with complementary product recommendations, usage tips, review requests, and upgrade paths. Timed to the product lifecycle.',
    category: 'ecommerce',
    emoji: '📦',
    terminology: {
      entity: 'customer',
      entityPlural: 'customers',
      organization: 'brand',
      action: 'post-purchase nurture',
      conversion: 'upsell / cross-sell',
      score: 'upsell readiness score',
    },
    governance: {
      icpSummary: 'Recent purchasers within 7-30 days. Priority: high-AOV orders, multi-item buyers, first-time buyers.',
      brandVoiceTone: 'Helpful, not salesy. Focused on getting value from what they just bought. Recommendations feel natural, not forced.',
      signalExamples: ['Purchase completed', 'Product delivered', 'First usage milestone', 'Review submitted', 'Consumable likely running low'],
      playbookNotes: '3-4 emails over 30 days. Email 1: Order confirmation + tips (day 1). Email 2: "How is it going?" + complementary product (day 7). Email 3: Review request (day 14). Email 4: Replenishment or upgrade (day 30).',
      emailExampleSubject: 'Getting the most from your [product name]',
      emailExampleOpener: 'Your [product] should have arrived by now — here are a few tips to get started.',
    },
    cadences: {
      aggressive: { maxEmails: 4, waitDays: [3, 7, 14], label: 'High-AOV — maximize value' },
      standard: { maxEmails: 3, waitDays: [7, 14], label: 'Standard post-purchase' },
      enterprise: { maxEmails: 3, waitDays: [7, 21], label: 'First-time buyer — gentle onboarding' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['purchase_completed', 'delivery_confirmed', 'usage_milestone', 'review_submitted', 'consumable_depletion'],
  },

  'cart-abandonment': {
    id: 'cart-abandonment',
    name: 'Cart Abandonment Recovery',
    tagline: 'Recover abandoned carts with personalized nudges',
    description: 'Follows up with shoppers who added items to cart but did not complete checkout. References specific items, addresses common objections (shipping, price, trust), and offers incentives progressively.',
    category: 'ecommerce',
    emoji: '🛍️',
    terminology: {
      entity: 'shopper',
      entityPlural: 'shoppers',
      organization: 'store',
      action: 'cart recovery',
      conversion: 'checkout completed',
      score: 'purchase intent score',
    },
    governance: {
      icpSummary: 'Shoppers with abandoned carts in the last 24-72 hours. Priority by cart value. Exclude serial abandoners (3+ abandoned carts, never purchased).',
      brandVoiceTone: 'Helpful, low-pressure. Remind them what they left. Address the likely objection. Incentives only in final email.',
      signalExamples: ['Cart abandoned', 'Returned to site without buying', 'Item going out of stock', 'Price drop on carted item', 'Previously purchased from you'],
      playbookNotes: '2-3 emails within 72 hours. Email 1: Reminder with product image (1 hour). Email 2: Address objection — shipping, sizing, reviews (24 hours). Email 3: Incentive — discount or free shipping (48-72 hours).',
      emailExampleSubject: 'You left something behind',
      emailExampleOpener: 'Looks like you were checking out [product name] — still thinking it over?',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [0, 1], label: 'High-value carts — fast recovery' },
      standard: { maxEmails: 2, waitDays: [1], label: 'Standard cart recovery' },
      enterprise: { maxEmails: 2, waitDays: [1], label: 'Low-value carts — single reminder' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['cart_abandoned', 'return_visit', 'stock_low', 'price_drop', 'returning_customer'],
  },

  // ═══════════════════════════════════════════════════════════════
  // MEMBERSHIP & COMMUNITY
  // ═══════════════════════════════════════════════════════════════

  'member-renewal': {
    id: 'member-renewal',
    name: 'Member Renewal',
    tagline: 'Retain expiring and lapsed members',
    description: 'Targets members approaching renewal dates or recently lapsed. References their usage, benefits consumed, and community involvement. Prevents churn through personalized retention outreach.',
    category: 'membership',
    emoji: '🔑',
    terminology: {
      entity: 'member',
      entityPlural: 'members',
      organization: 'organization',
      action: 'renewal outreach',
      conversion: 'renewal completed',
      score: 'retention risk score',
    },
    governance: {
      icpSummary: 'Members expiring in 30-90 days or lapsed within 60 days. Priority: high-engagement members at risk, long-tenure members, members who used key benefits.',
      brandVoiceTone: 'Appreciative, value-focused. Remind them what they have access to and what they would lose. Testimonials from peers. Never guilt-trip.',
      signalExamples: ['Renewal date approaching', 'Membership lapsed', 'Usage declining', 'Event attendance dropped', 'Benefit utilization low'],
      playbookNotes: '3-4 emails starting 60 days before expiration. Email 1: Value recap + "your membership includes..." (60 days). Email 2: Peer testimonial or community highlight (30 days). Email 3: Early renewal incentive (14 days). Email 4: Final reminder — what you will lose (3 days).',
      emailExampleSubject: 'Your membership — here is what you have unlocked this year',
      emailExampleOpener: 'This year, you [specific usage stat: attended 4 events, accessed 12 resources, saved $X].',
    },
    cadences: {
      aggressive: { maxEmails: 4, waitDays: [14, 14, 10], label: 'High-value members — full sequence' },
      standard: { maxEmails: 3, waitDays: [14, 14], label: 'Standard renewal' },
      enterprise: { maxEmails: 2, waitDays: [21], label: 'Recently lapsed — re-engagement' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['renewal_approaching', 'membership_lapsed', 'usage_declining', 'attendance_dropped', 'benefit_underutilized'],
  },

  'member-onboarding': {
    id: 'member-onboarding',
    name: 'Member Onboarding',
    tagline: 'Activate new members and drive early engagement',
    description: 'Welcome sequence for new members. Guides them through key benefits, introduces community, and drives first engagement actions. Sets the foundation for long-term retention.',
    category: 'membership',
    emoji: '👋',
    terminology: {
      entity: 'new member',
      entityPlural: 'new members',
      organization: 'community',
      action: 'onboarding',
      conversion: 'first engagement',
      score: 'activation score',
    },
    governance: {
      icpSummary: 'Members who joined in the last 0-30 days. Priority: members who have not taken a key action yet (attended event, used a benefit, joined a group).',
      brandVoiceTone: 'Welcoming, enthusiastic, helpful. Guide them step by step. Celebrate their first actions. Introduce them to real people, not just features.',
      signalExamples: ['Membership started', 'Profile completed', 'First event attended', 'First resource accessed', 'Connected with another member'],
      playbookNotes: '4-5 emails over first 30 days. Email 1: Welcome + one quick win (day 0). Email 2: Meet the community (day 3). Email 3: Key benefit they have not used yet (day 7). Email 4: Upcoming event invitation (day 14). Email 5: Check-in — how is it going? (day 30).',
      emailExampleSubject: 'Welcome — your first step',
      emailExampleOpener: 'Welcome to [community]! Here is the one thing new members find most valuable in their first week.',
    },
    cadences: {
      aggressive: { maxEmails: 5, waitDays: [3, 4, 7, 16], label: 'Full onboarding sequence' },
      standard: { maxEmails: 4, waitDays: [3, 7, 14], label: 'Standard onboarding' },
      enterprise: { maxEmails: 3, waitDays: [7, 14], label: 'Light onboarding' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['membership_started', 'profile_completed', 'first_event', 'first_resource', 'first_connection'],
  },

  // ═══════════════════════════════════════════════════════════════
  // RECRUITING & HR
  // ═══════════════════════════════════════════════════════════════

  'talent-sourcing': {
    id: 'talent-sourcing',
    name: 'Talent Sourcing',
    tagline: 'Outbound recruiting — find and engage passive candidates',
    description: 'Sources passive candidates from LinkedIn, job boards, and databases. Personalized outreach referencing their experience, skills, and career trajectory. Handles responses and schedules screens.',
    category: 'recruiting',
    emoji: '🔍',
    terminology: {
      entity: 'candidate',
      entityPlural: 'candidates',
      organization: 'company',
      action: 'sourcing',
      conversion: 'screen scheduled',
      score: 'candidate fit score',
    },
    governance: {
      icpSummary: 'Passive candidates matching role requirements. Priority: relevant experience, target companies, specific skills. Exclude recently contacted or recently declined.',
      brandVoiceTone: 'Respectful, opportunity-focused, peer-to-peer. Never desperate. Lead with what makes the role interesting, not just the company. Respect their current position.',
      signalExamples: ['Profile updated recently', 'Changed jobs within 1-2 years', 'Open to opportunities flag', 'Skills match role requirements', 'Posted about career growth'],
      playbookNotes: '2-3 emails. Email 1: Why this role fits their trajectory (not a JD dump). Email 2: Team/culture angle or compensation highlight. Email 3: Direct — interested or should I move on?',
      emailExampleSubject: '[Role] at [Company] — fits your [skill/trajectory]',
      emailExampleOpener: 'Your background in [specific experience] caught my attention — particularly [detail from their profile].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [3, 4], label: 'Urgent hire — fast follow-up' },
      standard: { maxEmails: 3, waitDays: [4, 7], label: 'Standard sourcing' },
      enterprise: { maxEmails: 2, waitDays: [7], label: 'Executive search — slow and respectful' },
    },
    discovery: {
      targetTitles: [],  // Configured per role
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'balanced',
    keySignals: ['profile_updated', 'recent_job_change', 'open_to_opportunities', 'skill_match', 'career_growth_content'],
  },

  'employee-onboarding': {
    id: 'employee-onboarding',
    name: 'Employee Onboarding',
    tagline: 'Internal onboarding drip sequences for new hires',
    description: 'Automated onboarding emails for new employees. Day 1 welcome, week 1 setup guides, week 2 introductions, month 1 check-in. Ensures consistent onboarding experience across the org.',
    category: 'recruiting',
    emoji: '🏢',
    terminology: {
      entity: 'new hire',
      entityPlural: 'new hires',
      organization: 'team',
      action: 'onboarding',
      conversion: 'fully ramped',
      score: 'readiness score',
    },
    governance: {
      icpSummary: 'New employees in their first 90 days. Segment by department, role level, and location (remote vs in-office).',
      brandVoiceTone: 'Friendly, supportive, clear. No corporate jargon. Make them feel welcome and set up for success. Introduce real people, not org charts.',
      signalExamples: ['Start date', 'First login completed', 'Required training completed', 'First 1:1 with manager', 'First team meeting attended'],
      playbookNotes: '5-6 emails over 90 days. Day 0: Welcome + logistics. Day 1: Team introductions. Week 1: Key tools and resources. Week 2: Culture and values. Month 1: Check-in and feedback. Month 3: 90-day review prep.',
      emailExampleSubject: 'Day 1 at [Company] — your quick-start guide',
      emailExampleOpener: 'Welcome to the team! Here is everything you need to hit the ground running today.',
    },
    cadences: {
      aggressive: { maxEmails: 6, waitDays: [1, 5, 7, 21, 60], label: 'Full 90-day onboarding' },
      standard: { maxEmails: 4, waitDays: [1, 7, 21], label: 'Standard 30-day onboarding' },
      enterprise: { maxEmails: 3, waitDays: [7, 21], label: 'Light onboarding — experienced hires' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['start_date', 'first_login', 'training_completed', 'first_meeting', 'first_one_on_one'],
  },

  // ═══════════════════════════════════════════════════════════════
  // EDUCATION
  // ═══════════════════════════════════════════════════════════════

  'student-enrollment': {
    id: 'student-enrollment',
    name: 'Student Enrollment',
    tagline: 'Convert inquiries into enrolled students',
    description: 'Nurtures prospective students from inquiry to enrollment. References their interests, program fit, financial aid options, and campus visit availability. Works for universities, bootcamps, and online programs.',
    category: 'education',
    emoji: '🎓',
    terminology: {
      entity: 'prospective student',
      entityPlural: 'prospective students',
      organization: 'institution',
      action: 'enrollment nurture',
      conversion: 'application submitted',
      score: 'enrollment likelihood',
    },
    governance: {
      icpSummary: 'Inquiries and incomplete applications. Priority: high-fit students (matching program criteria), students who started but did not complete applications, event attendees.',
      brandVoiceTone: 'Encouraging, informative, student-focused. Answer their real questions (cost, outcomes, flexibility). Authentic student stories over marketing speak.',
      signalExamples: ['Inquiry submitted', 'Application started but not completed', 'Campus visit scheduled', 'Financial aid form submitted', 'Attended info session'],
      playbookNotes: '4-5 emails over 3-4 weeks. Email 1: Personalized program recommendation based on interests. Email 2: Student success story in their area of interest. Email 3: Financial aid and affordability. Email 4: Campus visit or virtual tour invitation. Email 5: Application deadline reminder.',
      emailExampleSubject: '[Program] at [School] — built for what you are looking for',
      emailExampleOpener: 'Based on your interest in [area], I wanted to share how our [program] is designed for exactly that.',
    },
    cadences: {
      aggressive: { maxEmails: 5, waitDays: [2, 4, 5, 7], label: 'High-fit prospects — full nurture' },
      standard: { maxEmails: 4, waitDays: [3, 5, 7], label: 'Standard enrollment nurture' },
      enterprise: { maxEmails: 3, waitDays: [5, 10], label: 'Early-stage inquiry — light touch' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['inquiry_submitted', 'application_incomplete', 'campus_visit', 'financial_aid', 'info_session_attended'],
  },

  'alumni-engagement': {
    id: 'alumni-engagement',
    name: 'Alumni Engagement',
    tagline: 'Re-engage alumni for events, donations, and mentorship',
    description: 'Keeps alumni connected through personalized outreach. Event invitations, donation campaigns, mentorship opportunities, and career updates. Segments by graduation year, giving history, and engagement level.',
    category: 'education',
    emoji: '🏛️',
    terminology: {
      entity: 'alumnus',
      entityPlural: 'alumni',
      organization: 'institution',
      action: 'alumni engagement',
      conversion: 'engaged (event / donation / mentorship)',
      score: 'engagement score',
    },
    governance: {
      icpSummary: 'Alumni segmented by engagement level, giving history, graduation year, and geographic proximity. Priority: lapsed donors, milestone anniversaries, local alumni for events.',
      brandVoiceTone: 'Nostalgic, community-focused, grateful. Celebrate shared history. Make them feel like they are still part of it. Never make it only about money.',
      signalExamples: ['Graduation anniversary', 'Career milestone (promotion, award)', 'Moved near campus', 'Lapsed donor approaching anniversary', 'Engaged with alumni content'],
      playbookNotes: '2-3 emails per campaign. Lead with community value, not asks. Donation asks only after engagement is established. Event invitations are personalized to their interests and location.',
      emailExampleSubject: '[X] years since graduation — what a ride',
      emailExampleOpener: 'Can you believe it has been [X] years since [shared experience]?',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [5, 7], label: 'Active alumni — full engagement' },
      standard: { maxEmails: 2, waitDays: [7], label: 'Standard alumni outreach' },
      enterprise: { maxEmails: 2, waitDays: [14], label: 'Lapsed alumni — gentle reconnect' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['graduation_anniversary', 'career_milestone', 'geographic_proximity', 'lapsed_donor', 'content_engagement'],
  },

  // ═══════════════════════════════════════════════════════════════
  // REAL ESTATE
  // ═══════════════════════════════════════════════════════════════

  'real-estate-nurture': {
    id: 'real-estate-nurture',
    name: 'Real Estate Lead Nurture',
    tagline: 'Nurture buyer and seller leads until they are ready',
    description: 'Long-cycle nurture for real estate leads. Market updates, new listings matching their criteria, neighborhood insights, and mortgage rate triggers. Works for residential and commercial.',
    category: 'real-estate',
    emoji: '🏠',
    terminology: {
      entity: 'lead',
      entityPlural: 'leads',
      organization: 'brokerage',
      action: 'nurture',
      conversion: 'showing scheduled',
      score: 'readiness score',
    },
    governance: {
      icpSummary: 'Buyer and seller leads. Buyers: segmented by budget, location, property type, timeline. Sellers: segmented by estimated home value, motivation, timeline.',
      brandVoiceTone: 'Local expert, trustworthy advisor, not salesy. Market knowledge is the value. Hyper-local — neighborhood level, not city level.',
      signalExamples: ['Mortgage rate drop', 'New listing matching criteria', 'Home value change in their area', 'Lease expiration approaching', 'Life event (marriage, baby, job relocation)'],
      playbookNotes: '3-4 emails per month (ongoing nurture, not a one-time sequence). Market updates + relevant listings. Personalized to their search criteria. Seasonal insights (best time to buy/sell).',
      emailExampleSubject: 'New listing in [neighborhood] — matches your search',
      emailExampleOpener: 'A [property type] just hit the market in [neighborhood] that fits what you described — [key detail].',
    },
    cadences: {
      aggressive: { maxEmails: 4, waitDays: [5, 5, 7], label: 'Active buyers — ready to move' },
      standard: { maxEmails: 3, waitDays: [7, 14], label: 'Standard nurture' },
      enterprise: { maxEmails: 2, waitDays: [14], label: 'Long-term nurture — not ready yet' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['rate_change', 'new_listing_match', 'home_value_change', 'lease_expiration', 'life_event'],
  },

  // ═══════════════════════════════════════════════════════════════
  // AGENCY & SERVICES
  // ═══════════════════════════════════════════════════════════════

  'agency-outreach': {
    id: 'agency-outreach',
    name: 'Agency New Business',
    tagline: 'Win new clients for your agency or consultancy',
    description: 'New business development for agencies, consultancies, and professional services firms. References the prospect company\'s public presence, identifies gaps, and positions your expertise as the solution.',
    category: 'agency',
    emoji: '💼',
    terminology: {
      entity: 'prospect',
      entityPlural: 'prospects',
      organization: 'company',
      action: 'business development',
      conversion: 'discovery call',
      score: 'opportunity score',
    },
    governance: {
      icpSummary: 'Companies that match your agency\'s sweet spot — right size, right industry, right growth stage. Visible gaps in areas you excel (brand, digital presence, performance marketing, etc.).',
      brandVoiceTone: 'Expert, specific, not generic. Lead with a specific observation about THEIR brand/product/marketing. Show you did your homework. Position as a peer, not a vendor.',
      signalExamples: ['New funding or growth stage', 'Leadership hire in marketing/brand', 'Product launch or rebrand', 'Competitor campaign detected', 'Job posting for in-house role you could fill'],
      playbookNotes: '3 emails. Email 1: Specific observation about their brand/marketing + one insight. Email 2: Mini case study or example relevant to their situation. Email 3: Direct — is this a priority or should I move on?',
      emailExampleSubject: 'Your [specific area] — a quick observation',
      emailExampleOpener: 'I spent some time looking at [their brand/site/campaign] and noticed [specific, constructive observation].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [3, 5], label: 'Warm leads — visible need' },
      standard: { maxEmails: 3, waitDays: [5, 7], label: 'Standard agency outreach' },
      enterprise: { maxEmails: 3, waitDays: [7, 10], label: 'Enterprise prospects — longer runway' },
    },
    discovery: {
      targetTitles: ['CMO', 'VP Marketing', 'Head of Marketing', 'Head of Brand', 'Director of Digital', 'Marketing Director', 'CEO', 'Founder'],
      targetSeniorities: ['c_suite', 'vp', 'director', 'owner'],
      targetDepartments: ['marketing', 'c_suite', 'design'],
    },
    suggestedBudgetTier: 'balanced',
    keySignals: ['funding_round', 'marketing_hire', 'product_launch', 'competitor_campaign', 'in_house_job_posting'],
  },

  // ═══════════════════════════════════════════════════════════════
  // NONPROFIT & FUNDRAISING
  // ═══════════════════════════════════════════════════════════════

  'donor-engagement': {
    id: 'donor-engagement',
    name: 'Donor Engagement',
    tagline: 'Cultivate donors and drive fundraising campaigns',
    description: 'Engages potential and lapsed donors with impact stories, campaign updates, and giving opportunities. Segments by giving history, capacity, and interests. Works for nonprofits, foundations, and cause-based organizations.',
    category: 'nonprofit',
    emoji: '💝',
    terminology: {
      entity: 'donor',
      entityPlural: 'donors',
      organization: 'organization',
      action: 'donor engagement',
      conversion: 'gift made',
      score: 'donor affinity score',
    },
    governance: {
      icpSummary: 'Potential donors, lapsed donors, and major gift prospects. Priority: past donors approaching anniversary, high-capacity prospects with aligned interests, event attendees.',
      brandVoiceTone: 'Grateful, impact-focused, authentic. Lead with stories of impact, not asks. Show exactly where their money goes. Never guilt — inspire.',
      signalExamples: ['Donation anniversary approaching', 'Attended event or gala', 'Engaged with impact content', 'Peer donated', 'Major gift capacity identified', 'End of tax year approaching'],
      playbookNotes: '2-3 emails per campaign. Email 1: Impact story — show what donations made possible. Email 2: Specific giving opportunity tied to their interests. Email 3: Campaign deadline or matching gift window.',
      emailExampleSubject: 'What your support made possible this year',
      emailExampleOpener: 'Because of supporters like you, [specific impact — number of people helped, milestones reached].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [5, 7], label: 'Active donors — campaign push' },
      standard: { maxEmails: 2, waitDays: [7], label: 'Standard donor outreach' },
      enterprise: { maxEmails: 2, waitDays: [14], label: 'Major gift prospects — high touch' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['donation_anniversary', 'event_attended', 'content_engaged', 'peer_donated', 'major_gift_capacity', 'tax_year_end'],
  },

  'volunteer-recruitment': {
    id: 'volunteer-recruitment',
    name: 'Volunteer Recruitment',
    tagline: 'Recruit and activate volunteers for your cause',
    description: 'Outreach to potential volunteers based on skills, interests, location, and availability. Matches opportunities to their profile. Works for nonprofits, community organizations, and campaigns.',
    category: 'nonprofit',
    emoji: '🙋',
    terminology: {
      entity: 'volunteer',
      entityPlural: 'volunteers',
      organization: 'organization',
      action: 'recruitment',
      conversion: 'volunteer signed up',
      score: 'match score',
    },
    governance: {
      icpSummary: 'People with relevant skills, interests, or geographic proximity. Priority: people who expressed interest, referred by existing volunteers, professionals with matching skills.',
      brandVoiceTone: 'Inspiring, community-oriented, low-pressure. Show the impact they can make. Make the commitment clear and manageable. Celebrate existing volunteer stories.',
      signalExamples: ['Interest expressed', 'Referral from existing volunteer', 'Skills match opportunity', 'Located near event/project', 'Previously volunteered (lapsed)'],
      playbookNotes: '2-3 emails. Email 1: Specific opportunity that matches their skills or interests. Email 2: Volunteer spotlight — hear from someone like them. Email 3: Upcoming event or easy first step.',
      emailExampleSubject: 'Your [skill] could make a real difference here',
      emailExampleOpener: 'We have an opportunity coming up that is a perfect fit for someone with your background in [area].',
    },
    cadences: {
      aggressive: { maxEmails: 3, waitDays: [3, 5], label: 'Warm leads — expressed interest' },
      standard: { maxEmails: 2, waitDays: [5], label: 'Standard recruitment' },
      enterprise: { maxEmails: 2, waitDays: [7], label: 'Cold outreach — awareness first' },
    },
    discovery: {
      targetTitles: [],
      targetSeniorities: [],
      targetDepartments: [],
    },
    suggestedBudgetTier: 'conservative',
    keySignals: ['interest_expressed', 'volunteer_referral', 'skill_match', 'geographic_proximity', 'lapsed_volunteer'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

/** Get the current agent mode from env var or default. */
export function getAgentMode(): AgentModeDefinition {
  const modeId = process.env.AGENT_MODE || 'outbound-sdr';
  const mode = AGENT_MODES[modeId];
  if (!mode) {
    throw new Error(
      `Unknown AGENT_MODE "${modeId}". Available modes: ${Object.keys(AGENT_MODES).join(', ')}`
    );
  }
  return mode;
}

/** Get all modes for a given category. */
export function getModesByCategory(category: ModeCategory): AgentModeDefinition[] {
  return Object.values(AGENT_MODES).filter((m) => m.category === category);
}

/** Get all available mode IDs. */
export function getAvailableModes(): string[] {
  return Object.keys(AGENT_MODES);
}

/** Get a mode by ID, or undefined if not found. */
export function getModeById(id: string): AgentModeDefinition | undefined {
  return AGENT_MODES[id];
}
