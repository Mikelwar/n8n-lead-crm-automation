# Architecture

One n8n workflow, 36 functional nodes and 9 sticky notes, arranged in four colour-coded sections plus red production strips.

## Canvas layout

```
┌─ Header: title, honesty note, how to run, colour legend ─────────────────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ 🟦 1 Intake ────────┐┌ 🟩 2 Analysis & Scoring ──────────────────────┐┌ 🟪 3 Follow-up ─────┐┌ 🟧 4 CRM Output ─────┐
│ Run Demo            ││ Check Duplicate → Demo Mode? → Mock Analysis  ││ Needs Follow-up?    ││ Assign Owner         │
│ Load Sample Leads   ││ → Parse & Validate → Score Lead → Router      ││ Demo Mode? → Mock   ││ Build Final Record   │
│ Normalize → Config  ││ → 6 Route nodes → Merge Routes                ││ → Merge Follow-up   ││ Batch Summary        │
│                     ││                                               ││                     ││ Webhook? → Respond   │
└─────────────────────┘└───────────────────────────────────────────────┘└─────────────────────┘└──────────────────────┘
┌ 🟥 Lead Source ─────┐   ┌ 🟥 AI Analysis ──────────┐                   ┌ 🟥 AI Follow-up ──────┐┌ 🟥 CRM & Logging ─────┐
│ Webhook             │   │ Build Request → HTTP     │                   │ Build → HTTP → Parse  ││ Data Table · Sheets   │
└─────────────────────┘   └──────────────────────────┘                   └───────────────────────┘│ HubSpot · Generic API │
                                                                                                  └───────────────────────┘
```

## Node reference

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Run Demo | Manual Trigger | Starts the demo |
| 2 | DEMO · Load Sample Leads | Code | Emits the 7 fictional leads from `test-data/sample-leads.json` |
| 3 | Webhook · Receive Lead | Webhook | Production entry, `POST /webhook/lead-intake`, responds via node |
| 4 | Normalize Lead | Code | Canonical schema, validation, budget/timeline parsing, security + spam signals, raw input kept |
| 5 | Config | Set | `demo_mode`, AI provider/model/endpoint, thresholds, target industries, owner rosters |
| 6 | Check Duplicate | Code | Email or company+last-name match; related-account flag; workflow memory in production |
| 7 | Demo Mode? (Analyze) | IF | `true` → mock, `false` → AI path |
| 8 | DEMO · Mock Lead Analysis | Code | Deterministic "AI-style" analysis, same schema as the AI |
| 9 | AI · Build Analysis Request | Code | Provider-specific request body (Anthropic / OpenAI-compatible) |
| 10 | AI · Analyze Lead | HTTP Request (**disabled**) | Sends the request; Header Auth credential; never throws |
| 11 | Parse & Validate Analysis | Code | Extracts JSON, validates enums, fail-safe, deterministic flags win |
| 12 | Score Lead | Code | Rubric points, penalties, clamp, overrides, breakdown |
| 13 | Lead Quality Router | Switch | 6 outputs; unknown values fall back to NEEDS_REVIEW |
| 14–19 | Route · HOT / WARM / COLD / SPAM / REJECT / DUPLICATE / NEEDS_REVIEW | Set | Stamps priority, SLA, team, CRM status, next action |
| 20 | Merge Routes | Merge (append, 6 inputs) | Re-joins the routes into one stream |
| 21 | Needs Follow-up? | IF | HOT / WARM / COLD with a valid email |
| 22 | Demo Mode? (Follow-up) | IF | `true` → mock, `false` → AI path |
| 23 | DEMO · Mock Follow-up | Code | Template drafts using lead context + placeholders |
| 24 | AI · Build Follow-up Request | Code | Provider-specific request body |
| 25 | AI · Draft Follow-up | HTTP Request (**disabled**) | Sends the request |
| 26 | Parse Follow-up Draft | Code | Same `followup` shape as the mock; failure → no draft |
| 27 | Merge Follow-up | Merge (append) | Leads with and without drafts |
| 28 | Assign Owner | Code | Named owner from roster; duplicates inherit the original owner |
| 29 | Build Final CRM Record | Code | Flat CRM record, draft safety scan, intake order restored |
| 30 | Batch Summary | Code | Counts per route, drafts, AI calls attempted, emails sent (0) |
| 31 | Webhook Request? | IF | Only webhook leads get an HTTP response |
| 32 | Respond to Webhook | Respond to Webhook | Minimal acknowledgement, no internal data |
| 33 | Log · Data Table | Data Table (**disabled**) | Insert row |
| 34 | Log · Google Sheets | Google Sheets (**disabled**) | Append row |
| 35 | CRM · HubSpot Upsert Contact | HubSpot (**disabled**) | Upsert contact by email |
| 36 | CRM · Generic CRM API | HTTP Request (**disabled**) | POST record to any CRM |

## Data contract between stages

Each stage adds a namespaced block and never removes earlier data:

| Added by | Field(s) |
|---|---|
| Normalize Lead | canonical lead fields, `validation`, `security`, `spam_check`, `_meta`, `raw_input` |
| Config | `config` |
| Check Duplicate | `duplicate_check` |
| Mock / AI + Parse & Validate | `analysis`, `analysis_meta` |
| Score Lead | `lead_score`, `lead_temperature`, `lead_category`, `qualification_status`, `requires_followup`, `override_reason`, `recommended_action`, `scoring` |
| Route · * | `routing` |
| Mock / AI follow-up | `followup` |
| Assign Owner | `owner`, `owner_team`, `assignment_method` |
| Build Final CRM Record | flat CRM record (replaces the working object) |

Because the mock and the AI path produce **the same `analysis` and `followup` shapes**, every node after them is shared. Switching to production changes one Config value and never requires rewiring.

## Hybrid scoring: who decides what

| Decision | AI / mock | Deterministic rules |
|---|---|---|
| Dimension ratings (budget fit, authority, need, urgency, fit) | ✅ rates | converts to points |
| Final score | suggests (`ai_suggested_score`) | ✅ decides |
| Spam | may **add** | ✅ keyword/link/caps/disposable-domain signals, cannot be cleared |
| Duplicate | echoes | ✅ decides |
| Prompt injection | may **add** | ✅ pattern detection, cannot be cleared |
| Missing fields | may add | ✅ required-field validation |
| Final route | suggests | ✅ decides (overrides first, then score bands) |
| Recommended action | used when it agrees with the rules | rules' action when they disagree |

## Execution notes

- `executionOrder: v1`. The two Merge nodes join branches so every downstream node runs **once per execution**, verified in the e2e test ("final record node ran exactly once"). With a single webhook lead, the Merges run with the one populated input.
- Disabled nodes pass data through unchanged, so the demo completes with every production node disabled.
- HTTP nodes use `neverError` plus `onError: continueRegularOutput` and 2 retries. Any provider failure becomes data that `Parse & Validate` turns into `NEEDS_REVIEW`.
- Code nodes run in n8n's JS task runner. They use only `$input`, `$()`, `$getWorkflowStaticData` and plain JavaScript, with no external modules.

## Regenerating the workflow

`workflows/ai-lead-crm-automation.json` is generated by `scripts/build-workflow.js` from:

- `code/*.js`: one file per Code node (the header comment names the node)
- `prompts/*.md`: the `## System prompt` block is injected into the request builders
- `test-data/sample-leads.json`: injected into *DEMO · Load Sample Leads*

Node IDs are derived from node names, so rebuilding produces a stable diff.
