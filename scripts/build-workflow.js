#!/usr/bin/env node
// Builds workflows/ai-lead-crm-automation.json from code/*.js, prompts/*.md and test-data/sample-leads.json.
// Usage: node scripts/build-workflow.js
// No dependencies. The code/ and prompts/ folders are the single source of truth for the Code nodes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'workflows', 'ai-lead-crm-automation.json');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const uid = (seed) => {
  const h = crypto.createHash('sha1').update(`ai-lead-crm:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const systemPrompt = (file) => {
  const m = read(file).match(/## System prompt\s*\n+```text\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`No "## System prompt" text block found in ${file}`);
  return m[1].trim();
};

const INJECT = {
  __SAMPLE_LEADS__: () => JSON.stringify(JSON.parse(read('test-data/sample-leads.json')), null, 2),
  __PROMPT_LEAD_ANALYSIS__: () => JSON.stringify(systemPrompt('prompts/lead-analysis.md')),
  __PROMPT_FOLLOWUP__: () => JSON.stringify(systemPrompt('prompts/followup-draft.md')),
};
const code = (file) => {
  let src = read(`code/${file}`);
  // Only the assignment "= __TOKEN__;" is replaced (comments may mention the token).
  for (const [token, value] of Object.entries(INJECT)) {
    if (src.includes(`= ${token};`)) src = src.replace(`= ${token};`, () => `= ${value()};`);
  }
  return src;
};

// ---------------------------------------------------------------- node helpers
const nodes = [];
const add = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, id: uid(name), name, type, typeVersion, position, ...extra });
};
const codeNode = (name, file, position, extra) => add(name, 'n8n-nodes-base.code', 2, position, { jsCode: code(file) }, extra);
const sticky = (key, [x, y], width, height, color, content) =>
  add(`Sticky · ${key}`, 'n8n-nodes-base.stickyNote', 1, [x, y], { content, height, width, color });

const COND_OPTIONS = { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 };
const isTrue = { type: 'boolean', operation: 'true', singleValue: true };
const ifNode = (name, position, leftValue, operator, rightValue = '', extra = {}) =>
  add(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: COND_OPTIONS,
      conditions: [{ id: uid(`${name}:cond`), leftValue, rightValue, operator }],
      combinator: 'and',
    },
    options: {},
  }, extra);

const assignment = (scope, name, type, value) => ({ id: uid(`${scope}:${name}`), name, value, type });
const setNode = (name, position, assignments, extra = {}) =>
  add(name, 'n8n-nodes-base.set', 3.4, position, {
    mode: 'manual',
    duplicateItem: false,
    assignments: { assignments },
    includeOtherFields: true,
    include: 'all',
    options: {},
  }, extra);

const disabledNote = (text) => ({ disabled: true, notes: text, notesInFlow: true });
const note = (text) => ({ notes: text, notesInFlow: true });

// ---------------------------------------------------------------- layout
const ROW = 180; // main row
const SECTION_TOP = -380;
const SECTION_H = 1100;
const PROD_TOP = 780;
const PROD_H = 420;
const PROD_ROW = 960;

// ---------------------------------------------------------------- sticky notes
sticky('Header', [-160, -840], 2280, 420, 7, [
  '# 🎯 AI Lead Qualification & CRM Automation',
  '### Demo execution using mock AI responses. Production path is ready for external AI and CRM integrations.',
  'Incoming leads → **normalized** → **duplicate-checked** → **analyzed** (mock AI in demo / real AI in production) → **scored** with deterministic business rules → **routed** (HOT · WARM · COLD · SPAM/REJECT · DUPLICATE · NEEDS_REVIEW) → follow-up **drafted, never sent** → **owner assigned** → **CRM-ready record**.',
  '',
  '▶ **Run it:** click **Run Demo** → 7 fictional leads, zero external API calls, zero AI cost. `config.demo_mode = true` by default.',
  '',
  '🟦 Intake  ·  🟩 Analysis & Scoring  ·  🟪 Follow-up Drafts  ·  🟧 CRM Output  ·  🟥 Production integrations (disabled until configured)',
].join('\n'));

