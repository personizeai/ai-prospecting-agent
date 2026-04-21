#!/usr/bin/env node
/**
 * Revenue OS MCP Server
 *
 * Exposes Revenue OS operations as MCP tools so Claude (via Cowork/Desktop/OpenClaw)
 * can directly operate the sales pipeline: search contacts, discover leads, research
 * companies, manage campaigns, trigger outreach, and check status.
 *
 * Setup:
 *   A .mcp.json is included in the repo root. It reads credentials from your .env
 *   file (configured in Phase 3 of SETUP-GUIDE.md) — no need to duplicate keys.
 *
 *   For manual setup, add to Claude's MCP config:
 *   {
 *     "mcpServers": {
 *       "revenue-os": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp-server.ts"],
 *         "cwd": "/path/to/revenue-os"
 *       }
 *     }
 *   }
 *
 * See MCP-TOOLS.md for the full tool reference with payloads and example responses.
 */

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { client } from './config.js';
import { memory } from './lib/memory.js';
import { searchPeople, enrichPerson, enrichOrganization, isApolloConfigured } from './lib/apollo.js';
import { searchTavily, isTavilyConfigured } from './lib/tavily.js';
import { senderProfiles } from './lib/sender-profiles.js';
import { campaigns } from './lib/campaign.js';
import { collectDailyMetrics } from './lib/metrics.js';
import { memoryCrud } from './lib/personize-crud.js';

const server = new McpServer({
  name: 'revenue-os',
  version: '1.0.0',
});

