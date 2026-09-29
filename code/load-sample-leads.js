// n8n Code node: "DEMO · Load Sample Leads"  (mode: Run Once for All Items)
// Emits the fictional demo leads from test-data/sample-leads.json.
// __SAMPLE_LEADS__ is replaced with the file contents by scripts/build-workflow.js.
// All names, companies, emails and phone numbers are fictional (.example domains, 555 numbers).

const SAMPLE_LEADS = __SAMPLE_LEADS__;

return SAMPLE_LEADS.map((lead) => ({ json: lead }));
