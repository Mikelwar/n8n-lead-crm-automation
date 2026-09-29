#!/usr/bin/env node
// Offline test for workflows/ai-lead-crm-automation.json. No network, no n8n, no dependencies.
//   node scripts/test-offline.js
// 1. Static checks: valid JSON, connections, production nodes disabled, no secrets.
// 2. Runs the workflow's own node definitions (Code / Set / IF / Switch / Merge) with a small
//    engine that mimics n8n's behaviour, starting from "Run Demo", and asserts the demo results.
// 3. Runs variants: demo_mode = false (AI nodes disabled -> fail safe) and a single-lead run.
// The authoritative end-to-end test is a real n8n 2.37.10 execution (see docs/SETUP.md).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WF_PATH = path.join(ROOT, 'workflows', 'ai-lead-crm-automation.json');
let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

// ------------------------------------------------------------------ static checks
const rawText = fs.readFileSync(WF_PATH, 'utf8');
const wf = JSON.parse(rawText);
console.log('\n[static] workflow JSON');
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const work = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
check(wf.nodes.length === Object.keys(byName).length, 'node names are unique');
check(new Set(wf.nodes.map((n) => n.id)).size === wf.nodes.length, 'node ids are unique');

let danglingConnections = 0;
const hasIncoming = new Set();
for (const [from, { main }] of Object.entries(wf.connections)) {
  if (!byName[from]) danglingConnections++;
  main.forEach((branch) => branch.forEach((c) => { if (!byName[c.node]) danglingConnections++; hasIncoming.add(c.node); }));
}
check(danglingConnections === 0, 'all connections point to existing nodes');
const triggers = work.filter((n) => /Trigger$|webhook$/i.test(n.type));
const orphans = work.filter((n) => !triggers.includes(n) && !hasIncoming.has(n.name));
check(orphans.length === 0, 'every non-trigger node has an input', orphans.map((n) => n.name).join(', '));
check(byName['Run Demo'] && byName['Run Demo'].type === 'n8n-nodes-base.manualTrigger', 'manual trigger "Run Demo" exists');
check(wf.connections['Run Demo'].main[0][0].node === 'DEMO · Load Sample Leads', 'Run Demo → DEMO · Load Sample Leads');
check(wf.connections['DEMO · Load Sample Leads'].main[0][0].node === 'Normalize Lead', 'DEMO · Load Sample Leads → Normalize Lead');

const cfgAssign = byName.Config.parameters.assignments.assignments;
check(cfgAssign.find((a) => a.name === 'config.demo_mode').value === true, 'config.demo_mode = true by default');

const external = work.filter((n) => /httpRequest|googleSheets|hubspot|dataTable/.test(n.type));
check(external.length === 6 && external.every((n) => n.disabled === true), 'all 6 external integration nodes are present and disabled', external.map((n) => n.name).join(', '));
check(!/emailSend|gmail|outlook|smtp|sendgrid|mailgun/i.test(work.map((n) => n.type).join(' ')), 'no email-sending node exists');
check(work.every((n) => !n.credentials), 'no credentials are referenced in the workflow JSON');
const secretPatterns = [/sk-ant-[a-z0-9]/i, /sk-[a-z0-9]{20,}/i, /Bearer\s+[A-Za-z0-9._-]{16,}/, /xox[baprs]-/, /AKIA[0-9A-Z]{16}/, /pat-[a-z]{2}\d-[0-9a-f-]{20,}/i, /"(api[_-]?key|password|secret|token)"\s*:\s*"[^"]{8,}"/i];
check(secretPatterns.every((re) => !re.test(rawText)), 'no API keys / tokens / passwords in the workflow JSON');

// Layout: nodes are ~100x100 plus a label below; stickies reserve their top band for text.
const NODE_W = 100;
const NODE_H = 140; // node + label/subtitle
const TEXT_BAND = 170;
const box = (n) => ({ x1: n.position[0], y1: n.position[1], x2: n.position[0] + NODE_W, y2: n.position[1] + NODE_H });
const stickies = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
const overlaps = [];
for (let a = 0; a < work.length; a++) {
  for (let b = a + 1; b < work.length; b++) {
    const A = box(work[a]);
    const B = box(work[b]);
    if (A.x1 < B.x2 && B.x1 < A.x2 && A.y1 < B.y2 && B.y1 < A.y2) overlaps.push(`${work[a].name} / ${work[b].name}`);
  }
}
check(overlaps.length === 0, 'no two nodes overlap on the canvas', overlaps.join('; '));
const misplaced = work.filter((n) => {
  const B = box(n);
  return !stickies.some((s) => {
    const [sx, sy] = s.position;
    return B.x1 >= sx && B.x2 <= sx + s.parameters.width && B.y1 >= sy + TEXT_BAND && B.y2 <= sy + s.parameters.height;
  });
});
check(misplaced.length === 0, 'every node sits inside a section, below its sticky text', misplaced.map((n) => n.name).join(', '));

