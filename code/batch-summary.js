// n8n Code node: "Batch Summary"  (mode: Run Once for All Items)
// One summary item per execution: counts per route, drafts created, and how many
// AI calls were attempted (always 0 in demo mode). emails_sent is always 0: nothing sends email.

const records = $input.all().map((i) => i.json);
const demo = records.every((r) => r.demo_mode);
const count = (fn) => records.filter(fn).length;
const byCategory = {};
for (const c of ['HOT', 'WARM', 'COLD', 'REJECT', 'SPAM', 'DUPLICATE', 'NEEDS_REVIEW']) byCategory[c] = count((r) => r.lead_category === c);

return [{
  json: {
    run_type: demo ? 'DEMO: mock AI responses, fictional leads' : 'PRODUCTION',
    total_leads: records.length,
    by_category: byCategory,
    followup_drafts_created: count((r) => r.followup_status.startsWith('DRAFT')),
    drafts_flagged_for_edit: count((r) => r.followup_status === 'DRAFT_NEEDS_EDIT'),
    emails_sent: 0,
    ai_calls_attempted: count((r) => r.analysis_source === 'ai') + count((r) => String(r.followup_generated_by).startsWith('ai:')),
    needs_human_review: count((r) => r.lead_category === 'NEEDS_REVIEW'),
    leads: records.map((r) => `${r.lead_id} · ${r.lead_category} · ${r.lead_score} · ${r.owner}`),
    notice: demo
      ? 'Demo execution using mock AI responses. Production path is ready for external AI and CRM integrations.'
      : 'Production execution. Follow-ups are drafts only and require human review before sending.',
  },
}];
