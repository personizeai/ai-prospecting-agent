import { client } from '../config.js';
import { logger } from '../lib/logger.js';

const GOVERNANCE_VARIABLES = [
  {
    name: 'ICP Definition',
    slug: 'icp-definition',
    content: `
## Ideal Customer Profile

### Company Criteria
- Industry: B2B SaaS, Technology, Professional Services
- Employee count: 50-2,000
- Annual revenue: $5M-$500M
- Growth stage: Series A through Series C+, or profitable and scaling
- Tech stack: Uses CRM (HubSpot or Salesforce), has a sales team of 5+

### Contact Criteria
- Title: VP Sales, VP Revenue, Head of Sales, CRO, VP Business Development, Director of Sales Ops, Revenue Operations Manager
- Seniority: Director, VP, or C-Suite
- Department: Sales, Revenue, Business Development, Sales Operations

### Disqualification Criteria
- Companies with <20 employees (too small for ROI)
- Companies already using [your product] (existing customers)
- Government/non-profit (different sales motion)
- No sales team or outbound motion

### Scoring Weights
- ICP fit (firmographics): 40%
- Buying signals (timing): 30%
- Engagement signals (behavior): 20%
- Champion potential (title + seniority): 10%
    `.trim(),
    triggerKeywords: ['icp', 'ideal customer', 'qualification', 'scoring', 'target', 'fit'],
  },
  {
    name: 'Brand Voice',
    slug: 'brand-voice',
    content: `
## Brand Voice for Outbound

### Tone
- Confident but not arrogant
- Conversational, not corporate
- Direct \u2014 get to the point in the first sentence
- Knowledgeable \u2014 reference specifics, not generics

### Rules
- NEVER start with "I hope this email finds you well" or "I'm reaching out because"
- NEVER use "synergy", "leverage", "touch base", "circle back"
- NEVER claim results or case studies that aren't provided in context
- First sentence must be about THEM, not us
- Keep emails under 150 words for first touch, under 120 for follow-ups
- One clear CTA per email \u2014 never two asks
- Sign off with first name only, no title spam

### Personalization Rules
- Reference at least ONE specific fact about the person or company
- The fact must come from memory context \u2014 never invented
- If no specific facts available, use industry-level relevance instead
- Don't over-personalize: mentioning their dog's name is creepy, mentioning their recent Series B is relevant
    `.trim(),
    triggerKeywords: ['voice', 'tone', 'writing', 'email', 'outreach', 'style', 'brand'],
  },
  {
    name: 'Outreach Playbook',
    slug: 'outreach-playbook',
    content: `
## Outreach Sequence Rules

### Sequence Structure
- 3 emails maximum per contact per sequence
- Email 1: Specific observation + value prop + soft CTA (e.g., "worth a look?")
- Email 2: New angle/insight + their situation + medium CTA (e.g., "open to a quick call?")
- Email 3: Brief + final reason + binary CTA (e.g., "yes or no \u2014 should I stop reaching out?")

### Timing
- Minimum 3 business days between emails
- Never send on weekends or holidays
- Best send windows: Tue-Thu, 8-10am or 2-4pm recipient's timezone
- If they reply at any point, stop the sequence \u2014 human takes over

### Channel Rules
- Email is default for cold outreach
- LinkedIn connection request only AFTER Email 1 (not simultaneously)
- Phone call task created only for contacts scored 80+ who opened Email 1
- SMS never used for cold outreach

### Opt-Out
- Every email must include an unsubscribe mechanism
- If someone replies "not interested" or "remove me", immediately mark as Opted Out
- Never re-enroll an opted-out contact

### Escalation
- If a contact opens all 3 emails but doesn't reply \u2192 notify rep on Slack
- If a contact replies with interest \u2192 notify rep immediately + create HubSpot task
- If a contact replies negatively \u2192 log it, do not follow up
    `.trim(),
    triggerKeywords: ['sequence', 'outreach', 'cadence', 'email', 'timing', 'playbook', 'rules'],
  },
  {
    name: 'Signal Definitions',
    slug: 'signal-definitions',
    content: `
## Buying Signal Definitions

### Strong Signals (Score +30)
- New funding round announced in last 90 days
- Hiring 3+ sales/revenue roles simultaneously
- New CRO/VP Sales hired in last 60 days
- Competitor contract renewal coming up (known from intel)
- Published content about scaling sales/revenue operations

### Moderate Signals (Score +15)
- Job posting for sales ops or revenue ops roles
- Company headcount grew 20%+ in last 6 months
- Expanded to new market/geography
- Mentioned pain points we solve in public content
- Attended relevant industry event or webinar

### Weak Signals (Score +5)
- General hiring activity
- Website traffic increase
- Social media engagement on sales-related topics
- Industry trend affecting their vertical

### Negative Signals (Score -20)
- Recent layoffs (especially in sales)
- Funding round failed or down round
- Just signed with a competitor (wait 12 months)
- Company in acquisition talks
- Contact left the company
    `.trim(),
    triggerKeywords: ['signal', 'buying', 'intent', 'trigger', 'scoring', 'timing'],
  },
  {
    name: 'Competitor Policy',
    slug: 'competitor-policy',
    content: `
## Competitor Handling Rules

### Known Competitors
- [Competitor A]: Strengths \u2014 [X]. Our advantage \u2014 [Y].
- [Competitor B]: Strengths \u2014 [X]. Our advantage \u2014 [Y].
- [Competitor C]: Strengths \u2014 [X]. Our advantage \u2014 [Y].

### Rules
- NEVER badmouth competitors in outreach
- NEVER make comparison claims without verified data
- If a prospect uses a competitor, acknowledge it: "I know you're using [X]..."
- Position as complementary or as a better fit for their specific situation
- Only mention competitors if the prospect brought them up first (visible in memory context)
- When displacing: focus on what we do differently, not what they do wrong
    `.trim(),
    triggerKeywords: ['competitor', 'competitive', 'displacement', 'alternative', 'vs', 'compare'],
  },
  {
    name: 'Multi-Channel Outreach Rules',
    slug: 'multichannel-rules',
    content: `
## Multi-Channel Outreach Rules

### Channel Sequencing
- Email is ALWAYS the first touch. Never lead with LinkedIn or phone.
- LinkedIn connection request goes out AFTER Email 1 (not simultaneously).
- Phone call task is created ONLY for contacts scored 80+ who have a phone number.
- Typical sequence: Email 1 → LinkedIn Connect → Email 2 → Call → Email 3 → LinkedIn Message
- If any channel gets a response, STOP all other channels immediately.

### LinkedIn Rules
- Connection request note: MAX 300 characters (hard LinkedIn limit)
- Never say "I saw your profile" — everyone says that
- Reference ONE specific fact about them or their company
- Connection note should NOT include a meeting ask — save that for the follow-up message
- Max 1 connection request + 1 message per contact (don't spam on LinkedIn)
- LinkedIn tone is more casual than email — no "Dear" or formal closings

### Phone Call Rules
- Calls are for HIGH-INTENT contacts only (ICP 80+, ideally with a signal)
- Call within 2 hours of a reply if possible (speed to lead)
- Never call before 8am or after 6pm in the contact's timezone
- If voicemail: leave a 20-second message referencing the email, don't pitch
- If live: use the structured script (opener → hook → ask), don't freestyle
- Always offer a specific meeting time, not "sometime this week"

### AI Caller Rules (Bland.ai / Vapi)
- AI callers must identify themselves: "Hi, this is [Name] calling from [Company]"
- Never claim to be human — if asked "are you a robot?", say "I'm an AI assistant calling on behalf of [Name]"
- Max call duration: 3 minutes for cold calls
- If the prospect seems annoyed, end the call politely: "I understand, I'll send you an email with more details"
- Always end with a clear next step: "I'll send you a calendar link" or "I'll have [Name] follow up"

### Call Script Playbook (For Human SDRs)
- **Mindset**: You're a peer helping them solve a problem, not a salesperson begging for time
- **Pacing**: Speak slowly and clearly. Pause after your opener — let them react
- **Mirror**: Match their energy. If they're rushed, be concise. If they're chatty, lean in
- **The 10-second rule**: If you haven't said something relevant about THEM in the first 10 seconds, you've lost them
- **Objection = Interest**: A "not interested" said slowly is different from a "NOT INTERESTED" said fast. The slow one is worth pursuing
- **Voicemail**: Keep it under 20 seconds. Name, company, ONE reason to call back, phone number. That's it
    `.trim(),
    triggerKeywords: ['linkedin', 'phone', 'call', 'multichannel', 'channel', 'sequence', 'voicemail', 'ai caller'],
  },
  {
    name: 'Meeting Booking Links',
    slug: 'meeting-booking-links',
    content: `
## Meeting Booking Configuration

### Sender-to-Booking-Link Mapping
Map each sender email to their personal booking link. The AI will include
the correct link in outreach emails and call scripts based on who is sending.

Format: sender_email → booking_url

- default → https://calendly.com/your-team/30min
- (Add your sender-specific links below)
- alice@company.com → https://calendly.com/alice/30min
- bob@company.com → https://calendly.com/bob/30min

### Rules
- Every email that includes a CTA for a meeting SHOULD include a booking link
- Use the sender-specific link if available, otherwise use the default
- NEVER include a booking link in Email 1 (too aggressive) — use a soft CTA instead
- Email 2+ and LinkedIn messages CAN include a booking link
- Call scripts should ALWAYS reference the booking link: "I'll send you a link to grab 15 minutes"
- Format in emails: use a plain text link, not a button (better deliverability)
    `.trim(),
    triggerKeywords: ['booking', 'calendly', 'meeting', 'link', 'calendar', 'schedule', 'cal.com'],
  },
  {
    name: 'Email Format & Examples',
    slug: 'email-format-examples',
    content: `
## Email Format Guidelines

### Required HTML Structure
All email bodies MUST use these HTML tags:
- \`<p>\` — wrap every paragraph
- \`<b>\` or \`<strong>\` — for emphasis (use sparingly)
- \`<i>\` or \`<em>\` — for names or titles
- \`<a href="...">\` — for links (always include href)
- \`<br>\` — for line breaks within a paragraph

### Forbidden HTML (NEVER use)
- \`<div>\`, \`<span>\`, \`<table>\`, \`<img>\`
- Inline styles (\`style="..."\`)
- Tracking pixels or images
- \`<script>\` or \`<style>\` blocks

### Email 1 Example (Cold Open — max 150 words)
Subject: Quick thought on [specific observation]

\`\`\`html
<p>Hi [First Name],</p>
<p>I noticed [specific, verifiable fact about them or their company — e.g., "you just closed your Series B" or "you're hiring 4 SDRs"]. [One sentence connecting that fact to a pain point we solve].</p>
<p>[One sentence value prop — what we do, not who we are].</p>
<p>Worth a quick look?</p>
<p>[Sender first name]</p>
\`\`\`

### Email 2 Example (Follow-up, New Angle — max 120 words)
Subject: [Different angle from Email 1]

\`\`\`html
<p>Hi [First Name],</p>
<p>[New insight or angle — completely different from Email 1]. [How this specifically relates to their situation].</p>
<p>Open to a 15-min call this week?</p>
<p>[Sender first name]</p>
\`\`\`

### Email 3 Example (Final, Direct — max 100 words)
Subject: Should I close the loop?

\`\`\`html
<p>Hi [First Name],</p>
<p>[One compelling reason to respond — tie back to their specific situation]. [Binary CTA — yes or no question].</p>
<p>Either way, no hard feelings.</p>
<p>[Sender first name]</p>
\`\`\`

### Anti-Patterns (NEVER do these)
- Walls of text without \`<p>\` tags
- Multiple CTAs in one email
- Invented statistics, case studies, or testimonials
- Generic "companies like yours" language
- Subject lines with ALL CAPS or excessive punctuation (!!!)
- Starting with "I hope this email finds you well"
- Unsubscribe text in the body (handled by email infrastructure)
    `.trim(),
    triggerKeywords: ['email', 'html', 'format', 'template', 'example', 'guidelines', 'structure'],
  },
];

async function createGovernance() {
  logger.info('Creating governance variables...');

  // Fetch existing guidelines for idempotency
  let existingSlugs: string[] = [];
  try {
    const existing = await client.guidelines.list();
    existingSlugs = existing.data?.map((g: any) => g.slug) || [];
  } catch {
    // If list fails, proceed and let create handle conflicts
  }

  for (const variable of GOVERNANCE_VARIABLES) {
    if (existingSlugs.includes(variable.slug)) {
      logger.info('Skipped (already exists)', { name: variable.name });
      continue;
    }

    await client.guidelines.create(variable);
    logger.info('Created governance variable', { name: variable.name });
  }

  logger.info('Governance setup complete. Update the content in Personize dashboard with your specific details.');
}

createGovernance().catch((e) => {
  logger.error('Governance creation failed', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