sticky('Intake', [-160, SECTION_TOP], 1000, SECTION_H, 5, [
  '## 1 · Lead Intake',
  '**Run Demo** loads 7 fictional sample leads. In production, leads arrive through the **Webhook** (red, below).',
  '**Normalize Lead** maps any form payload to one schema, validates email / phone, parses budget & timeline, and flags spam and prompt-injection patterns. Lead text is treated as **untrusted input**; the raw payload is preserved.',
  '**Config** holds `demo_mode`, AI provider / model, score thresholds and team rosters.',
].join('\n'));

sticky('Analysis', [880, SECTION_TOP], 1940, SECTION_H, 4, [
  '## 2 · Lead Analysis & Scoring',
  '**Check Duplicate** matches email or company + name. **Demo Mode?** sends leads to the **mock analyzer** (demo) or the **AI path** (production, red below). **Parse & Validate** enforces the JSON schema: the AI can add risk flags but never remove them.',
  '**Score Lead**: `+20 budget` `+20 authority` `+20 need` `+15 urgency` `+15 service fit` `+10 company fit` · penalties `−20 unclear intent` `−30 very low budget` `−50 spam` `−100 malicious`',
  '**80–100 HOT · 55–79 WARM · 30–54 COLD · 0–29 REJECT**. Business rules override the score for spam, duplicates, incomplete leads and security flags.',
].join('\n'));

sticky('Follow-up', [2860, SECTION_TOP], 1180, SECTION_H, 6, [
  '## 3 · Follow-up Drafts',
  'Only **HOT, WARM and COLD** leads get a draft. Drafts use the lead\'s own context (first name, company, service, pain point, stated timeline) plus **[placeholders]**. No invented prices, dates, guarantees or technical claims.',
  '**Drafts are never sent automatically** (`auto_send = false`). A human reviews every message.',
].join('\n'));

sticky('CRM Output', [4080, SECTION_TOP], 1000, SECTION_H, 2, [
  '## 4 · CRM Output',
  '**Assign Owner** picks a named rep from the Config roster (stable round-robin; duplicates go to the original owner). **Build Final CRM Record** produces one flat CRM-ready record per lead and safety-checks every draft. **Batch Summary** counts leads per route.',
  '**Respond to Webhook** only runs for webhook leads and returns a minimal acknowledgement, never internal scores.',
].join('\n'));

sticky('Prod Source', [-160, PROD_TOP], 1000, PROD_H, 3, [
  '## 🟥 Production · Lead Source',
  '**Webhook · Receive Lead**: `POST /webhook/lead-intake` (JSON or form fields: Typeform, Tally, Webflow, custom forms). Active only when the workflow is published. Add header auth / rate limiting before exposing it publicly.',
].join('\n'));

sticky('Prod AI Analysis', [1100, PROD_TOP], 820, PROD_H, 3, [
  '## 🟥 Production · AI Analysis (disabled)',
  'Runs only when `config.demo_mode = false`. Provider-agnostic HTTP call (Anthropic Messages API or any OpenAI-compatible API); model & endpoint come from **Config**. The API key lives in an n8n **Header Auth credential**, never in the workflow JSON. Failure / disabled node → lead goes to **NEEDS_REVIEW**.',
].join('\n'));

sticky('Prod AI Follow-up', [3040, PROD_TOP], 1000, PROD_H, 3, [
  '## 🟥 Production · AI Follow-up (disabled)',
  'Same provider-agnostic pattern. The prompt forbids prices, dates and promises; lead text is passed as untrusted data. If generation fails the lead continues **without** a draft (`GENERATION_FAILED`) for a human to write.',
].join('\n'));

sticky('Prod CRM', [4080, PROD_TOP], 1000, PROD_H, 3, [
  '## 🟥 Production · CRM & Logging (disabled)',
  'Enable + attach credentials to write every record to an n8n **Data Table**, **Google Sheets**, **HubSpot** (upsert contact) or any CRM via HTTP. Disabled nodes pass data through, so the demo runs without them.',
].join('\n'));

// ---------------------------------------------------------------- 1 · intake
add('Run Demo', 'n8n-nodes-base.manualTrigger', 1, [0, ROW], {}, note('▶ Click to run the demo'));
codeNode('DEMO · Load Sample Leads', 'load-sample-leads.js', [220, ROW], note('7 fictional leads'));
add('Webhook · Receive Lead', 'n8n-nodes-base.webhook', 2.1, [220, PROD_ROW], {
  httpMethod: 'POST',
  path: 'lead-intake',
  responseMode: 'responseNode',
  options: {},
}, { webhookId: uid('webhook:lead-intake'), ...note('POST /webhook/lead-intake') });
codeNode('Normalize Lead', 'normalize-lead.js', [460, ROW], note('Clean · validate · flag'));

