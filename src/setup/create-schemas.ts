import { client } from '../config.js';
import { logger } from '../lib/logger.js';

async function createSchemas() {
  const existing = await client.collections.list();
  const existingSlugs = existing.data?.map((c: any) => c.slug) || [];

  if (!existingSlugs.includes('contacts')) {
    await client.collections.create({
      name: 'Contacts',
      slug: 'contacts',
      description: 'Prospecting contacts from CRM, enrichment tools, and inbound',
      icon: 'user',
      color: '#3B82F6',
      primaryKeyField: 'email',
      properties: [
        { propertyName: 'First Name', systemName: 'first_name', type: 'text', autoSystem: false, description: "Contact's first name" },
        { propertyName: 'Last Name', systemName: 'last_name', type: 'text', autoSystem: false, description: "Contact's last name" },
        { propertyName: 'Email', systemName: 'email', type: 'text', autoSystem: false, description: 'Primary email address' },
        { propertyName: 'Phone', systemName: 'phone_number', type: 'text', autoSystem: false, description: 'Direct phone number' },
        { propertyName: 'LinkedIn URL', systemName: 'linkedin_url', type: 'text', autoSystem: false, description: 'LinkedIn profile URL' },
        { propertyName: 'Company Name', systemName: 'company_name', type: 'text', autoSystem: true, description: 'Current employer' },
        { propertyName: 'Company Website', systemName: 'company_website', type: 'text', autoSystem: true, description: 'Company domain' },
        { propertyName: 'Job Title', systemName: 'job_title', type: 'text', autoSystem: true, description: 'Current role/title at their company' },
        { propertyName: 'Seniority Level', systemName: 'seniority_level', type: 'options', autoSystem: true, options: ['IC', 'Manager', 'Director', 'VP', 'C-Suite', 'Founder'], description: 'Level in org hierarchy' },
        { propertyName: 'Department', systemName: 'department', type: 'options', autoSystem: true, options: ['Engineering', 'Sales', 'Marketing', 'Product', 'Finance', 'HR', 'Operations', 'Executive'], description: 'Department within the company' },
        { propertyName: 'Decision Maker', systemName: 'decision_maker', type: 'boolean', autoSystem: true, description: 'Whether this person can approve purchases' },
        { propertyName: 'ICP Match', systemName: 'icp_match', type: 'boolean', autoSystem: true, description: 'Whether this contact matches our ideal customer profile' },
        { propertyName: 'Lead Status', systemName: 'lead_status', type: 'options', autoSystem: true, options: ['New', 'Researching', 'Qualified', 'Contacted', 'Engaged', 'Meeting Set', 'Opportunity', 'Customer', 'Disqualified'], description: 'Current status in the lead lifecycle' },
        { propertyName: 'Lead Score', systemName: 'lead_score', type: 'number', autoSystem: true, description: '0-100 composite score based on ICP fit, engagement signals, and buying intent' },
        { propertyName: 'Pain Points', systemName: 'pain_points', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Specific challenges, frustrations, or needs mentioned or inferred from conversations and activity' },
        { propertyName: 'Interests & Topics', systemName: 'interests_topics', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Professional interests, topics they engage with' },
        { propertyName: 'Communication Style', systemName: 'communication_style', type: 'text', autoSystem: true, description: 'Preferred tone: direct/consultative/technical/casual' },
        { propertyName: 'Sentiment', systemName: 'sentiment', type: 'options', autoSystem: true, options: ['Positive', 'Neutral', 'Skeptical', 'Frustrated'], description: 'Current sentiment toward us' },
        { propertyName: 'Responsive', systemName: 'responsive', type: 'boolean', autoSystem: true, description: "Whether they've responded to any outreach" },
        { propertyName: 'Competitors Mentioned', systemName: 'competitors_mentioned', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Competitor products/services this contact has referenced' },
        { propertyName: 'Outreach Stage', systemName: 'outreach_stage', type: 'options', autoSystem: true, options: ['Not Started', 'Email 1 Sent', 'Email 2 Sent', 'Email 3 Sent', 'Replied', 'Meeting Booked', 'Opted Out'], description: 'Current position in the outreach sequence' },
        { propertyName: 'Last Contacted', systemName: 'last_contacted', type: 'date', autoSystem: true, description: 'Date of most recent outreach attempt' },
        { propertyName: 'Source', systemName: 'source', type: 'options', autoSystem: false, options: ['HubSpot', 'Salesforce', 'Apollo', 'ZoomInfo', 'Surfe', 'LinkedIn', 'Inbound', 'Referral', 'CSV'], description: 'Where this contact was sourced from' },
        { propertyName: 'CRM ID', systemName: 'crm_id', type: 'text', autoSystem: false, description: 'HubSpot or Salesforce record ID for writeback' },
        { propertyName: 'Assigned Sender', systemName: 'assigned_sender', type: 'text', autoSystem: true, description: 'Sender Profile ID (sp_xxx). All outreach to this contact comes from this stable sender identity. Set by strategizer or auto-assignment. When the sender email rotates, this ID stays the same — only the profile\'s activeAccountId changes.' },
        { propertyName: 'Role Owner', systemName: 'role_owner', type: 'options', autoSystem: true, options: ['sdr', 'ae', 'csm', 'unassigned'], description: 'Which sales org role currently owns this contact. SDR for prospecting, AE for deal management, CSM for post-sale. Handoffs between roles are automatic based on lead lifecycle. When SALES_ORG_ENABLED=false, this field is unused.' },
        { propertyName: 'Role History', systemName: 'role_owner_history', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Audit trail of role ownership changes. Each entry: { fromRole, toRole, reason, changedBy, timestamp }. Append only.' },

        // ─── Workspace Properties (shared coordination surface) ────
        { propertyName: 'Context', systemName: 'context', type: 'text', autoSystem: true, description: 'Current lead state summary — enrichment status, ICP score, sequence step, last engagement, recommended next action. Rewritten each cycle by whichever agent has the latest understanding. This is the "start here" for anyone engaging with this lead.' },
        { propertyName: 'Updates', systemName: 'updates', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Chronological timeline of everything that happened. Each entry: { author, type (enrichment|signal|outreach|engagement|system), summary, details, timestamp }. Append only — this is how agents and humans see what others have done.' },
        { propertyName: 'Pending Tasks', systemName: 'pending_tasks', type: 'array', autoSystem: false, description: 'Active tasks only. JSON array managed by code — use workspace.addTask() / completeTask() / declineTask(). Each entry: { taskId, title, description, owner, priority, createdBy, createdAt, dueDate }. Task history is tracked automatically via propertyHistory().' },
        { propertyName: 'Notes', systemName: 'notes', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Knowledge and observations from any contributor. Each entry: { author, content, category (observation|analysis|enrichment|signal|reply-analysis), timestamp }. Append only. Enrichment data, signal analysis, reply sentiment — all stored here.' },
        { propertyName: 'Open Issues', systemName: 'open_issues', type: 'array', autoSystem: false, description: 'Active issues only. JSON array managed by code — use workspace.raiseIssue() / resolveIssue(). Each entry: { issueId, title, description, severity, status (open|investigating), raisedBy, raisedAt }. Issue history is tracked automatically via propertyHistory().' },
        { propertyName: 'Messages Sent', systemName: 'messages_sent', type: 'array', autoSystem: false, updateSemantics: 'append', description: 'Every outreach message sent. Each entry: { channel (email|call|linkedin), subject, bodyPreview, step, angle, sentBy, senderProfileId, senderEmail, status (sent|delivered|opened|clicked|replied|bounced), sentAt }. The definitive record of what was communicated and who sent it.' },

        // ─── Sequence State (deterministic, no semantic search needed) ────
        { propertyName: 'Emails Sent', systemName: 'emails_sent', type: 'number', autoSystem: false, description: 'Count of outreach emails sent in current sequence. Updated by workspace.addMessageSent(). Used for cadence gating — no regex parsing needed.' },
        { propertyName: 'Last Sent At', systemName: 'last_sent_at', type: 'date', autoSystem: false, description: 'ISO timestamp of most recent outreach email. Used for timing gap checks between sequence steps.' },
        { propertyName: 'Sequence Status', systemName: 'sequence_status', type: 'options', autoSystem: false, options: ['Active', 'Replied', 'Bounced', 'Opted Out', 'Complete', 'Paused'], description: 'Current outreach sequence state. Updated on engagement events (reply, bounce, unsubscribe) and sequence completion. Used for deterministic stop-signal checks.' },
      ],
    });
    logger.info('Created Contacts collection (with workspace properties)');
  } else {
    logger.info('Contacts collection already exists');
  }

  if (!existingSlugs.includes('companies')) {
    await client.collections.create({
      name: 'Companies',
      slug: 'companies',
      description: 'Target accounts with firmographics, buying signals, and health tracking',
      icon: 'building',
      color: '#8B5CF6',
      primaryKeyField: 'website',
      properties: [
        { propertyName: 'Company Name', systemName: 'company_name', type: 'text', autoSystem: false, description: 'Legal or common company name' },
        { propertyName: 'Website', systemName: 'website', type: 'text', autoSystem: false, description: 'Primary company domain' },
        { propertyName: 'Industry', systemName: 'industry', type: 'text', autoSystem: true, description: 'Primary industry vertical' },
        { propertyName: 'Employee Count', systemName: 'employee_count', type: 'number', autoSystem: false, description: 'Total headcount' },
        { propertyName: 'Annual Revenue', systemName: 'annual_revenue', type: 'number', autoSystem: false, description: 'Estimated annual revenue in USD' },
        { propertyName: 'Headquarters', systemName: 'headquarters', type: 'text', autoSystem: false, description: 'City, State/Country of HQ' },
        { propertyName: 'Funding Stage', systemName: 'funding_stage', type: 'options', autoSystem: true, options: ['Bootstrapped', 'Seed', 'Series A', 'Series B', 'Series C+', 'Public'], description: 'Current funding stage' },
        { propertyName: 'Latest Funding Amount', systemName: 'latest_funding_amount', type: 'number', autoSystem: true, description: 'Most recent funding round amount in USD' },
        { propertyName: 'Latest Funding Date', systemName: 'latest_funding_date', type: 'date', autoSystem: true, description: 'Date of most recent funding round' },
        { propertyName: 'Technology Stack', systemName: 'technology_stack', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Technologies, tools, and platforms the company uses' },
        { propertyName: 'Business Model', systemName: 'business_model', type: 'options', autoSystem: true, options: ['B2B', 'B2C', 'B2B2C', 'Marketplace', 'Platform'], description: 'Primary business model' },
        { propertyName: 'ICP Fit Score', systemName: 'icp_fit_score', type: 'number', autoSystem: true, description: '0-100 score of how well this company matches the ideal customer profile' },
        { propertyName: 'Buying Signals', systemName: 'buying_signals', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Observed signals: hiring surges, new funding, tech adoption, job postings, expansion' },
        { propertyName: 'Signal Strength', systemName: 'signal_strength', type: 'options', autoSystem: true, options: ['None', 'Weak', 'Moderate', 'Strong', 'Very Strong'], description: 'Aggregate strength of all buying signals detected' },
        { propertyName: 'Key Decision Makers', systemName: 'key_decision_makers', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Names and titles of known decision makers' },
        { propertyName: 'Competitors Using', systemName: 'competitors_using', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Competitor products this company currently uses' },
        { propertyName: 'Company Summary', systemName: 'company_summary', type: 'text', autoSystem: true, description: 'AI-generated summary of what the company does, recent activity, and relevance' },
        { propertyName: 'Account Status', systemName: 'account_status', type: 'options', autoSystem: true, options: ['New Target', 'Researching', 'Prospecting', 'Engaged', 'Opportunity', 'Customer', 'Churned', 'Disqualified'], description: 'Current stage in the account lifecycle' },
        { propertyName: 'Hiring Velocity', systemName: 'hiring_velocity', type: 'options', autoSystem: true, options: ['Stable', 'Moderate Growth', 'Rapid Growth', 'Contracting'], description: 'Current hiring trend' },
        { propertyName: 'CRM Account ID', systemName: 'crm_account_id', type: 'text', autoSystem: false, description: 'HubSpot or Salesforce account ID for writeback' },

        // ─── Account Workspace Properties (shared coordination surface) ────
        { propertyName: 'Account Context', systemName: 'account_context', type: 'text', autoSystem: true, description: 'Current account state summary — strategy, health, coordination flags, recommended actions. Rewritten each strategy evaluation cycle. This is the "start here" for anyone engaging with this account.' },
        { propertyName: 'Account Updates', systemName: 'account_updates', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Chronological timeline of account-level events. Each entry: { author, type (strategy|coordination|signal|escalation|system|human), summary, details, timestamp }. Append only — this is how agents and humans see what happened at the account level.' },
        { propertyName: 'Account Pending Tasks', systemName: 'account_pending_tasks', type: 'array', autoSystem: false, description: 'Active account-level tasks only. JSON array managed by code — use accountWorkspace.addTask() / completeTask() / declineTask(). Each entry: { taskId, title, description, owner, priority, createdBy, createdAt, dueDate }. Task history tracked automatically via propertyHistory().' },
        { propertyName: 'Account Notes', systemName: 'account_notes', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Account-level knowledge and observations from any contributor. Each entry: { author, content, category (observation|analysis|competitive-intel|strategy|coordination), timestamp }. Append only.' },
        { propertyName: 'Account Open Issues', systemName: 'account_open_issues', type: 'array', autoSystem: false, description: 'Active account-level issues only. JSON array managed by code — use accountWorkspace.raiseIssue() / resolveIssue(). Each entry: { issueId, title, description, severity, status (open|investigating), raisedBy, raisedAt }. Issue history tracked automatically via propertyHistory().' },
      ],
    });
    logger.info('Created Companies collection (with account workspace properties)');
  } else {
    logger.info('Companies collection already exists');
  }

  if (!existingSlugs.includes('outreach-log')) {
    await client.collections.create({
      name: 'Outreach Log',
      slug: 'outreach-log',
      description: 'Track every outreach touch for feedback loop and sequence management',
      icon: 'mail',
      color: '#10B981',
      primaryKeyField: 'contact_email',
      properties: [
        { propertyName: 'Contact Email', systemName: 'contact_email', type: 'text', autoSystem: false, description: 'Email of the recipient' },
        { propertyName: 'Company', systemName: 'company', type: 'text', autoSystem: true, description: "Recipient's company" },
        { propertyName: 'Sequence Step', systemName: 'sequence_step', type: 'options', autoSystem: false, options: ['Email 1', 'Email 2', 'Email 3', 'Call Task', 'LinkedIn Touch'], description: 'Which step in the outreach sequence' },
        { propertyName: 'Channel', systemName: 'channel', type: 'options', autoSystem: false, options: ['Email', 'Phone', 'LinkedIn', 'SMS'], description: 'Delivery channel used' },
        { propertyName: 'Subject Line', systemName: 'subject_line', type: 'text', autoSystem: false, description: 'Email subject used' },
        { propertyName: 'Content Summary', systemName: 'content_summary', type: 'text', autoSystem: true, description: 'Brief summary of what was sent' },
        { propertyName: 'Angle Used', systemName: 'angle_used', type: 'text', autoSystem: true, description: 'The personalization angle/hook used' },
        { propertyName: 'Sent At', systemName: 'sent_at', type: 'date', autoSystem: false, description: 'Timestamp of delivery' },
        { propertyName: 'Opened', systemName: 'opened', type: 'boolean', autoSystem: false, description: 'Whether the email was opened' },
        { propertyName: 'Clicked', systemName: 'clicked', type: 'boolean', autoSystem: false, description: 'Whether any link was clicked' },
        { propertyName: 'Replied', systemName: 'replied', type: 'boolean', autoSystem: false, description: 'Whether the recipient replied' },
        { propertyName: 'Reply Sentiment', systemName: 'reply_sentiment', type: 'options', autoSystem: true, options: ['Positive', 'Neutral', 'Negative', 'Out of Office', 'Unsubscribe'], description: 'Sentiment of the reply' },
        { propertyName: 'Outcome', systemName: 'outcome', type: 'options', autoSystem: true, options: ['No Response', 'Opened', 'Clicked', 'Replied', 'Meeting Booked', 'Rejected', 'Bounced'], description: 'Final outcome of this outreach touch' },
      ],
    });
    logger.info('Created Outreach Log collection');
  } else {
    logger.info('Outreach Log collection already exists');
  }

  if (!existingSlugs.includes('web-research')) {
    await client.collections.create({
      name: 'Web Research',
      slug: 'web-research',
      description: 'Tavily web search results for company research — news, funding, hiring, competitive intel',
      icon: 'search',
      color: '#F59E0B',
      primaryKeyField: 'domain',
      properties: [
        { propertyName: 'Domain', systemName: 'domain', type: 'text', autoSystem: false, description: 'Company domain that was researched' },
        { propertyName: 'Company Name', systemName: 'company_name', type: 'text', autoSystem: false, description: 'Company name' },
        { propertyName: 'Search Queries', systemName: 'search_queries', type: 'array', autoSystem: false, description: 'Tavily search queries used for this research' },
        { propertyName: 'Result Count', systemName: 'result_count', type: 'number', autoSystem: true, description: 'Number of web results returned' },
        { propertyName: 'Top Result URL', systemName: 'top_result_url', type: 'text', autoSystem: true, description: 'URL of the highest-scoring search result' },
        { propertyName: 'AI Summary', systemName: 'ai_summary', type: 'text', autoSystem: true, description: 'AI-generated summary of research findings — company activity, market position, recent news' },
        { propertyName: 'Research Date', systemName: 'research_date', type: 'date', autoSystem: false, description: 'When this research was performed' },
        { propertyName: 'Source', systemName: 'source', type: 'options', autoSystem: false, options: ['Tavily', 'Exa', 'Manual'], description: 'Which search API produced these results' },
        { propertyName: 'Signals Found', systemName: 'signals_found', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Buying signals extracted from research: funding rounds, hiring surges, product launches, partnerships, expansion, leadership changes' },
        { propertyName: 'Personalization Angles', systemName: 'personalization_angles', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Outreach angle ideas derived from research — specific hooks referencing recent news, launches, or company activity' },
        { propertyName: 'Competitors Mentioned', systemName: 'competitors_mentioned', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Competitor products or companies mentioned in search results' },
        { propertyName: 'Key People Mentioned', systemName: 'key_people_mentioned', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Executives, founders, or key people mentioned in news articles' },
        { propertyName: 'News Headlines', systemName: 'news_headlines', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Top news headlines found during research, with dates if available' },
        { propertyName: 'Technology References', systemName: 'technology_references', type: 'array', autoSystem: true, updateSemantics: 'append', description: 'Technologies, platforms, or tools mentioned in search results — supplements Apollo tech stack data' },
      ],
    });
    logger.info('Created Web Research collection');
  } else {
    logger.info('Web Research collection already exists');
  }

  logger.info('Schema setup complete.');
}

createSchemas().catch((e) => {
  logger.error('Schema creation failed', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
