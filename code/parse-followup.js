// n8n Code node: "Parse Follow-up Draft"  (mode: Run Once for All Items)
// PRODUCTION PATH. Turns the AI provider response back into the same `followup` shape the
// demo mock produces. If generation fails, the lead continues WITHOUT a draft
// (status GENERATION_FAILED) so a human writes the reply. Nothing is ever sent.

const AI_BUILD_NODE = 'AI · Build Follow-up Request';

function extractProviderText(resp) {
  if (!resp || typeof resp !== 'object') return { error: 'empty_response' };
  if (resp.error) return { error: `provider_error: ${String(resp.error.message || resp.error).slice(0, 200)}` };
  if (Array.isArray(resp.content)) {
    if (resp.stop_reason === 'refusal') return { error: 'model_refusal' };
    if (resp.stop_reason === 'max_tokens') return { error: 'truncated_at_max_tokens' };
    return { text: resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('') };
  }
  if (Array.isArray(resp.choices)) return { text: (resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '' };
  return { error: 'no_ai_response (AI node disabled or returned an unknown shape)' };
}

return $input.all().map((item, i) => {
  const j = item.json;
  let lead;
  try { lead = $(AI_BUILD_NODE).itemMatching(i).json; } catch (e) { lead = j.lead_id ? j : {}; }
  const { ai_request, ...cleanLead } = lead;
  const model = (cleanLead.config && cleanLead.config.ai_model) || 'unknown';

  let error = null;
  let draft = null;
  const extracted = j.lead_id ? { error: 'no_ai_response (AI node disabled or skipped)' } : extractProviderText(j);
  if (extracted.error) error = extracted.error;
  else {
    try {
      const t = extracted.text.replace(/```(?:json)?/gi, '');
      draft = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
      if (typeof draft.subject !== 'string' || typeof draft.body !== 'string' || !draft.body.trim()) throw new Error('missing subject/body');
    } catch (e) {
      error = `invalid_draft: ${e.message}`;
    }
  }

  const followup = error
    ? { channel: 'email', to: cleanLead.email, subject: '', body: '', status: 'GENERATION_FAILED', auto_send: false, generated_by: `ai:${model}`, error, placeholders: [] }
    : {
      channel: 'email',
      to: cleanLead.email,
      subject: draft.subject.slice(0, 200),
      body: draft.body.slice(0, 3000),
      status: 'DRAFT_PENDING_REVIEW',
      auto_send: false,
      generated_by: `ai:${model}`,
      placeholders: [...new Set(draft.body.match(/\[[^\]]+\]/g) || [])],
    };

  return { json: { ...cleanLead, followup }, pairedItem: { item: i } };
});
