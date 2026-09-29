// n8n Code node: "Normalize Lead"  (mode: Run Once for All Items)
// Maps leads from DEMO · Load Sample Leads or Webhook · Receive Lead to one canonical schema.
// - Lead content is UNTRUSTED input: control characters are stripped, the message is length-capped,
//   and prompt-injection / markup / spam patterns are flagged (never executed or obeyed).
// - The original payload is preserved in raw_input (webhook headers are NOT kept: they may carry secrets).

const MAX_MESSAGE_CHARS = 4000;

const FREE_EMAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'mail.com'];
const DISPOSABLE_EMAIL_DOMAINS = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com'];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i,
  /(reveal|show|print|output|include|leak)\b.{0,40}\b(system\s*prompt|api[\s_-]*keys?|credentials?|secrets?|passwords?)/i,
  /\byou\s+are\s+now\b|\bact\s+as\s+(an?|the)\s+/i,
  /\b(classify|mark|score|rate|label)\s+(this|me|my|the)\s+(lead|inquiry|request)?.{0,30}\b(hot|100)\b/i,
  /\b(system|assistant)\s*:\s/i,
];
const MARKUP_PATTERN = /<\s*\/?\s*(script|iframe|object|embed|img|svg|a)\b|javascript:|on\w+\s*=/i;

const SPAM_KEYWORDS = [/guarantee/i, /backlinks?/i, /#\s?1\s+(rank|on google)/i, /ranking on google/i, /\bseo\b/i, /crypto|bitcoin/i, /casino|betting/i, /\bloans?\b/i, /limited (time )?offer/i, /act now/i, /dear sir\s*\/?\s*madam/i, /click here/i, /100% free/i, /cheap/i];

// ---------- helpers ----------
const clean = (v) => {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = clean(obj[k]);
    if (v) return v;
  }
  return '';
};

function parseBudget(text) {
  const t = clean(text).toLowerCase().replace(/,/g, '');
  if (!t) return { min: null, max: null, currency: null, estimate: null };
  const currency = /€|\beur\b/.test(t) ? 'EUR' : /£|\bgbp\b/.test(t) ? 'GBP' : /\$|\busd\b/.test(t) ? 'USD' : null;
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?\b/g)].map((m) => parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
  if (!nums.length) return { min: null, max: null, currency, estimate: null };
  if (/under|less than|below|<|up to|max/.test(t)) return { min: 0, max: nums[0], currency, estimate: nums[0] };
  const min = nums[0];
  const max = nums[1] !== undefined ? nums[1] : nums[0];
  return { min, max, currency, estimate: min }; // conservative: use the lower bound
}

function parseTimelineDays(text) {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  if (/asap|immediately|urgent|this week|right away/.test(t)) return 7;
  if (/no rush|no specific|not sure|someday|next year|no timeline|eventually|at some point/.test(t)) return 365;
  const m = t.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*(day|week|month)/);
  if (m) {
    const n = parseInt(m[2] || m[1], 10);
    return n * (m[3] === 'day' ? 1 : m[3] === 'week' ? 7 : 30);
  }
  if (/this month/.test(t)) return 30;
  if (/this quarter/.test(t)) return 90;
  if (/next quarter|this year/.test(t)) return 180;
  return null;
}

function parseCompanySize(text) {
  const t = clean(text).replace(/,/g, '');
  const nums = (t.match(/\d+/g) || []).map(Number);
  if (!nums.length) return { min: null, max: null };
  if (/\+|over|more than/i.test(t)) return { min: nums[0], max: null };
  return { min: nums[0], max: nums[1] !== undefined ? nums[1] : nums[0] };
}

const toDomain = (url) => clean(url).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] || '';

