// n8n Code node: "DEMO · Mock Lead Analysis"  (mode: Run Once for All Items)
// DEMO MODE ONLY. Produces an AI-style structured analysis with deterministic heuristics.
// No external API is called. The output has exactly the same shape the production AI path
// must return (see prompts/lead-analysis.md), so everything downstream is identical.

const MODEL = 'mock-analyzer-v1';

const NEED_TERMS = [
  ['manual process', /manual|by hand|copy(ing|ied)?\b.{0,20}\b(paste|manually)|copied manually/i],
  ['spreadsheet tracking', /spreadsheet|excel|google sheets?/i],
  ['CRM', /\bcrm\b|salesforce|hubspot|pipedrive|zoho/i],
  ['qualification', /qualif/i],
  ['routing', /\brout(e|es|ing)\b|assign(ment)?/i],
  ['response time', /response time|respond faster|slow to respond|more than a day/i],
  ['consolidation', /consolidat|multiple (teams|tools|systems)|regional/i],
  ['integration', /integrat/i],
  ['automation', /automat/i],
  ['AI assistant', /chatbot|\bai assistant\b|assistant|support bot/i],
  ['scale', /\bscal(e|ing)\b|growing|volume/i],
];
const COMMITMENT = /\bwe need\b|\bmust\b|approved|priority|go live|deadline|\basap\b|this week/i;
const EXPLORATORY = /exploring|just looking|looking around|researching|not sure|\bmaybe\b|\bmight\b|down the line|at some point|curious/i;
const EXPLICIT_ASK = /\b(call|meeting|schedule|demo|proposal|quote|scope)\b/i;

const PAIN_POINTS = [
  [/manual|copied manually|by hand/i, 'inbound leads are currently handled manually'],
  [/spreadsheet|excel/i, 'leads are tracked in spreadsheets before reaching the CRM'],
  [/response time|more than a day|slow/i, 'response times to new inquiries are too slow'],
  [/consolidat|regional|multiple (teams|tools)/i, 'lead intake is spread across several teams or tools'],
  [/los(e|ing) leads|fall through|slip/i, 'leads are slipping through the cracks'],
  [/scal(e|ing)|growing/i, 'the current process does not scale with growth'],
  [/customer portal|support/i, 'customer questions need faster answers'],
];

const DECISION_MAKER = /\b(ceo|cto|coo|cfo|cmo|cro|cio|founder|co-?founder|owner|president|vp|vice president|head of|director|partner|managing director)\b/i;
const INFLUENCER = /\b(manager|lead|senior|principal|architect)\b/i;
const INDIVIDUAL = /\b(coordinator|assistant|associate|intern|analyst|specialist|representative)\b/i;

const SERVICE_CORE = /lead (qualification|routing|scoring|management)|\bcrm\b|hubspot|salesforce|pipedrive|qualif|routing/i;
const SERVICE_SECONDARY = /automat|workflow|integrat|chatbot|assistant|\bn8n\b|\bai\b/i;

const RUBRIC = {
  budget_fit: { strong: 20, moderate: 12, weak: 5, very_low: 0, unknown: 0 },
  authority_level: { decision_maker: 20, influencer: 12, individual: 5, unknown: 0 },
  business_need: { strong: 20, moderate: 12, weak: 4 },
  urgency: { high: 15, medium: 9, low: 3, unknown: 0 },
  service_fit: { strong: 15, partial: 8, none: 0 },
  company_fit: { strong: 10, moderate: 6, weak: 2 },
};

const round2 = (n) => Math.round(n * 100) / 100;