const OWNERS = {
  'Senior Sales': ['Avery Chen', 'Morgan Patel'],
  Sales: ['Jamie Rivera', 'Taylor Brooks'],
  'Nurture / Marketing': ['Nurture queue (Marketing Automation)'],
  'Sales Ops': ['Sales Ops queue'],
  'System (auto-archive)': ['System (auto-archive)'],
};
const TARGET_INDUSTRIES = ['SaaS', 'Software', 'Logistics', 'E-commerce', 'Professional Services', 'Financial Services', 'Real Estate', 'Marketing'];
setNode('Config', [680, ROW], [
  assignment('cfg', 'config.demo_mode', 'boolean', true),
  assignment('cfg', 'config.ai_provider', 'string', 'anthropic'),
  assignment('cfg', 'config.ai_model', 'string', 'claude-opus-5'),
  assignment('cfg', 'config.ai_endpoint', 'string', 'https://api.anthropic.com/v1/messages'),
  assignment('cfg', 'config.ai_max_tokens', 'number', 4096),
  assignment('cfg', 'config.ai_effort', 'string', 'low'),
  assignment('cfg', 'config.ai_refusal_fallback', 'boolean', true),
  assignment('cfg', 'config.crm_provider', 'string', 'hubspot'),
  assignment('cfg', 'config.auto_send_followups', 'boolean', false),
  assignment('cfg', 'config.score_hot_min', 'number', 80),
  assignment('cfg', 'config.score_warm_min', 'number', 55),
  assignment('cfg', 'config.score_cold_min', 'number', 30),
  assignment('cfg', 'config.target_industries', 'array', `={{ ${JSON.stringify(TARGET_INDUSTRIES)} }}`),
  assignment('cfg', 'config.ideal_company_size', 'object', '={{ { "min": 50, "max": 1000 } }}'),
  assignment('cfg', 'config.owners', 'object', `={{ ${JSON.stringify(OWNERS)} }}`),
  assignment('cfg', 'config.workflow_version', 'string', '1.0.0'),
], note('demo_mode = true'));

// ---------------------------------------------------------------- 2 · analysis & scoring
codeNode('Check Duplicate', 'duplicate-check.js', [940, ROW], note('Email · company + name'));
ifNode('Demo Mode? (Analyze)', [1160, ROW], '={{ $json.config.demo_mode }}', isTrue, '', note('true → mock · false → AI'));
codeNode('DEMO · Mock Lead Analysis', 'mock-analysis.js', [1400, ROW], note('Mock AI · no API call'));
codeNode('AI · Build Analysis Request', 'build-analysis-request.js', [1240, PROD_ROW], note('Provider-specific body'));
const aiHttp = (name, position) => add(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
  method: 'POST',
  url: '={{ $json.ai_request.url }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendHeaders: true,
  specifyHeaders: 'json',
  jsonHeaders: '={{ JSON.stringify($json.ai_request.headers) }}',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.ai_request.body) }}',
  options: { timeout: 120000, response: { response: { neverError: true } } },
}, {
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 5000,
  onError: 'continueRegularOutput',
  ...disabledNote('Disabled · attach Header Auth credential'),
});
aiHttp('AI · Analyze Lead', [1480, PROD_ROW]);
codeNode('Parse & Validate Analysis', 'parse-analysis.js', [1640, ROW], note('Schema check · fail safe'));
codeNode('Score Lead', 'score-lead.js', [1860, ROW], note('Rubric + business rules'));

const rule = (key, values) => ({
  conditions: {
    options: COND_OPTIONS,
    conditions: values.map((v) => ({
      id: uid(`router:${key}:${v}`),
      leftValue: '={{ $json.lead_category }}',
      rightValue: v,
      operator: { type: 'string', operation: 'equals' },
    })),
    combinator: 'or',
  },
  renameOutput: true,
  outputKey: key,
});
const ROUTES = [
  ['HOT', ['HOT']],
  ['WARM', ['WARM']],
  ['COLD', ['COLD']],
  ['SPAM / REJECT', ['SPAM', 'REJECT']],
  ['DUPLICATE', ['DUPLICATE']],
  ['NEEDS_REVIEW', ['NEEDS_REVIEW']],
];
add('Lead Quality Router', 'n8n-nodes-base.switch', 3.2, [2080, ROW], {
  rules: { values: ROUTES.map(([k, v]) => rule(k, v)) },
  options: { fallbackOutput: 5 },
}, note('Unknown → NEEDS_REVIEW'));