// ---------- main ----------
const out = [];
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const j = items[i].json || {};

  // Webhook items look like { headers, params, query, body, webhookUrl, executionMode }
  const isWebhook = j.body !== undefined && j.headers !== undefined;
  let payload = isWebhook ? j.body : j;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = { message: payload }; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};

  const firstLast = [pick(payload, ['first_name', 'firstName']), pick(payload, ['last_name', 'lastName'])].filter(Boolean).join(' ');
  const full_name = pick(payload, ['full_name', 'fullName', 'name', 'contact_name']) || firstLast;
  const nameParts = full_name.split(' ').filter(Boolean);

  const email = pick(payload, ['email', 'email_address', 'emailAddress', 'work_email']).toLowerCase();
  const email_valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const email_domain = email_valid ? email.split('@')[1] : '';

  const phone = pick(payload, ['phone', 'phone_number', 'phoneNumber', 'mobile']);
  const phoneDigits = phone.replace(/[^\d]/g, '');
  const phone_normalized = phoneDigits ? (phone.trim().startsWith('+') ? '+' : '') + phoneDigits : '';

  let message = pick(payload, ['message', 'comments', 'comment', 'notes', 'inquiry', 'description']);
  const message_truncated = message.length > MAX_MESSAGE_CHARS;
  if (message_truncated) message = message.slice(0, MAX_MESSAGE_CHARS);
  const message_clean = message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  const company = pick(payload, ['company', 'company_name', 'companyName', 'organization', 'organisation']);
  const website = pick(payload, ['website', 'url', 'company_website', 'domain']);
  const estimated_budget = pick(payload, ['estimated_budget', 'budget', 'estimatedBudget']);
  const timeline = pick(payload, ['timeline', 'timeframe', 'time_frame']);
  const company_size = pick(payload, ['company_size', 'companySize', 'employees', 'team_size']);
  const budget = parseBudget(estimated_budget);
  const size = parseCompanySize(company_size);

  const tsRaw = pick(payload, ['timestamp', 'submitted_at', 'created_at', 'date']);
  const tsParsed = tsRaw ? new Date(tsRaw) : null;
  const receivedAt = new Date().toISOString();

  const lead = {
    lead_id: pick(payload, ['lead_id', 'leadId', 'id']) || `L-${Date.now().toString(36).toUpperCase()}-${i + 1}`,
    timestamp: tsParsed && !isNaN(tsParsed) ? tsParsed.toISOString() : receivedAt,
    full_name,
    first_name: nameParts[0] || '',
    last_name: nameParts.slice(1).join(' '),
    email,
    email_valid,
    email_domain,
    free_email_provider: FREE_EMAIL_DOMAINS.includes(email_domain),
    phone,
    phone_normalized,
    phone_valid: phoneDigits.length >= 7,
    company,
    job_title: pick(payload, ['job_title', 'jobTitle', 'title', 'role', 'position']),
    company_size,
    company_size_min: size.min,
    company_size_max: size.max,
    industry: pick(payload, ['industry', 'sector']),
    source: pick(payload, ['source', 'lead_source', 'utm_source']) || (isWebhook ? 'Webhook' : 'Unknown'),
    country: pick(payload, ['country', 'country_name']),
    message: message_clean,
    estimated_budget,
    budget_min: budget.min,
    budget_max: budget.max,
    budget_currency: budget.currency,
    budget_estimate: budget.estimate,
    timeline,
    timeline_days: parseTimelineDays(timeline),
    requested_service: pick(payload, ['requested_service', 'service', 'requestedService', 'interest']),
    website,
    website_domain: toDomain(website),
  };

  // ---------- validation ----------
  const missing_required = [];
  if (!lead.full_name) missing_required.push('full_name');
  if (!lead.email_valid) missing_required.push(lead.email ? 'email (invalid)' : 'email');
  if (!lead.company) missing_required.push('company');
  if (lead.message.length < 10) missing_required.push('message');
  const OPTIONAL = ['phone', 'job_title', 'company_size', 'industry', 'estimated_budget', 'timeline', 'requested_service', 'website', 'country'];
  const missing_optional = OPTIONAL.filter((k) => !lead[k]);

  // ---------- security (untrusted input) ----------
  const scanText = [message, lead.requested_service, lead.full_name, lead.company, lead.job_title].join(' \n ');
  const prompt_injection_suspected = INJECTION_PATTERNS.some((re) => re.test(scanText));
  const markup_detected = MARKUP_PATTERN.test(scanText);
  const urlCount = (message.match(/https?:\/\/|www\./gi) || []).length;
  const securityFlags = [];
  if (prompt_injection_suspected) securityFlags.push('prompt_injection_suspected');
  if (markup_detected) securityFlags.push('html_or_script_markup');
  if (message_truncated) securityFlags.push('message_truncated');

  // ---------- deterministic spam signals (used by both demo and production paths) ----------
  const spamSignals = [];
  const kwHits = SPAM_KEYWORDS.filter((re) => re.test(message + ' ' + lead.requested_service)).length;
  if (kwHits) spamSignals.push(`spam_keywords:${kwHits}`);
  if (urlCount >= 2) spamSignals.push(`links_in_message:${urlCount}`);
  const exclamations = (message.match(/!/g) || []).length;
  if (exclamations >= 3) spamSignals.push(`exclamation_marks:${exclamations}`);
  const letters = message.replace(/[^A-Za-z]/g, '');
  const capsRatio = letters.length ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
  if (letters.length > 20 && capsRatio > 0.3) spamSignals.push('excessive_caps');
  if (DISPOSABLE_EMAIL_DOMAINS.includes(email_domain)) spamSignals.push('disposable_email_domain');
  const spamScore = Math.min(kwHits, 3) + (urlCount >= 2 ? 1 : 0) + (exclamations >= 3 ? 1 : 0) + (letters.length > 20 && capsRatio > 0.3 ? 1 : 0) + (DISPOSABLE_EMAIL_DOMAINS.includes(email_domain) ? 2 : 0);

  out.push({
    json: {
      ...lead,
      validation: {
        is_complete: missing_required.length === 0,
        missing_required,
        missing_optional,
        missing_fields: [...missing_required, ...missing_optional],
      },
      security: {
        prompt_injection_suspected,
        markup_detected,
        message_truncated,
        flags: securityFlags,
        risk_level: prompt_injection_suspected || markup_detected ? 'high' : 'low',
      },
      spam_check: {
        spam_score: spamScore,
        signals: spamSignals,
        likely_spam: spamScore >= 3,
      },
      _meta: {
        entry_channel: isWebhook ? 'webhook' : 'demo',
        batch_index: i,
        received_at: receivedAt,
        normalizer_version: '1.0',
      },
      raw_input: JSON.parse(JSON.stringify(payload)),
    },
    pairedItem: { item: i },
  });
}

return out;
