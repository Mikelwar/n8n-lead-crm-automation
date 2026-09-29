// n8n Code node: "Parse & Validate Analysis"  (mode: Run Once for All Items)
// Accepts either the DEMO mock analysis or a raw AI provider response (Anthropic Messages API
// or OpenAI-compatible chat completions) and returns ONE validated analysis shape.
// Fail-safe rules:
//   - unparseable / invalid / refused / missing AI output -> analysis_status = "failed" -> NEEDS_REVIEW
//   - the AI may ADD risk flags (spam, injection) but can never REMOVE deterministic ones
//     (duplicate, spam signals, prompt-injection patterns, missing fields).

const ENUMS = {
  lead_category: ['HOT', 'WARM', 'COLD', 'REJECT', 'SPAM', 'DUPLICATE', 'NEEDS_REVIEW'],
  lead_temperature: ['HOT', 'WARM', 'COLD', 'REJECT'],
  qualification_status: ['QUALIFIED', 'NURTURE', 'REJECTED', 'DUPLICATE', 'NEEDS_REVIEW', 'INCOMPLETE'],
  buying_intent: ['high', 'medium', 'low', 'unclear'],
  budget_fit: ['strong', 'moderate', 'weak', 'very_low', 'unknown'],
  urgency: ['high', 'medium', 'low', 'unknown'],
  authority_level: ['decision_maker', 'influencer', 'individual', 'unknown'],
  business_need: ['strong', 'moderate', 'weak'],
  service_fit: ['strong', 'partial', 'none'],
  company_fit: ['strong', 'moderate', 'weak'],
  business_fit: ['strong', 'moderate', 'weak'],
};
const AI_BUILD_NODE = 'AI · Build Analysis Request';

function extractProviderText(resp) {
  if (!resp || typeof resp !== 'object') return { error: 'empty_response' };
  if (resp.error) {
    const msg = typeof resp.error === 'string' ? resp.error : resp.error.message || JSON.stringify(resp.error);
    return { error: `provider_error: ${String(msg).slice(0, 200)}` };
  }
  if (Array.isArray(resp.content)) { // Anthropic Messages API
    if (resp.stop_reason === 'refusal') return { error: 'model_refusal' };
    if (resp.stop_reason === 'max_tokens') return { error: 'truncated_at_max_tokens' };
    return { text: resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('') };
  }
  if (Array.isArray(resp.choices)) { // OpenAI-compatible
    const c = resp.choices[0] || {};
    if (c.finish_reason === 'length') return { error: 'truncated_at_max_tokens' };
    return { text: (c.message && c.message.content) || '' };
  }
  return { error: 'no_ai_response (AI node disabled or returned an unknown shape)' };
}

function parseJson(text) {
  if (!text) throw new Error('empty_text');
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no_json_object');
  return JSON.parse(stripped.slice(start, end + 1));
}

function validate(a) {
  const errors = [];
  const v = {};
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const val = typeof a[k] === 'string' ? a[k].trim() : a[k];
    const match = allowed.find((x) => x.toLowerCase() === String(val).toLowerCase());
    if (!match) errors.push(`${k}=${JSON.stringify(a[k])}`);
    v[k] = match || null;
  }
  const conf = Number(a.confidence);
  v.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;
  const score = Number(a.lead_score);
  v.lead_score = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  if (v.lead_score === null) errors.push('lead_score');
  v.duplicate = a.duplicate === true;
  v.spam = a.spam === true;
  v.prompt_injection_detected = a.prompt_injection_detected === true;
  v.requires_followup = a.requires_followup === true;
  v.missing_fields = Array.isArray(a.missing_fields) ? a.missing_fields.map(String).slice(0, 20) : [];
  v.pain_points = Array.isArray(a.pain_points) ? a.pain_points.map((p) => String(p).slice(0, 200)).slice(0, 5) : [];
  v.recommended_action = String(a.recommended_action || '').slice(0, 500);
  v.analysis_summary = String(a.analysis_summary || '').slice(0, 1500);
  if (!v.analysis_summary) errors.push('analysis_summary');
  return { analysis: v, errors };
}

function failedAnalysis(lead, reason) {
  return {
    lead_category: 'NEEDS_REVIEW', confidence: 0, lead_score: 0, lead_temperature: 'REJECT',
    qualification_status: 'NEEDS_REVIEW', buying_intent: 'unclear', budget_fit: 'unknown', urgency: 'unknown',
    authority_level: 'unknown', business_need: 'weak', service_fit: 'none', company_fit: 'weak', business_fit: 'weak',
    duplicate: false, spam: false, prompt_injection_detected: false, requires_followup: false,
    missing_fields: [], pain_points: [],
    recommended_action: 'Manual review: automated analysis was not available for this lead.',
    analysis_summary: `Automated analysis failed (${reason}). Raw lead data preserved for manual review.`,
  };
}

return $input.all().map((item, i) => {
  const j = item.json;
  let lead;
  let raw;
  let source;
  let model;
  let error = null;

  if (j.analysis_meta && j.analysis_meta.source === 'mock') {
    ({ analysis: raw, ...lead } = j);
    source = 'mock';
    model = j.analysis_meta.model;
  } else {
    source = 'ai';
    // AI path: this item is the provider response (or the pass-through lead if the HTTP node is disabled).
    let built = null;
    try { built = $(AI_BUILD_NODE).itemMatching(i).json; } catch (e) { built = null; }
    lead = built || (j.lead_id ? j : { lead_id: `UNKNOWN-${i + 1}` });
    model = (lead.config && lead.config.ai_model) || 'unknown';
    const extracted = j.lead_id ? { error: 'no_ai_response (AI node disabled or skipped)' } : extractProviderText(j);
    if (extracted.error) error = extracted.error;
    else {
      try { raw = parseJson(extracted.text); } catch (e) { error = `invalid_json: ${e.message}`; }
    }
  }
  const { ai_request, analysis_meta, ...cleanLead } = lead;

  let analysis;
  if (!error) {
    const res = validate(raw || {});
    if (res.errors.length) error = `schema_invalid: ${res.errors.join(', ')}`;
    else analysis = res.analysis;
  }
  if (error) analysis = failedAnalysis(cleanLead, error);

  // Deterministic facts always win: the AI can add flags, never remove them.
  if (cleanLead.duplicate_check && cleanLead.duplicate_check.is_duplicate) analysis.duplicate = true;
  if (cleanLead.spam_check && cleanLead.spam_check.likely_spam) analysis.spam = true;
  if (cleanLead.security && cleanLead.security.prompt_injection_suspected) analysis.prompt_injection_detected = true;
  if (cleanLead.validation) {
    analysis.missing_fields = [...new Set([...cleanLead.validation.missing_fields, ...analysis.missing_fields])];
  }

  return {
    json: {
      ...cleanLead,
      analysis,
      analysis_meta: {
        source,
        model,
        status: error ? 'failed' : 'ok',
        error,
        validated_at: new Date().toISOString(),
      },
    },
    pairedItem: { item: i },
  };
});