// ------------------------------------------------------------------ mini engine
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const clone = (v) => JSON.parse(JSON.stringify(v));
const evalExpr = (value, json) => {
  if (typeof value !== 'string' || !value.startsWith('={{')) return value;
  const expr = value.slice(3, value.lastIndexOf('}}'));
  return new Function('$json', `return (${expr});`)(json);
};
const setPath = (obj, dotted, value) => {
  const keys = dotted.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
};
const condTrue = (c, json) => {
  const left = evalExpr(c.leftValue, json);
  const { type, operation } = c.operator;
  if (type === 'boolean' && operation === 'true') return left === true;
  if (type === 'string' && operation === 'equals') return left === c.rightValue;
  throw new Error(`unsupported operator ${type}.${operation}`);
};
const condsMatch = (conds, json) => {
  const results = conds.conditions.map((c) => condTrue(c, json));
  return conds.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
};

async function run(workflow, { onHttp } = {}) {
  const names = workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n) => n.name);
  const nodeBy = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));
  // topological order
  const indeg = Object.fromEntries(names.map((n) => [n, 0]));
  for (const { main } of Object.values(workflow.connections)) main.forEach((b) => b.forEach((c) => { indeg[c.node]++; }));
  const order = [];
  const queue = names.filter((n) => indeg[n] === 0);
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    ((workflow.connections[n] || {}).main || []).forEach((b) => b.forEach((c) => { if (--indeg[c.node] === 0) queue.push(c.node); }));
  }
  if (order.length !== names.length) throw new Error('workflow graph has a cycle');

  const inputs = {}; // name -> [[items for input 0], [input 1], ...]
  const outputs = {}; // name -> [[items for output 0], ...]
  const executed = [];
  const deliver = (from, outIdx, items) => {
    const conns = (((workflow.connections[from] || {}).main || [])[outIdx]) || [];
    conns.forEach((c) => {
      inputs[c.node] = inputs[c.node] || [];
      inputs[c.node][c.index] = (inputs[c.node][c.index] || []).concat(clone(items));
    });
  };

  for (const name of order) {
    const node = nodeBy[name];
    let ins = inputs[name];
    if (name === 'Run Demo') ins = [[{ json: {} }]];
    if (!ins || !ins.some((a) => a && a.length)) continue; // not reached
    executed.push(name);
    const firstInput = ins[0] || [];
    let outs;
    const p = node.parameters;

    if (node.disabled) outs = [firstInput];
    else if (node.type === 'n8n-nodes-base.manualTrigger') outs = [[{ json: {} }]];
    else if (node.type === 'n8n-nodes-base.code') {
      const $ = (ref) => ({ itemMatching: (i) => ({ json: clone(outputs[ref][0][i].json) }), all: () => clone(outputs[ref][0]) });
      let res;
      try {
        const fn = new AsyncFunction('$input', '$', '$getWorkflowStaticData', '$execution', p.jsCode);
        res = await fn({ all: () => clone(firstInput) }, $, () => ({}), { id: 'offline-test' });
      } catch (e) {
        e.message = `[${name}] ${e.message}`;
        throw e;
      }
      outs = [res.map((r) => ({ json: r.json }))];
    } else if (node.type === 'n8n-nodes-base.set') {
      outs = [firstInput.map((it) => {
        const json = p.includeOtherFields ? clone(it.json) : {};
        p.assignments.assignments.forEach((a) => setPath(json, a.name, evalExpr(a.value, it.json)));
        return { json };
      })];
    } else if (node.type === 'n8n-nodes-base.if') {
      outs = [[], []];
      firstInput.forEach((it) => outs[condsMatch(p.conditions, it.json) ? 0 : 1].push(it));
    } else if (node.type === 'n8n-nodes-base.switch') {
      outs = p.rules.values.map(() => []);
      firstInput.forEach((it) => {
        const idx = p.rules.values.findIndex((r) => condsMatch(r.conditions, it.json));
        const target = idx === -1 ? p.options.fallbackOutput : idx;
        if (typeof target === 'number') outs[target].push(it);
      });
    } else if (node.type === 'n8n-nodes-base.merge') {
      outs = [ins.flat().filter(Boolean)];
    } else if (node.type === 'n8n-nodes-base.httpRequest') {
      outs = [firstInput.map((it) => ({ json: onHttp ? onHttp(it.json) : { error: { message: 'network disabled in offline test' } } }))];
    } else if (node.type === 'n8n-nodes-base.respondToWebhook') {
      outs = [firstInput];
    } else {
      throw new Error(`offline engine does not support ${node.type} (${name})`);
    }
    outputs[name] = outs;
    outs.forEach((items, idx) => { if (items.length) deliver(name, idx, items); });
  }
  return { outputs, executed };
}