const ROUTE_STAMPS = {
  HOT: ['immediate', '15–30 minutes', 'Senior Sales', 'New – Hot', 'Call or email within SLA; offer a discovery call'],
  WARM: ['same_day', 'Within 4 hours', 'Sales', 'New – Warm', 'Personal follow-up email with scoping questions'],
  COLD: ['low', 'Automated nurture sequence', 'Nurture / Marketing', 'Nurture', 'Enroll in nurture sequence; re-score on engagement'],
  'SPAM / REJECT': ['none', 'No follow-up', 'System (auto-archive)', 'Archived',
    "={{ $json.lead_category === 'SPAM' ? 'Archive as spam; do not reply' : 'Archive as low value; no follow-up' }}"],
  DUPLICATE: ['none', 'No new follow-up', 'Sales Ops', 'Merged – Duplicate', '={{ "Link / merge with existing record " + $json.duplicate_check.duplicate_of }}'],
  NEEDS_REVIEW: ['manual', 'Manual review – next business day', 'Sales Ops', 'Needs Review', '={{ "Manual review: " + ($json.override_reason || "unclassified lead") }}'],
};
const ROUTE_Y = [-140, 0, 140, 280, 420, 560];
ROUTES.forEach(([key], idx) => {
  const [priority, sla, team, status, action] = ROUTE_STAMPS[key];
  const scope = `route:${key}`;
  setNode(`Route · ${key}`, [2340, ROUTE_Y[idx]], [
    assignment(scope, 'routing.route', 'string', key),
    assignment(scope, 'routing.priority', 'string', priority),
    assignment(scope, 'routing.sla', 'string', sla),
    assignment(scope, 'routing.owner_team', 'string', team),
    assignment(scope, 'routing.crm_status', 'string', status),
    assignment(scope, 'routing.next_action', 'string', action),
  ]);
});
add('Merge Routes', 'n8n-nodes-base.merge', 3.2, [2600, ROW], { numberInputs: 6 });

// ---------------------------------------------------------------- 3 · follow-up
ifNode('Needs Follow-up?', [2920, ROW], '={{ $json.requires_followup }}', isTrue, '', note('HOT · WARM · COLD only'));
ifNode('Demo Mode? (Follow-up)', [3140, 40], '={{ $json.config.demo_mode }}', isTrue, '', note('true → mock · false → AI'));
codeNode('DEMO · Mock Follow-up', 'mock-followup.js', [3380, 40], note('Draft only · never sent'));
codeNode('AI · Build Follow-up Request', 'build-followup-request.js', [3140, PROD_ROW], note('Provider-specific body'));
aiHttp('AI · Draft Follow-up', [3380, PROD_ROW]);
codeNode('Parse Follow-up Draft', 'parse-followup.js', [3620, PROD_ROW], note('Fail safe: no draft'));
add('Merge Follow-up', 'n8n-nodes-base.merge', 3.2, [3880, ROW], {});

// ---------------------------------------------------------------- 4 · CRM output
codeNode('Assign Owner', 'assign-owner.js', [4140, ROW], note('Roster from Config'));
codeNode('Build Final CRM Record', 'build-final-record.js', [4360, ROW], note('CRM-ready record'));
codeNode('Batch Summary', 'batch-summary.js', [4620, 20], note('Counts per route'));
ifNode('Webhook Request?', [4620, 320], '={{ $json.entry_channel }}', { type: 'string', operation: 'equals' }, 'webhook');
add('Respond to Webhook', 'n8n-nodes-base.respondToWebhook', 1.1, [4860, 320], {
  respondWith: 'json',
  responseBody: '={{ JSON.stringify({ received: true, lead_id: $json.lead_id, message: "Thanks, your inquiry has been received. Our team will be in touch." }) }}',
  options: { responseCode: 200 },
}, note('Minimal ack · no scores'));

