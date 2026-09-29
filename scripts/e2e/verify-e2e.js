// Verifies the JSON printed by `n8n execute --rawOutput` for one variant.
// Verifies a real `n8n execute --rawOutput` result.
const fs = require('fs');
const [file, variant, outDir] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
const start = text.indexOf('{\n');
if (start === -1) { console.log(`FAIL ${variant}: no JSON output. Head:\n${text.slice(0, 1500)}`); process.exit(1); }
const run = JSON.parse(text.slice(start));
const rd = run.data.resultData.runData;
let fails = 0;
const check = (ok, label, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${variant}] ${label}${detail ? `  (${detail})` : ''}`); if (!ok) fails++; };

check(!run.data.resultData.error, 'execution finished without workflow error', run.data.resultData.error && run.data.resultData.error.message);
check(run.status === 'success' || run.finished === true, 'execution status success', `status=${run.status}`);
const executed = Object.keys(rd);
const nodeErrors = executed.filter((n) => rd[n].some((r) => r.error)).map((n) => `${n}: ${rd[n].find((r) => r.error).error.message}`);
const out = (name, idx = 0) => (rd[name] ? rd[name].flatMap((r) => ((r.data && r.data.main && r.data.main[idx]) || [])).map((i) => i.json) : []);
const records = out('Build Final CRM Record');
const summary = out('Batch Summary')[0] || {};
console.log(`  info  executed nodes (${executed.length}): ${executed.join(' | ')}`);

const EXPECTED = { 'L-1001': 'HOT', 'L-1002': 'WARM', 'L-1003': 'COLD', 'L-1004': 'SPAM', 'L-1005': 'DUPLICATE', 'L-1006': 'NEEDS_REVIEW', 'L-1007': 'NEEDS_REVIEW' };
const DRAFTS = ['L-1001', 'L-1002', 'L-1003'];
check(records.length === 7, 'Build Final CRM Record produced 7 records', `${records.length}`);
check(rd['Build Final CRM Record'] && rd['Build Final CRM Record'].length === 1, 'final record node ran exactly once (merges joined all branches)', rd['Build Final CRM Record'] && `${rd['Build Final CRM Record'].length} runs`);

if (variant === 'demo') {
  check(nodeErrors.length === 0, 'no node errors', nodeErrors.join('; '));
  for (const r of records) check(r.lead_category === EXPECTED[r.lead_id], `${r.lead_id} → ${EXPECTED[r.lead_id]}`, `got ${r.lead_category}, score ${r.lead_score}, owner ${r.owner}`);
  check(records.every((r) => Boolean(r.followup_body) === DRAFTS.includes(r.lead_id)), 'drafts only for HOT / WARM / COLD');
  check(records.every((r) => r.followup_auto_send === false), 'auto_send = false on every record');
  const ai = ['AI · Build Analysis Request', 'AI · Analyze Lead', 'AI · Build Follow-up Request', 'AI · Draft Follow-up', 'Parse Follow-up Draft'];
  check(ai.every((n) => !executed.includes(n)), 'zero AI / HTTP nodes executed');
  check(!executed.includes('Respond to Webhook'), 'Respond to Webhook not executed for demo leads');
  check(summary.ai_calls_attempted === 0 && summary.emails_sent === 0 && summary.followup_drafts_created === 3, 'summary: 0 AI calls, 0 emails, 3 drafts');
  fs.writeFileSync(`${outDir}/n8n-e2e-demo-records.json`, JSON.stringify(records, null, 2));
  fs.writeFileSync(`${outDir}/n8n-e2e-demo-summary.json`, JSON.stringify(summary, null, 2));
} else {
  check(records.every((r) => r.lead_category === 'NEEDS_REVIEW' && r.analysis_status === 'failed'), 'all leads fail safe to NEEDS_REVIEW', records.map((r) => `${r.lead_id}:${r.lead_category}`).join(' '));
  check(records.every((r) => !r.followup_body), 'no drafts created');
  console.log(`  info  override reason sample: ${records[0] && records[0].override_reason}`);
  if (variant === 'prod_ai_no_network') check(executed.includes('AI · Analyze Lead'), 'real HTTP node executed and its failure was contained');
  fs.writeFileSync(`${outDir}/n8n-e2e-${variant}-records.json`, JSON.stringify(records.map((r) => ({ lead_id: r.lead_id, lead_category: r.lead_category, override_reason: r.override_reason })), null, 2));
}
process.exit(fails ? 1 : 0);