// ------------------------------------------------------------------ demo run
const EXPECTED = {
  'L-1001': ['HOT', 'QUALIFIED', true],
  'L-1002': ['WARM', 'QUALIFIED', true],
  'L-1003': ['COLD', 'NURTURE', true],
  'L-1004': ['SPAM', 'REJECTED', false],
  'L-1005': ['DUPLICATE', 'DUPLICATE', false],
  'L-1006': ['NEEDS_REVIEW', 'INCOMPLETE', false],
  'L-1007': ['NEEDS_REVIEW', 'NEEDS_REVIEW', false],
};

(async () => {
  console.log('\n[demo] demo_mode = true, 7 sample leads');
  const demo = await run(wf, { onHttp: () => { throw new Error('HTTP node executed in demo mode'); } });
  const records = demo.outputs['Build Final CRM Record'][0].map((i) => i.json);
  check(records.length === 7, 'all 7 demo leads produce a final CRM record', `${records.length}`);
  for (const r of records) {
    const [cat, status, draft] = EXPECTED[r.lead_id];
    check(r.lead_category === cat && r.qualification_status === status,
      `${r.lead_id} ${r.full_name} → ${cat}`, `got ${r.lead_category}/${r.qualification_status}, score ${r.lead_score}, owner ${r.owner}`);
    check(Boolean(r.followup_body) === draft && r.followup_auto_send === false,
      `${r.lead_id} follow-up draft ${draft ? 'present' : 'absent'}, auto_send=false`, r.followup_status);
  }
  const aiNodes = ['AI · Build Analysis Request', 'AI · Analyze Lead', 'AI · Build Follow-up Request', 'AI · Draft Follow-up', 'Parse Follow-up Draft'];
  check(aiNodes.every((n) => !demo.executed.includes(n)), 'no AI / HTTP node executed in demo mode');
  check(!demo.executed.includes('Respond to Webhook'), 'Respond to Webhook skipped for demo leads');
  check(records.every((r) => r.demo_mode === true && r.analysis_source === 'mock'), 'every record is marked demo_mode + mock analysis');
  check(records.every((r) => r.followup_safety_flags.length === 0), 'no draft contains prices, dates or guarantees');
  const summary = demo.outputs['Batch Summary'][0][0].json;
  check(summary.ai_calls_attempted === 0 && summary.emails_sent === 0, 'batch summary: 0 AI calls, 0 emails sent');
  check(records.find((r) => r.lead_id === 'L-1005').owner === records.find((r) => r.lead_id === 'L-1001').owner, 'duplicate inherits the original lead\'s owner');
  const required = ['lead_id', 'timestamp', 'full_name', 'email', 'phone', 'company', 'job_title', 'source', 'requested_service', 'estimated_budget', 'timeline', 'lead_score', 'lead_temperature', 'qualification_status', 'priority', 'owner', 'requires_followup', 'followup_subject', 'followup_body', 'recommended_action', 'analysis_summary', 'status', 'model', 'demo_mode'];
  check(records.every((r) => required.every((k) => k in r)), 'final record contains every required CRM field');
  check(records.every((r) => r.raw_input && typeof r.raw_input === 'object'), 'raw lead input preserved on every record');

  fs.mkdirSync(path.join(ROOT, 'test-output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'test-output', 'offline-demo-records.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(ROOT, 'test-output', 'offline-demo-summary.json'), JSON.stringify(summary, null, 2));

  // ---------------------------------------------------------------- production-mode fail-safe
  console.log('\n[variant] demo_mode = false, AI nodes still disabled');
  const prod = clone(wf);
  prod.nodes.find((n) => n.name === 'Config').parameters.assignments.assignments.find((a) => a.name === 'config.demo_mode').value = false;
  const prodRun = await run(prod);
  const prodRecords = prodRun.outputs['Build Final CRM Record'][0].map((i) => i.json);
  check(prodRecords.length === 7, 'all 7 leads still complete');
  check(prodRecords.every((r) => r.lead_category === 'NEEDS_REVIEW' && r.analysis_status === 'failed'), 'every lead fails safe to NEEDS_REVIEW');
  check(prodRecords.every((r) => !r.followup_body), 'no follow-up drafts without a valid analysis');

  console.log('\n[variant] demo_mode = false, AI enabled but network unavailable');
  const prodNet = clone(prod);
  prodNet.nodes.filter((n) => n.name.startsWith('AI · ') && n.type === 'n8n-nodes-base.httpRequest').forEach((n) => { n.disabled = false; });
  const netRun = await run(prodNet);
  const netRecords = netRun.outputs['Build Final CRM Record'][0].map((i) => i.json);
  check(netRecords.every((r) => r.lead_category === 'NEEDS_REVIEW' && /provider_error/.test(r.override_reason)), 'provider errors fail safe to NEEDS_REVIEW');

  console.log('\n[variant] demo_mode = false, AI enabled, simulated Anthropic response');
  const fakeAnthropic = (req) => {
    const leadData = JSON.parse(req.ai_request.body.messages[0].content.split('<lead_data>\n')[1].split('\n</lead_data>')[0]);
    if (req.ai_request.body.output_config.format.schema.required.includes('subject')) {
      return { content: [{ type: 'text', text: JSON.stringify({ subject: `Hello ${leadData.first_name}`, body: `Hi ${leadData.first_name},\n\nThanks for reaching out. [Calendar Link]\n\n[Your Name]\n[Your Company]` }) }], stop_reason: 'end_turn' };
    }
    const a = { lead_category: 'WARM', confidence: 0.8, lead_score: 70, lead_temperature: 'WARM', qualification_status: 'QUALIFIED', buying_intent: 'medium', budget_fit: 'moderate', urgency: 'medium', authority_level: 'decision_maker', business_need: 'moderate', service_fit: 'strong', company_fit: 'moderate', business_fit: 'strong', duplicate: false, spam: false, prompt_injection_detected: false, missing_fields: [], pain_points: ['leads are tracked manually'], requires_followup: true, recommended_action: 'Follow up today.', analysis_summary: 'Simulated analysis.' };
    return { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(a) }], stop_reason: 'end_turn' };
  };
  const simRun = await run(prodNet, { onHttp: fakeAnthropic });
  const sim = Object.fromEntries(simRun.outputs['Build Final CRM Record'][0].map((i) => [i.json.lead_id, i.json]));
  check(sim['L-1002'].lead_category === 'WARM' && sim['L-1002'].followup_generated_by.startsWith('ai:'), 'valid AI response → scored lead + AI draft (pending review)');
  check(sim['L-1004'].lead_category === 'SPAM', 'AI saying "not spam" cannot clear deterministic spam signals');
  check(sim['L-1005'].lead_category === 'DUPLICATE', 'AI saying "not duplicate" cannot clear the duplicate flag');
  check(sim['L-1007'].lead_category === 'NEEDS_REVIEW', 'AI cannot clear the prompt-injection flag');
  const sentBody = JSON.stringify(simRun.outputs['AI · Build Analysis Request'][0].map((i) => i.json.ai_request.body));
  check(!sentBody.includes('daniel.okafor@') && !sentBody.includes('7946 0321'), 'full email / phone are not sent to the AI provider');

  // ---------------------------------------------------------------- single lead (webhook-like)
  console.log('\n[variant] single lead (partial merge inputs)');
  const single = clone(wf);
  const loader = single.nodes.find((n) => n.name === 'DEMO · Load Sample Leads');
  loader.parameters.jsCode = loader.parameters.jsCode.replace('return SAMPLE_LEADS.map', 'return SAMPLE_LEADS.slice(1, 2).map');
  const singleRun = await run(single);
  const s = singleRun.outputs['Build Final CRM Record'][0].map((i) => i.json);
  check(s.length === 1 && s[0].lead_category === 'WARM', 'one WARM lead flows through partially-filled merges');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
