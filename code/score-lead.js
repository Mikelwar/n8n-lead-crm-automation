// n8n Code node: "Score Lead"  (mode: Run Once for All Items)
// Hybrid scoring: the AI (or mock) rates each dimension; deterministic rules turn the ratings
// into points, apply penalties, clamp to 0-100, and apply business-rule overrides.
//
//   +20 budget fit · +20 authority · +20 business need · +15 urgency · +15 service fit · +10 company fit
//   -20 unclear intent · -30 very low budget · -50 spam · -100 malicious / prompt injection
//   80-100 HOT · 55-79 WARM · 30-54 COLD · 0-29 REJECT (low value)
//
// Override precedence (first match wins):
//   analysis failed -> NEEDS_REVIEW · security flag -> NEEDS_REVIEW · spam -> SPAM
//   duplicate -> DUPLICATE · incomplete -> NEEDS_REVIEW (INCOMPLETE) · otherwise the score band

const POINTS = {
  budget_fit: { strong: 20, moderate: 12, weak: 5, very_low: 0, unknown: 0 },
  authority_level: { decision_maker: 20, influencer: 12, individual: 5, unknown: 0 },
  business_need: { strong: 20, moderate: 12, weak: 4 },
  urgency: { high: 15, medium: 9, low: 3, unknown: 0 },
  service_fit: { strong: 15, partial: 8, none: 0 },
  company_fit: { strong: 10, moderate: 6, weak: 2 },
};
const PENALTIES = { unclear_intent: -20, very_low_budget: -30, spam: -50, malicious_input: -100 };

// Used when the rules disagree with the AI's suggested category (the rules win).
const RULE_ACTIONS = {
  HOT: 'Contact within 30 minutes and offer a discovery call.',
  WARM: 'Send a personal follow-up today with 2-3 scoping questions.',
  COLD: 'Add to the nurture sequence and re-score on engagement.',
  REJECT: 'Archive; low fit and low intent.',
  SPAM: 'Archive as spam. Do not reply.',
  DUPLICATE: 'Merge into the existing record and notify its owner.',
  NEEDS_REVIEW: 'Manual review required before any follow-up.',
};

return $input.all().map((item, i) => {
  const lead = item.json;
  const a = lead.analysis;
  const cfg = lead.config || {};
  const HOT = cfg.score_hot_min ?? 80;
  const WARM = cfg.score_warm_min ?? 55;
  const COLD = cfg.score_cold_min ?? 30;

  const breakdown = [];
  const components = {};
  let score = 0;
  for (const [dim, table] of Object.entries(POINTS)) {
    const pts = table[a[dim]] ?? 0;
    components[dim] = pts;
    score += pts;
    breakdown.push(`+${pts} ${dim.replace(/_/g, ' ')} (${a[dim]})`);
  }
  const penalties = [];
  if (a.buying_intent === 'unclear') penalties.push(['unclear intent', PENALTIES.unclear_intent]);
  if (a.budget_fit === 'very_low') penalties.push(['very low budget', PENALTIES.very_low_budget]);
  if (a.spam) penalties.push(['spam', PENALTIES.spam]);
  if (a.prompt_injection_detected || (lead.security && lead.security.markup_detected)) penalties.push(['malicious / injection attempt', PENALTIES.malicious_input]);
  for (const [label, pts] of penalties) {
    score += pts;
    breakdown.push(`${pts} ${label}`);
  }
  const rawScore = score;
  score = Math.max(0, Math.min(100, score));

  const lead_temperature = a.spam ? 'REJECT' : score >= HOT ? 'HOT' : score >= WARM ? 'WARM' : score >= COLD ? 'COLD' : 'REJECT';

  let lead_category = lead_temperature;
  let qualification_status = { HOT: 'QUALIFIED', WARM: 'QUALIFIED', COLD: 'NURTURE', REJECT: 'REJECTED' }[lead_temperature];
  let override_reason = null;
  const isComplete = lead.validation ? lead.validation.is_complete : true;

  if (lead.analysis_meta.status === 'failed') {
    lead_category = 'NEEDS_REVIEW'; qualification_status = 'NEEDS_REVIEW';
    override_reason = `analysis failed: ${lead.analysis_meta.error}`;
  } else if (a.prompt_injection_detected || (lead.security && lead.security.risk_level === 'high')) {
    lead_category = 'NEEDS_REVIEW'; qualification_status = 'NEEDS_REVIEW';
    override_reason = `security: ${(lead.security && lead.security.flags.join(', ')) || 'prompt injection detected by AI'}`;
  } else if (a.spam) {
    lead_category = 'SPAM'; qualification_status = 'REJECTED';
    override_reason = 'spam signals';
  } else if (a.duplicate) {
    lead_category = 'DUPLICATE'; qualification_status = 'DUPLICATE';
    override_reason = `duplicate of ${lead.duplicate_check.duplicate_of} (${lead.duplicate_check.match_type})`;
  } else if (!isComplete) {
    lead_category = 'NEEDS_REVIEW'; qualification_status = 'INCOMPLETE';
    override_reason = `incomplete: missing ${lead.validation.missing_required.join(', ')}`;
  }
  if (override_reason) breakdown.push(`override → ${lead_category} (${override_reason})`);

  const aiAgrees = a.lead_category === lead_category;
  const recommended_action = aiAgrees && a.recommended_action
    ? a.recommended_action
    : `${RULE_ACTIONS[lead_category]}${override_reason && lead_category === 'NEEDS_REVIEW' ? ` Reason: ${override_reason}.` : ''}`;

  return {
    json: {
      ...lead,
      lead_score: score,
      lead_temperature,
      lead_category,
      qualification_status,
      requires_followup: ['HOT', 'WARM', 'COLD'].includes(lead_category) && lead.email_valid === true,
      override_reason,
      recommended_action,
      scoring: {
        rule_score_before_clamp: rawScore,
        components,
        penalties: Object.fromEntries(penalties),
        breakdown,
        thresholds: { hot: HOT, warm: WARM, cold: COLD },
        ai_suggested_score: a.lead_score,
        ai_suggested_category: a.lead_category,
        ai_agrees_with_rules: aiAgrees,
      },
    },
    pairedItem: { item: i },
  };
});
