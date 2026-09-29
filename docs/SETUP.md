# Setup

Tested on **n8n 2.37.10** (self-hosted, Docker). No community nodes are required.

## 1. Import the workflow

1. Open your n8n instance (for this project: <http://localhost:6082>).
2. Go to **Overview** and click **Create Workflow** to open an empty workflow.
3. Open the **⋯** menu in the top-right corner of the editor and choose **Import from File…**.
4. Select `workflows/ai-lead-crm-automation.json`.
5. Click **Save**. The workflow is named *AI Lead Qualification & CRM Automation*.

Alternative: open the JSON file in a text editor, copy everything, click on the empty canvas and paste (`Ctrl+V`).

Importing creates **no credentials** and does not publish/activate the workflow.

## 2. Run the demo

1. Click the **Execute workflow** button at the bottom of the canvas.
   The workflow has two triggers (Run Demo and the Webhook). If n8n asks which trigger to use, or the button has a trigger selector, choose **Run Demo**.
   You can also hover over the **Run Demo** node and click its ▶ button.
2. The run takes about a second. All nodes on the main path turn green. The red production nodes stay grey (disabled) or are skipped.
3. Inspect the results:
   - **Build Final CRM Record**: open it and switch the output to **Table** view to see 7 CRM-ready records.
   - **Batch Summary**: counts per route, `ai_calls_attempted: 0`, `emails_sent: 0`.
   - **Score Lead**: `scoring.breakdown` shows exactly how each score was calculated.
   - **DEMO · Mock Follow-up**: the 3 follow-up drafts (HOT, WARM, COLD).

Expected results:

| Lead | Result |
|---|---|
| L-1001 Daniel Okafor | HOT (96) |
| L-1002 Sofia Lindqvist | WARM (74) |
| L-1003 Mark Delaney | COLD (34) |
| L-1004 SEO Expert Team | SPAM |
| L-1005 Dan Okafor | DUPLICATE of L-1001 |
| L-1006 Jordan | NEEDS_REVIEW (INCOMPLETE) |
| L-1007 Chris Morgan | NEEDS_REVIEW (prompt injection) |

## 3. Production setup (optional)

Everything below is optional and can be done in any order. Until the AI nodes are configured, switching `demo_mode` to `false` routes every lead to `NEEDS_REVIEW` (fail-safe).

### 3.1 AI provider

1. **Create a credential:** **Credentials → Add Credential → Header Auth**.
   - Anthropic: Name `x-api-key`, Value = your Anthropic API key.
   - OpenAI-compatible APIs: Name `Authorization`, Value `Bearer <your key>`.
2. **Enable** the nodes **AI · Analyze Lead** and **AI · Draft Follow-up** (select each one and press `D`, or right-click → *Activate*), then select the credential in each.
3. **Config** node:
   - `config.demo_mode` → `false`
   - `config.ai_provider` → `anthropic` or `openai_compatible`
   - `config.ai_model` → default `configurable-claude-model`. For OpenAI-compatible APIs, use your provider's model id.
   - `config.ai_endpoint` → default `https://api.anthropic.com/v1/messages`. OpenAI-compatible: e.g. `https://api.openai.com/v1/chat/completions`.
   - `config.ai_effort` → `low` (Anthropic only; classification rarely needs more)
   - `config.ai_refusal_fallback` → `true` (Anthropic only). If the model declines a request, the API retries it on a fallback model in the same call (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta header). Set it to `false` to turn this off.

On Anthropic the request uses structured outputs (`output_config.format` with a JSON schema), so responses always match the expected schema. Refusals (`stop_reason: "refusal"`), truncation and invalid responses route the lead to `NEEDS_REVIEW`.

The prompts live in `prompts/`. After editing them, rebuild the workflow (see *Rebuilding* below) and re-import it.

### 3.2 Lead source (webhook)

- Endpoint: `POST <your-n8n-url>/webhook/lead-intake` (for example `http://localhost:6082/webhook/lead-intake` once the workflow is published/active; `/webhook-test/lead-intake` while listening in the editor).
- It accepts JSON or form fields, with common aliases such as `name`, `first_name` + `last_name`, `company_name`, `budget` and `comments`.
- The caller receives only `{ "received": true, "lead_id": "...", "message": "..." }`.
- Before exposing it publicly: set **Authentication** on the Webhook node (e.g. Header Auth), and put it behind a reverse proxy with rate limiting.

```bash
curl -X POST http://localhost:6082/webhook-test/lead-intake -H "Content-Type: application/json" -d '{"name":"Test Person","email":"test@company.example","company":"Company Example","message":"We need help automating lead routing into HubSpot.","budget":"$10k","timeline":"next month"}'
```

### 3.3 CRM and logging

Enable only what you need and attach credentials:

| Node | What to configure |
|---|---|
| Log · Data Table | Create an n8n Data Table (e.g. `leads`) and select it |
| Log · Google Sheets | Google credential, spreadsheet and sheet (columns auto-map from the record) |
| CRM · HubSpot Upsert Contact | HubSpot App Token credential; contact is upserted by email |
| CRM · Generic CRM API | Replace the placeholder URL, attach a Header Auth credential |

`raw_input` is an object. Drop or stringify it if your target stores flat columns only.

### 3.4 Duplicate memory

In production (`demo_mode = false`), **Check Duplicate** also remembers earlier leads in the workflow's static data. n8n only persists static data for **production executions of a published workflow**, not for manual runs. For a system of record, extend it with a CRM lookup (see *Future improvements* in the README).

## 4. Testing

The workflow JSON is **generated**. Edit `code/`, `prompts/` or `test-data/`, then rebuild.

### Rebuilding

With Node.js 18+ installed:

```bash
node scripts/build-workflow.js
node scripts/test-offline.js
```

Without Node.js, use the node binary from the n8n image (networking disabled, only project subfolders mounted). PowerShell:

```powershell
docker run --rm --network none -v "${PWD}\code:/work/code:ro" -v "${PWD}\prompts:/work/prompts:ro" -v "${PWD}\test-data:/work/test-data:ro" -v "${PWD}\scripts:/work/scripts:ro" -v "${PWD}\workflows:/work/workflows" -v "${PWD}\test-output:/work/test-output" -w /work --entrypoint sh n8n-ffmpeg:2.37.10 -c "node scripts/build-workflow.js && node scripts/test-offline.js"
```

`test-offline.js` checks the workflow JSON statically (connections, disabled integrations, no credentials or secrets, canvas layout). It then runs the embedded node code in five scenarios: demo, production with AI disabled, production with a network error, a simulated Anthropic response, and a single lead.

### Real n8n end-to-end test

This runs the workflow in a **throwaway n8n 2.37.10 container with networking disabled**. It uses a fresh SQLite database inside the container, so no live instance, volume or credential is touched:

```powershell
docker run --rm --network none -v "${PWD}\scripts:/work/scripts:ro" -v "${PWD}\workflows:/work/workflows:ro" -v "${PWD}\test-output:/work/test-output" --entrypoint sh n8n-ffmpeg:2.37.10 /work/scripts/e2e/run-e2e.sh
```

It imports the workflow with `n8n import:workflow`, executes it with `n8n execute` (which starts from the **Run Demo** manual trigger) and verifies the run data for three variants:

1. `demo`: expected classifications, 3 drafts, zero AI/HTTP nodes executed, Respond to Webhook skipped
2. `prod_ai_disabled`: `demo_mode = false` with AI nodes disabled → every lead `NEEDS_REVIEW`
3. `prod_ai_no_network`: AI HTTP nodes enabled but no credential/network → failure contained, every lead `NEEDS_REVIEW`

Results are written to `test-output/` (git-ignored).