return $input.all().map((item, i) => {
  const lead = item.json;
  const cfg = lead.config || {};
  const text = `${lead.message} ${lead.requested_service}`;

  // --- business need & intent ---
  const needMatches = NEED_TERMS.filter(([, re]) => re.test(text)).map(([label]) => label);
  const committed = COMMITMENT.test(lead.message);
  const exploratory = EXPLORATORY.test(lead.message);
  const asks = EXPLICIT_ASK.test(lead.message);
  let business_need = 'weak';
  if (needMatches.length >= 4 && committed) business_need = 'strong';
  else if (needMatches.length >= 2) business_need = 'moderate';

  let buying_intent = 'low';
  if (lead.message.length < 25 || (needMatches.length === 0 && !lead.requested_service)) buying_intent = 'unclear';
  else if (business_need !== 'weak' && committed && asks) buying_intent = 'high';
  else if (business_need !== 'weak') buying_intent = 'medium';
  if (lead.spam_check.likely_spam) buying_intent = 'unclear';

  // --- authority ---
  const title = lead.job_title || '';
  const authority_level = !title ? 'unknown' : DECISION_MAKER.test(title) ? 'decision_maker' : INFLUENCER.test(title) ? 'influencer' : INDIVIDUAL.test(title) ? 'individual' : 'unknown';

  // --- budget ---
  const b = lead.budget_estimate;
  const budget_fit = b === null || b === undefined ? 'unknown' : b >= 20000 ? 'strong' : b >= 5000 ? 'moderate' : b >= 1000 ? 'weak' : b > 0 ? 'very_low' : 'unknown';

  // --- urgency ---
  const d = lead.timeline_days;
  let urgency = d === null || d === undefined ? 'unknown' : d <= 30 ? 'high' : d <= 90 ? 'medium' : 'low';
  if (urgency === 'unknown' && /\basap\b|urgent|this week/i.test(lead.message)) urgency = 'high';

  // --- fit ---
  const service_fit = SERVICE_CORE.test(text) ? 'strong' : SERVICE_SECONDARY.test(text) ? 'partial' : 'none';
  const targetIndustries = (cfg.target_industries || []).map((s) => s.toLowerCase());
  const inTarget = Boolean(lead.industry) && targetIndustries.some((t) => lead.industry.toLowerCase().includes(t));
  const ideal = cfg.ideal_company_size || { min: 50, max: 1000 };
  const sizeFit = lead.company_size_min !== null && lead.company_size_min >= ideal.min && (lead.company_size_max ?? lead.company_size_min) <= ideal.max;
  const company_fit = inTarget && sizeFit ? 'strong' : inTarget || sizeFit ? 'moderate' : 'weak';
  const business_fit = service_fit === 'strong' && company_fit !== 'weak' ? 'strong' : service_fit !== 'none' ? 'moderate' : 'weak';

  // --- flags ---
  const spam = lead.spam_check.likely_spam;
  const duplicate = lead.duplicate_check.is_duplicate;
  const prompt_injection_detected = lead.security.prompt_injection_suspected;
  const missing_fields = lead.validation.missing_fields;

  // --- "AI" suggestion (the rules in Score Lead make the final call) ---
  const rubric = RUBRIC.budget_fit[budget_fit] + RUBRIC.authority_level[authority_level] + RUBRIC.business_need[business_need]
    + RUBRIC.urgency[urgency] + RUBRIC.service_fit[service_fit] + RUBRIC.company_fit[company_fit];
  let suggested = Math.round(rubric * 0.95) + (asks && committed ? 3 : 0) - (exploratory ? 5 : 0);
  if (spam) suggested = Math.min(suggested, 5);
  if (prompt_injection_detected) suggested = Math.min(suggested, 20);
  suggested = Math.max(0, Math.min(100, suggested));
  const temp = suggested >= 80 ? 'HOT' : suggested >= 55 ? 'WARM' : suggested >= 30 ? 'COLD' : 'REJECT';

  let lead_category = temp;
  if (spam) lead_category = 'SPAM';
  else if (prompt_injection_detected || !lead.validation.is_complete) lead_category = 'NEEDS_REVIEW';
  else if (duplicate) lead_category = 'DUPLICATE';

  const qualification_status = {
    HOT: 'QUALIFIED', WARM: 'QUALIFIED', COLD: 'NURTURE', REJECT: 'REJECTED', SPAM: 'REJECTED', DUPLICATE: 'DUPLICATE',
    NEEDS_REVIEW: lead.validation.is_complete ? 'NEEDS_REVIEW' : 'INCOMPLETE',
  }[lead_category];

  const recommended_action = {
    HOT: 'Contact within 30 minutes and offer a discovery call.',
    WARM: 'Send a personal follow-up today with 2-3 scoping questions.',
    COLD: 'Add to the nurture sequence and re-score on engagement.',
    REJECT: 'Archive; low fit and low intent.',
    SPAM: 'Archive as spam. Do not reply.',
    DUPLICATE: `Merge into existing record ${lead.duplicate_check.duplicate_of} and notify its owner.`,
    NEEDS_REVIEW: prompt_injection_detected
      ? 'Manual review: the message contains instructions aimed at the AI system.'
      : `Manual review: missing ${lead.validation.missing_required.join(', ') || 'key information'}.`,
  }[lead_category];

  // --- pain points (plain-language, used in follow-up drafts) ---
  const pain_points = PAIN_POINTS.filter(([re]) => re.test(lead.message)).map(([, p]) => p).slice(0, 3);

  // --- summary (built only from facts in the lead) ---
  const who = `${title || 'Contact'} at ${lead.company || 'an unknown company'}`
    + (lead.company_size || lead.industry ? ` (${[lead.company_size && `${lead.company_size} employees`, lead.industry].filter(Boolean).join(', ')})` : '');
  const parts = [`${who}.`];
  if (spam) parts.push(`Message shows typical spam patterns (${lead.spam_check.signals.join(', ')}).`);
  else {
    if (business_need === 'strong') parts.push(`Clear, specific need: ${pain_points.join('; ') || needMatches.join(', ')}.`);
    else if (business_need === 'moderate') parts.push(`Genuine use case (${pain_points[0] || needMatches.slice(0, 3).join(', ')})${exploratory ? ', still exploring options' : ''}.`);
    else parts.push('Need is vague or not yet defined.');
    parts.push(lead.estimated_budget ? `Budget: ${lead.estimated_budget} (${budget_fit.replace('_', ' ')}).` : 'No budget given.');
    if (lead.timeline) parts.push(`Timeline: ${lead.timeline}.`);
  }
  if (prompt_injection_detected) parts.push('Message contains instructions aimed at the AI system; treated as untrusted data and not followed.');
  if (duplicate) parts.push(`Matches existing lead ${lead.duplicate_check.duplicate_of} (${lead.duplicate_check.match_type.replace(/_/g, ' ')}).`);
  if (!lead.validation.is_complete) parts.push(`Missing: ${lead.validation.missing_required.join(', ')}.`);

  const presentFields = 13 - Math.min(missing_fields.length, 13);
  let confidence = 0.5 + presentFields * 0.035;
  if (spam && lead.spam_check.spam_score >= 5) confidence = 0.95;
  if (prompt_injection_detected) confidence = Math.min(confidence, 0.6);

  const analysis = {
    lead_category,
    confidence: round2(Math.min(confidence, 0.95)),
    lead_score: suggested,
    lead_temperature: spam ? 'REJECT' : temp,
    qualification_status,
    buying_intent,
    budget_fit,
    urgency,
    authority_level,
    business_need,
    service_fit,
    company_fit,
    business_fit,
    duplicate,
    spam,
    prompt_injection_detected,
    missing_fields,
    pain_points,
    requires_followup: ['HOT', 'WARM', 'COLD'].includes(lead_category),
    recommended_action,
    analysis_summary: parts.join(' '),
  };

  return {
    json: {
      ...lead,
      analysis,
      analysis_meta: { source: 'mock', model: MODEL, generated_at: new Date().toISOString() },
    },
    pairedItem: { item: i },
  };
});