add('Log · Data Table', 'n8n-nodes-base.dataTable', 1.1, [4160, PROD_ROW], {
  resource: 'row',
  operation: 'insert',
  dataTableId: { __rl: true, mode: 'list', value: '' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, disabledNote('Disabled · select a Data Table'));
add('Log · Google Sheets', 'n8n-nodes-base.googleSheets', 4.5, [4380, PROD_ROW], {
  operation: 'append',
  documentId: { __rl: true, mode: 'list', value: '' },
  sheetName: { __rl: true, mode: 'list', value: '' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, disabledNote('Disabled · needs Google credential'));
add('CRM · HubSpot Upsert Contact', 'n8n-nodes-base.hubspot', 2.1, [4600, PROD_ROW], {
  authentication: 'appToken',
  resource: 'contact',
  operation: 'upsert',
  email: '={{ $json.email }}',
  additionalFields: {
    firstName: '={{ $json.full_name.split(" ")[0] }}',
    lastName: '={{ $json.full_name.split(" ").slice(1).join(" ") }}',
    companyName: '={{ $json.company }}',
    jobTitle: '={{ $json.job_title }}',
    phoneNumber: '={{ $json.phone }}',
    country: '={{ $json.country }}',
    message: '={{ $json.lead_category + " (" + $json.lead_score + ") · " + $json.analysis_summary }}',
  },
}, disabledNote('Disabled · needs HubSpot credential'));
add('CRM · Generic CRM API', 'n8n-nodes-base.httpRequest', 4.2, [4820, PROD_ROW], {
  method: 'POST',
  url: 'https://crm.example.com/api/v1/leads',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json) }}',
  options: { timeout: 30000 },
}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, ...disabledNote('Disabled · set URL + credential') });

// ---------------------------------------------------------------- connections
const connections = {};
const connect = (from, to, fromIndex = 0, toIndex = 0) => {
  const outs = (connections[from] = connections[from] || { main: [] });
  while (outs.main.length <= fromIndex) outs.main.push([]);
  outs.main[fromIndex].push({ node: to, type: 'main', index: toIndex });
};

connect('Run Demo', 'DEMO · Load Sample Leads');
connect('DEMO · Load Sample Leads', 'Normalize Lead');
connect('Webhook · Receive Lead', 'Normalize Lead');
connect('Normalize Lead', 'Config');
connect('Config', 'Check Duplicate');
connect('Check Duplicate', 'Demo Mode? (Analyze)');
connect('Demo Mode? (Analyze)', 'DEMO · Mock Lead Analysis', 0);
connect('Demo Mode? (Analyze)', 'AI · Build Analysis Request', 1);
connect('AI · Build Analysis Request', 'AI · Analyze Lead');
connect('AI · Analyze Lead', 'Parse & Validate Analysis');
connect('DEMO · Mock Lead Analysis', 'Parse & Validate Analysis');
connect('Parse & Validate Analysis', 'Score Lead');
connect('Score Lead', 'Lead Quality Router');
ROUTES.forEach(([key], idx) => {
  connect('Lead Quality Router', `Route · ${key}`, idx);
  connect(`Route · ${key}`, 'Merge Routes', 0, idx);
});
connect('Merge Routes', 'Needs Follow-up?');
connect('Needs Follow-up?', 'Demo Mode? (Follow-up)', 0);
connect('Needs Follow-up?', 'Merge Follow-up', 1, 0);
connect('Demo Mode? (Follow-up)', 'DEMO · Mock Follow-up', 0);
connect('Demo Mode? (Follow-up)', 'AI · Build Follow-up Request', 1);
connect('DEMO · Mock Follow-up', 'Merge Follow-up', 0, 1);
connect('AI · Build Follow-up Request', 'AI · Draft Follow-up');
connect('AI · Draft Follow-up', 'Parse Follow-up Draft');
connect('Parse Follow-up Draft', 'Merge Follow-up', 0, 1);
connect('Merge Follow-up', 'Assign Owner');
connect('Assign Owner', 'Build Final CRM Record');
for (const target of ['Batch Summary', 'Webhook Request?', 'Log · Data Table', 'Log · Google Sheets', 'CRM · HubSpot Upsert Contact', 'CRM · Generic CRM API']) {
  connect('Build Final CRM Record', target);
}
connect('Webhook Request?', 'Respond to Webhook', 0);

// ---------------------------------------------------------------- write
const workflow = {
  name: 'AI Lead Qualification & CRM Automation',
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
  active: false,
  meta: { templateCredsSetupCompleted: false },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length} nodes, ${nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length} sticky notes`);
