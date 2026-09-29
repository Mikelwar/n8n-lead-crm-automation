// n8n Code node: "Build Final CRM Record"  (mode: Run Once for All Items)
// Produces one flat, CRM-ready record per lead (sorted back into intake order).
// Also runs a safety check on follow-up drafts: any price, date, guarantee or unresolved
// template syntax flags the draft for editing before a human sends it.

const DRAFT_CHECKS = [
  ['contains a price or amount', /[$€£]\s?\d|\d\s?(usd|eur|gbp|dollars|euros)\b/i],
  ['contains a specific date', /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i],
  ['contains a guarantee or promise', /guarantee|we promise|100%|risk[- ]free/i],
  ['contains unresolved template syntax', /\{\{|\}\}|\$\{/],
];

const items = $input.all()
  .slice()
  .sort((x, y) => (x.json._meta?.batch_index ?? 0) - (y.json._meta?.batch_index ?? 0));

return items.map((item) => {
  const l = item.json;
  const a = l.analysis;
  const f = l.followup || null;
  const cfg = l.config || {};
  const demo = cfg.demo_mode !== false;

  const draftFlags = f && f.body ? DRAFT_CHECKS.filter(([, re]) => re.test(`${f.subject}\n${f.body}`)).map(([label]) => label) : [];

  const record = {
    lead_id: l.lead_id,
    timestamp: l.timestamp,
    full_name: l.full_name,
    email: l.email,
    phone: l.phone_normalized || l.phone,
    company: l.company,
    job_title: l.job_title,
    company_size: l.company_size,
    industry: l.industry,
    country: l.country,
    source: l.source,
    requested_service: l.requested_service,
    estimated_budget: l.estimated_budget,
    timeline: l.timeline,

    lead_score: l.lead_score,
    lead_temperature: l.lead_temperature,
    lead_category: l.lead_category,
    qualification_status: l.qualification_status,
    priority: l.routing.priority,
    sla: l.routing.sla,
    owner: l.owner,
    owner_team: l.owner_team,
    status: l.routing.crm_status,
    next_action: l.routing.next_action,

    requires_followup: l.requires_followup,
    followup_status: f ? (draftFlags.length ? 'DRAFT_NEEDS_EDIT' : f.status) : 'NONE',
    followup_subject: f ? f.subject : '',
    followup_body: f ? f.body : '',
    followup_auto_send: false,
    followup_generated_by: f ? f.generated_by : '',
    followup_safety_flags: draftFlags,

    recommended_action: l.recommended_action,
    ai_suggested_category: l.scoring.ai_suggested_category,
    ai_suggested_score: l.scoring.ai_suggested_score,
    analysis_summary: a.analysis_summary,
    score_breakdown: l.scoring.breakdown.join(' | '),
    confidence: a.confidence,
    buying_intent: a.buying_intent,
    budget_fit: a.budget_fit,
    urgency: a.urgency,
    authority_level: a.authority_level,
    business_fit: a.business_fit,
    missing_fields: a.missing_fields,
    duplicate_of: l.duplicate_check.duplicate_of,
    related_account: l.duplicate_check.related_account,
    spam: a.spam,
    security_flags: l.security.flags,
    override_reason: l.override_reason,

    analysis_source: l.analysis_meta.source,
    analysis_status: l.analysis_meta.status,
    model: demo ? `${l.analysis_meta.model} (demo, no AI call)` : l.analysis_meta.model,
    demo_mode: demo,
    entry_channel: l._meta.entry_channel,
    processed_at: new Date().toISOString(),
    workflow_version: cfg.workflow_version || '1.0.0',
    data_notice: demo ? 'Demo execution using mock AI responses. Fictional lead data.' : 'Production execution.',

    raw_input: l.raw_input,
  };

  return { json: record, pairedItem: item.pairedItem };
});
