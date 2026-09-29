// n8n Code node: "Check Duplicate"  (mode: Run Once for All Items)
// Deterministic duplicate detection:
//   1. same email address                        -> DUPLICATE
//   2. same company (normalized) + same last name -> DUPLICATE
//   3. same company / business domain only        -> not a duplicate, flagged as related_account
// Leads are compared with earlier leads in the same batch. In production (demo_mode = false) the
// workflow's static data also remembers leads from previous executions (active workflows only).
// For a real CRM, replace/extend this with a CRM search (e.g. HubSpot "search contacts by email").

const items = $input.all();
const demoMode = items.length ? items[0].json.config?.demo_mode !== false : true;
const MAX_REMEMBERED = 5000;

let memory = null;
if (!demoMode) {
  const store = $getWorkflowStaticData('global');
  store.seenLeads = store.seenLeads || {};
  memory = store.seenLeads;
}

const normCompany = (s) => (s || '').toLowerCase()
  .replace(/\b(ltd|limited|inc|llc|gmbh|co|corp|corporation|plc|ag|sa|bv|group|holdings?)\b\.?/g, '')
  .replace(/[^a-z0-9]/g, '');

const batch = {};
const lookup = (key) => batch[key] || (memory ? memory[key] : undefined);
const remember = (key, value) => {
  batch[key] = value;
  if (memory) memory[key] = value;
};

const out = items.map((item, i) => {
  const lead = item.json;
  const emailKey = lead.email_valid ? `email:${lead.email}` : null;
  const company = normCompany(lead.company);
  const companyNameKey = company && lead.last_name ? `company_name:${company}|${lead.last_name.toLowerCase()}` : null;
  const businessDomain = lead.website_domain || (!lead.free_email_provider ? lead.email_domain : '');
  const accountKeys = [company ? `company:${company}` : null, businessDomain ? `domain:${businessDomain}` : null].filter(Boolean);

  let duplicate_of = null;
  let match_type = null;
  if (emailKey && lookup(emailKey)) {
    duplicate_of = lookup(emailKey).lead_id;
    match_type = 'same_email';
  } else if (companyNameKey && lookup(companyNameKey)) {
    duplicate_of = lookup(companyNameKey).lead_id;
    match_type = 'same_company_and_last_name';
  }

  let related_account = null;
  if (!duplicate_of) {
    const hit = accountKeys.map(lookup).find(Boolean);
    if (hit) related_account = hit.lead_id;
  }

  // Only register originals, so every duplicate points at the first record.
  if (!duplicate_of) {
    const ref = { lead_id: lead.lead_id, first_seen: lead.timestamp };
    [emailKey, companyNameKey, ...accountKeys].filter(Boolean).forEach((k) => { if (!lookup(k)) remember(k, ref); });
  }

  return {
    json: {
      ...lead,
      duplicate_check: {
        is_duplicate: Boolean(duplicate_of),
        duplicate_of,
        match_type,
        related_account,
        checked_against: memory ? 'batch + workflow memory' : 'current batch',
      },
    },
    pairedItem: { item: i },
  };
});

// Keep workflow memory bounded.
if (memory) {
  const keys = Object.keys(memory);
  if (keys.length > MAX_REMEMBERED) keys.slice(0, keys.length - MAX_REMEMBERED).forEach((k) => delete memory[k]);
}

return out;