// ═══════════════════════════════════════════════════════════════════
// CONTACT DISCOVERY & ENRICHMENT
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'apollo_search_contacts',
  `Search Apollo for contacts at a company. FREE — 0 credits. Use this to find leads at target accounts.
Returns: name, title, email, LinkedIn, seniority, department.`,
  {
    domain: z.string().describe('Company domain to search (e.g., "acme.com")'),
    titles: z.array(z.string()).optional().describe('Job titles to match (e.g., ["CTO", "VP Engineering"])'),
    seniorities: z.array(z.string()).optional().describe('Seniority levels: c_suite, vp, director, manager, senior, entry'),
    departments: z.array(z.string()).optional().describe('Departments to filter by'),
    per_page: z.number().optional().describe('Results per page (1-100, default 25)'),
  },
  async ({ domain, titles, seniorities, departments, per_page }) => {
    if (!isApolloConfigured()) {
      return { content: [{ type: 'text' as const, text: 'Apollo API key not configured. Set APOLLO_API_KEY in .env.' }] };
    }

    const result = await searchPeople({
      organizationDomains: [domain],
      personTitles: titles,
      personSeniorities: seniorities,
      personDepartments: departments,
      perPage: per_page || 25,
    });

    const contacts = result.people.map(p => ({
      name: `${p.first_name} ${p.last_name}`,
      title: p.title,
      email: p.email,
      email_status: p.email_status,
      linkedin: p.linkedin_url,
      seniority: p.seniority,
      departments: p.departments,
      company: p.organization?.name || domain,
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          total: result.pagination.total_entries,
          page: result.pagination.page,
          contacts,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'apollo_enrich_contact',
  `Enrich a contact with Apollo data. Costs 1 credit. Returns: full name, title, email, LinkedIn, phone, seniority, company details.`,
  {
    email: z.string().describe('Email address to enrich'),
  },
  async ({ email }) => {
    if (!isApolloConfigured()) {
      return { content: [{ type: 'text' as const, text: 'Apollo API key not configured.' }] };
    }

    const person = await enrichPerson(email);
    if (!person) {
      return { content: [{ type: 'text' as const, text: `No Apollo data found for ${email}` }] };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          name: `${person.first_name} ${person.last_name}`,
          title: person.title,
          email: person.email,
          linkedin: person.linkedin_url,
          phone: person.phone_numbers?.[0]?.raw_number || '',
          seniority: person.seniority,
          departments: person.departments,
          company: person.organization ? {
            name: person.organization.name,
            domain: person.organization.primary_domain,
            industry: person.organization.industry,
            employees: person.organization.estimated_num_employees,
            funding: person.organization.total_funding_printed,
          } : null,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'apollo_enrich_company',
  `Enrich a company with Apollo data. Costs 1 credit. Returns: industry, employees, funding, revenue, tech stack, keywords.`,
  {
    domain: z.string().describe('Company domain to enrich (e.g., "acme.com")'),
  },
  async ({ domain }) => {
    if (!isApolloConfigured()) {
      return { content: [{ type: 'text' as const, text: 'Apollo API key not configured.' }] };
    }

    const org = await enrichOrganization(domain);
    if (!org) {
      return { content: [{ type: 'text' as const, text: `No Apollo data found for ${domain}` }] };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          name: org.name,
          domain: org.primary_domain,
          industry: org.industry,
          employees: org.estimated_num_employees,
          revenue: org.annual_revenue_printed,
          funding: org.total_funding_printed,
          funding_stage: org.latest_funding_stage,
          founded: org.founded_year,
          technologies: org.technologies,
          keywords: org.keywords,
          location: `${org.city}, ${org.state}, ${org.country}`,
          description: org.short_description,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'discover_and_memorize_contacts',
  `Search Apollo for contacts at a company, then memorize qualified ones to Personize.
This is the "find leads and add them to the pipeline" tool.
FREE Apollo search (0 credits) + Personize memorize.`,
  {
    domain: z.string().describe('Company domain to search'),
    titles: z.array(z.string()).optional().describe('Target job titles'),
    seniorities: z.array(z.string()).optional().describe('Target seniority levels'),
    campaign_id: z.string().optional().describe('Campaign to enroll qualified contacts in'),
    max_contacts: z.number().optional().describe('Max contacts to memorize (default 10)'),
  },
  async ({ domain, titles, seniorities, campaign_id, max_contacts }) => {
    if (!isApolloConfigured()) {
      return { content: [{ type: 'text' as const, text: 'Apollo API key not configured.' }] };
    }

    // 1. Search Apollo
    const result = await searchPeople({
      organizationDomains: [domain],
      personTitles: titles,
      personSeniorities: seniorities,
      perPage: max_contacts || 10,
    });

    if (result.people.length === 0) {
      return { content: [{ type: 'text' as const, text: `No contacts found at ${domain} matching criteria.` }] };
    }

    // 2. Memorize each to Personize
    const memorized: string[] = [];
    const skipped: string[] = [];

    for (const person of result.people) {
      if (!person.email || person.email_status === 'invalid') {
        skipped.push(`${person.first_name} ${person.last_name} (no valid email)`);
        continue;
      }

      await memory.save({
        email: person.email,
        collectionName: 'contacts',
        content: `[DISCOVERED] ${person.first_name} ${person.last_name}, ${person.title} at ${domain}. Source: Apollo.`,
        properties: {
          first_name: { value: person.first_name, extractMemories: false },
          last_name: { value: person.last_name, extractMemories: false },
          email: { value: person.email, extractMemories: false },
          job_title: { value: person.title, extractMemories: false },
          company_name: { value: person.organization?.name || domain, extractMemories: false },
          company_website: { value: domain, extractMemories: false },
          linkedin_url: { value: person.linkedin_url || '', extractMemories: false },
          seniority_level: { value: person.seniority || '', extractMemories: false },
          department: { value: person.departments?.[0] || '', extractMemories: false },
          source: { value: 'Apollo', extractMemories: false },
          lead_status: { value: 'New', extractMemories: false },
        },
        tags: ['discovered', 'apollo', domain],
      });

      // 3. Enroll in campaign if specified — check ICP fit first
      if (campaign_id) {
        const campConfig = await campaigns.getConfig(campaign_id);
        if (campConfig?.icpCriteria) {
          const icpScore = campaigns.matchICP(
            { job_title: person.title, seniority_level: person.seniority, department: person.departments?.[0] || '' },
            campConfig.icpCriteria,
          );
          if (icpScore < 40) {
            memorized.push(`${person.first_name} ${person.last_name} (${person.title}) → memorized, not enrolled: ICP score ${icpScore} (below 40 threshold)`);
            continue;
          }
        }
        const enrollment = await campaigns.enroll(person.email, campaign_id);
        if (enrollment.enrolled) {
          memorized.push(`${person.first_name} ${person.last_name} (${person.title}) → enrolled in ${campaign_id}, sender: ${enrollment.senderId || 'none'}`);
        } else {
          memorized.push(`${person.first_name} ${person.last_name} (${person.title}) → memorized, not enrolled: ${enrollment.reason}`);
        }
      } else {
        memorized.push(`${person.first_name} ${person.last_name} (${person.title}) → memorized`);
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Found ${result.pagination.total_entries} contacts at ${domain}, processed ${result.people.length}:`,
          '',
          ...memorized.map(m => `  ✓ ${m}`),
          ...skipped.map(s => `  ✗ ${s}`),
          '',
          `Memorized: ${memorized.length} | Skipped: ${skipped.length}`,
        ].join('\n'),
      }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// WEB RESEARCH
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'research_company',
  `Research a company via Tavily web search. Returns AI summary + recent news, funding, hiring signals, and personalization angles.`,
  {
    company: z.string().describe('Company name or domain to research'),
    query: z.string().optional().describe('Specific research query (default: "[company] news funding hiring")'),
  },
  async ({ company, query }) => {
    if (!isTavilyConfigured()) {
      return { content: [{ type: 'text' as const, text: 'Tavily API key not configured. Set TAVILY_API_KEY in .env.' }] };
    }

    const searchQuery = query || `${company} news funding hiring product launch recent`;
    const result = await searchTavily(searchQuery);

    if (!result) {
      return { content: [{ type: 'text' as const, text: `Research failed for "${company}"` }] };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query: result.query,
          ai_summary: result.answer,
          top_results: result.results.slice(0, 5).map(r => ({
            title: r.title,
            url: r.url,
            content: r.content.substring(0, 300),
            published: r.published_date,
          })),
        }, null, 2),
      }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// CAMPAIGN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'campaign_list',
  `List all campaigns with their status and stats.`,
  {},
  async () => {
    const allCampaigns = await memoryCrud.filterByProperty({
      type: 'Campaign',
      conditions: [{ propertyName: 'campaign_id', operator: 'exists' }],
      limit: 50,
    });

    if (allCampaigns.records.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No campaigns found.' }] };
    }

    const list = allCampaigns.records.map(r => {
      const p = r.matchedProperties || {};
      const reached = Number(p.contacts_reached) || 0;
      const replies = Number(p.replies) || 0;
      return {
        id: p.campaign_id,
        name: p.name,
        status: p.status,
        market: p.market,
        enrolled: Number(p.contacts_enrolled) || 0,
        reached,
        emails_sent: Number(p.emails_sent) || 0,
        replies,
        positive_replies: Number(p.positive_replies) || 0,
        reply_rate: reached > 0 ? `${Math.round((replies / reached) * 100)}%` : '0%',
        meetings: Number(p.meetings_booked) || 0,
      };
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  },
);

server.tool(
  'campaign_stats',
  `Get detailed stats for a specific campaign.`,
  {
    campaign_id: z.string().describe('Campaign ID'),
  },
  async ({ campaign_id }) => {
    const config = await campaigns.getConfig(campaign_id);
    if (!config) {
      return { content: [{ type: 'text' as const, text: `Campaign "${campaign_id}" not found.` }] };
    }

    const stats = await campaigns.getStats(campaign_id);
    const reached = stats.contacts_reached;
    const replyRate = reached > 0 ? Math.round((stats.replies / reached) * 100) : 0;
    const positiveRate = reached > 0 ? Math.round((stats.positive_replies / reached) * 100) : 0;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          campaign: {
            id: config.campaignId,
            name: config.name,
            status: config.status,
            market: config.market,
            cadence: config.cadence,
            daily_cap: config.dailySendCap,
            senders: config.senderProfileIds,
          },
          stats: {
            ...stats,
            reply_rate: `${replyRate}%`,
            positive_rate: `${positiveRate}%`,
          },
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'campaign_create',
  `Create a new outreach campaign.`,
  {
    name: z.string().describe('Campaign name'),
    market: z.string().optional().describe('Target market description'),
    cadence: z.enum(['aggressive', 'standard', 'enterprise']).optional().describe('Cadence preset'),
    daily_cap: z.number().optional().describe('Max emails per day (0 = unlimited)'),
    sender_ids: z.array(z.string()).optional().describe('Sender profile IDs to allocate'),
    max_emails: z.number().optional().describe('Max emails in sequence'),
    icp_criteria: z.string().optional().describe('JSON ICP criteria for auto-enrollment'),
    governance_overrides: z.array(z.string()).optional().describe('Guideline IDs for campaign-specific governance'),
  },
  async ({ name, market, cadence, daily_cap, sender_ids, max_emails, icp_criteria, governance_overrides }) => {
    const campaignId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    await memory.save({
      email: campaignId,
      collectionName: 'campaigns',
      content: `Campaign "${name}" created`,
      properties: {
        campaign_id: { value: campaignId, extractMemories: false },
        name: { value: name, extractMemories: false },
        status: { value: 'Draft', extractMemories: false },
        market: { value: market || '', extractMemories: false },
        agent_mode: { value: 'outbound-sdr', extractMemories: false },
        icp_criteria: { value: icp_criteria || '', extractMemories: false },
        sender_profile_ids: { value: sender_ids || [], extractMemories: false },
        daily_send_cap: { value: daily_cap || 0, extractMemories: false },
        cadence: { value: cadence || 'standard', extractMemories: false },
        max_emails: { value: max_emails || 3, extractMemories: false },
        governance_overrides: { value: governance_overrides || [], extractMemories: false },
        contacts_enrolled: { value: 0, extractMemories: false },
        contacts_reached: { value: 0, extractMemories: false },
        emails_sent: { value: 0, extractMemories: false },
        replies: { value: 0, extractMemories: false },
        positive_replies: { value: 0, extractMemories: false },
        meetings_booked: { value: 0, extractMemories: false },
        bounced: { value: 0, extractMemories: false },
        opted_out: { value: 0, extractMemories: false },
        emails_sent_today: { value: 0, extractMemories: false },
        created_at: { value: new Date().toISOString(), extractMemories: false },
      },
      tags: ['campaign', campaignId],
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Campaign "${name}" created (ID: ${campaignId}). Status: Draft.\nTo activate: use campaign_activate tool.\nTo enroll contacts: use campaign_enroll tool.`,
      }],
    };
  },
);

server.tool(
  'campaign_activate',
  `Set a campaign to Active so the outreach engine starts processing it.`,
  {
    campaign_id: z.string().describe('Campaign ID to activate'),
  },
  async ({ campaign_id }) => {
    await memoryCrud.update({ recordId: campaign_id, type: 'Campaign', propertyName: 'status', propertyValue: 'Active', updatedBy: 'mcp' });
    await memoryCrud.update({ recordId: campaign_id, type: 'Campaign', propertyName: 'started_at', propertyValue: new Date().toISOString(), updatedBy: 'mcp' });

    const dryRun = process.env.DRY_RUN !== 'false';
    return {
      content: [{
        type: 'text' as const,
        text: `Campaign "${campaign_id}" is now Active.${dryRun ? '\n⚠️ DRY_RUN is enabled — emails will be generated but NOT sent. Set DRY_RUN=false in .env to go live.' : ''}`,
      }],
    };
  },
);

server.tool(
  'campaign_pause',
  `Pause a campaign. Stops new outreach. In-flight sequences complete their current email.`,
  {
    campaign_id: z.string().describe('Campaign ID to pause'),
  },
  async ({ campaign_id }) => {
    await memoryCrud.update({ recordId: campaign_id, type: 'Campaign', propertyName: 'status', propertyValue: 'Paused', updatedBy: 'mcp' });
    return { content: [{ type: 'text' as const, text: `Campaign "${campaign_id}" paused.` }] };
  },
);

server.tool(
  'campaign_enroll',
  `Enroll one or more contacts in a campaign. Assigns sender, sets campaign_id, prevents duplicates.`,
  {
    campaign_id: z.string().describe('Campaign ID'),
    emails: z.array(z.string()).describe('Email addresses to enroll'),
  },
  async ({ campaign_id, emails }) => {
    const results: string[] = [];

    for (const email of emails) {
      const result = await campaigns.enroll(email, campaign_id);
      if (result.enrolled) {
        results.push(`✓ ${email} → sender: ${result.senderId || 'none'}`);
      } else {
        results.push(`✗ ${email} — ${result.reason}`);
      }
    }

    return { content: [{ type: 'text' as const, text: results.join('\n') }] };
  },
);

// ═══════════════════════════════════════════════════════════════════
// SENDER & STATUS
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'sender_list',
  `List all sender profiles with health, capacity, and warmup status.`,
  {},
  async () => {
    const profiles = await senderProfiles.list();

    if (profiles.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No sender profiles configured.' }] };
    }

    const list = profiles.map(p => ({
      id: p.id,
      name: p.name,
      persona: p.persona,
      active: p.active,
      health: p.healthScore,
      daily_limit: senderProfiles.getEffectiveDailyLimit(p),
      sent_today: p.sentToday,
      remaining: senderProfiles.getRemainingCapacity(p),
      warming_up: p.isWarmingUp,
      warmup_day: p.isWarmingUp ? p.warmupDay : undefined,
      lifetime: { sent: p.totalSent, bounced: p.totalBounces, replies: p.totalReplies },
      pause_reason: p.pauseReason || undefined,
    }));

    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  },
);

server.tool(
  'daily_status',
  `Get today's metrics: emails sent, replies, pipeline activity, sender health, needs attention.`,
  {},
  async () => {
    const metrics = await collectDailyMetrics();

    // Also get campaign summary
    const activeCampaigns = await campaigns.listActive();
    const campaignSummary = [];
    for (const c of activeCampaigns) {
      const stats = await campaigns.getStats(c.campaignId);
      campaignSummary.push({
        name: c.name,
        id: c.campaignId,
        enrolled: stats.contacts_enrolled,
        reached: stats.contacts_reached,
        replies: stats.replies,
        positive: stats.positive_replies,
      });
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          outreach: metrics.outreach,
          replies: metrics.replies,
          pipeline: metrics.pipeline,
          capacity: metrics.capacity,
          needs_attention: metrics.needsAttention,
          active_campaigns: campaignSummary,
          dry_run: process.env.DRY_RUN !== 'false',
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'daily_brief',
  `Read the latest daily brief (same as what's posted to Slack). Useful at the start of a conversation.`,
  {},
  async () => {
    const result = await memory.retrieve({
      message: 'DAILY BRIEF prospecting agent report',
      limit: 1,
      mode: 'fast',
    });

    const brief = (result as any)?.[0]?.content || (result as any)?.results?.[0]?.content;
    if (!brief) {
      return { content: [{ type: 'text' as const, text: 'No daily brief found. The daily digest may not have run yet.' }] };
    }

    return { content: [{ type: 'text' as const, text: brief }] };
  },
);

// ═══════════════════════════════════════════════════════════════════
// ECOMMERCE
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'ecommerce_sync',
  `Import ecommerce data (products catalog + purchase history) from CSV files in data/.
Memorizes products to the Products collection and purchases to customer Contact records.
Also computes aggregate stats (total orders, total spent, categories) per customer.
Place your CSVs at data/products.csv and data/purchases.csv before running.`,
  {},
  async () => {
    const { syncEcommerce } = await import('./pipelines/sync-ecommerce.js');
    const result = await syncEcommerce();

    return {
      content: [{
        type: 'text' as const,
        text: [
          'Ecommerce sync complete:',
          `  Products imported: ${result.products}`,
          `  Purchases memorized: ${result.purchases}`,
          `  Customers updated: ${result.customersUpdated}`,
          '',
          'Next step: run ecommerce_infer_preferences to analyze customer preferences.',
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'ecommerce_infer_preferences',
  `Analyze a customer's purchase history and infer style preferences, price tier, segment, and product recommendations.
Writes inferred properties (style_preferences, price_tier, customer_segment) back to the contact.
Run this after ecommerce_sync to enrich customer profiles before campaigns.`,
  {
    emails: z.array(z.string()).describe('Customer email addresses to analyze'),
  },
  async ({ emails }) => {
    const { inferPreferencesBatch } = await import('./pipelines/infer-preferences.js');
    const result = await inferPreferencesBatch(emails);

    return {
      content: [{
        type: 'text' as const,
        text: [
          'Preference inference complete:',
          `  Processed: ${result.processed}`,
          `  Inferred: ${result.inferred}`,
          `  Skipped (no data): ${result.skipped}`,
          '',
          'Customer profiles now have: style_preferences, price_tier, customer_segment.',
          'These properties are automatically used by outreach generation for personalization.',
        ].join('\n'),
      }],
    };
  },
);

server.tool(
  'ecommerce_generate_variables',
  `Generate personalized email variables for an ecommerce customer.
Returns structured variables (headline, paragraphs, image prompt, CTA, product recommendations)
ready to inject into any ESP template (Klaviyo, Mailchimp, Braze).
Uses the customer's purchase history + inferred preferences for deep personalization.`,
  {
    email: z.string().describe('Customer email address'),
    campaign_type: z.enum(['winback', 'post-purchase', 'promotional', 'seasonal']).optional().describe('Campaign type (default: winback)'),
    campaign_id: z.string().optional().describe('Campaign ID for campaign-specific governance'),
  },
  async ({ email, campaign_type, campaign_id }) => {
    const { generateEcommerceVariables } = await import('./pipelines/generate-outreach.js');
    const result = await generateEcommerceVariables(email, campaign_type || 'winback', campaign_id);

    if (!result) {
      return { content: [{ type: 'text' as const, text: `No purchase history found for ${email}. Run ecommerce_sync first.` }] };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// CONTACT SEARCH & SEGMENTATION
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'search_contacts',
  `Search contacts in Personize memory. Find contacts by properties, campaign, status, etc.`,
  {
    campaign_id: z.string().optional().describe('Filter by campaign'),
    lead_status: z.string().optional().describe('Filter by lead status (New, Qualified, Contacted, etc.)'),
    sequence_status: z.string().optional().describe('Filter by sequence status (Active, Replied, Complete, etc.)'),
    icp_match: z.boolean().optional().describe('Filter by ICP match'),
    query: z.string().optional().describe('Free-text search across contact memories'),
    limit: z.number().optional().describe('Max results (default 20)'),
  },
  async ({ campaign_id, lead_status, sequence_status, icp_match, query, limit }) => {
    const conditions: Array<{ propertyName: string; operator: string; value: any }> = [];

    if (campaign_id) conditions.push({ propertyName: 'campaign_id', operator: 'equals', value: campaign_id });
    if (lead_status) conditions.push({ propertyName: 'lead_status', operator: 'equals', value: lead_status });
    if (sequence_status) conditions.push({ propertyName: 'sequence_status', operator: 'equals', value: sequence_status });
    if (icp_match !== undefined) conditions.push({ propertyName: 'icp_match', operator: 'equals', value: icp_match });

    if (conditions.length > 0) {
      const result = await memoryCrud.filterByProperty({
        type: 'Contact',
        conditions: conditions as any,
        limit: limit || 20,
      });

      const contacts = result.records.map(r => {
        const p = r.matchedProperties || {};
        return {
          email: p.email,
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          title: p.job_title,
          company: p.company_name,
          status: p.lead_status,
          sequence: p.sequence_status,
          campaign: p.campaign_id,
          score: p.lead_score,
          sentiment: p.sentiment,
        };
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ total: result.totalMatched, contacts }, null, 2),
        }],
      };
    }

    // Fallback to semantic search — normalize to same {total, contacts[]} shape
    const result = await client.memory.search({
      type: 'Contact',
      query: query || 'all contacts',
      limit: limit || 20,
    });

    const rawRecords = result.data?.records || result.data || [];
    const recordList = Array.isArray(rawRecords) ? rawRecords : Object.values(rawRecords);
    const contacts = recordList.map((r: any) => ({
      email: r.email || r.id || '',
      name: `${r.first_name || r.properties?.first_name?.value || ''} ${r.last_name || r.properties?.last_name?.value || ''}`.trim(),
      title: r.job_title || r.properties?.job_title?.value || '',
      company: r.company_name || r.properties?.company_name?.value || '',
      status: r.lead_status || r.properties?.lead_status?.value || '',
      sequence: r.sequence_status || r.properties?.sequence_status?.value || '',
      campaign: r.campaign_id || r.properties?.campaign_id?.value || '',
      score: r.lead_score || r.properties?.lead_score?.value || '',
      sentiment: r.sentiment || r.properties?.sentiment?.value || '',
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ total: contacts.length, contacts }, null, 2),
      }],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
