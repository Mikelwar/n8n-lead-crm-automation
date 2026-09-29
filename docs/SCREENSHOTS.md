# Screenshot Guide

Take the screenshots after a successful **Run Demo** execution (see [SETUP.md](SETUP.md)), so every node on the main path shows its green check and item count.

Save them in `docs/screenshots/` with the file names below. The README already links to `01-workflow-overview.png`.

**General tips**
- Use a 1920×1080 (or larger) browser window, hide the left sidebar, and close the node details panel.
- Light theme usually reads better on Contra and Upwork thumbnails.
- To frame a section, zoom so its coloured sticky fills the screen. `Shift+1` fits the whole workflow.
- Don't show the browser address bar, credentials pages or anything outside this workflow.

---

## 1. Full workflow overview → `01-workflow-overview.png`  ⭐ Primary Contra cover

- Press `Shift+1` (zoom to fit) after a successful demo run.
- It shows all colour-coded sections, the header note ("Demo execution using mock AI responses…"), green execution checks, and the greyed-out red production strips.
- **Use this as the Contra cover image.** It tells the whole story in one frame: intake → scoring → routing → drafts → CRM, with demo and production clearly separated.
- If the text is too small at full zoom, crop to the four coloured sections and leave out the header; the header message then appears in your project description.

## 2. Successful demo execution → `02-demo-execution.png`

- Zoom to the green **Analysis & Scoring** section showing the six route outputs from **Lead Quality Router**. The item counts on each branch (1 HOT, 1 WARM, 1 COLD, 1 SPAM/REJECT, 1 DUPLICATE, 2 NEEDS_REVIEW) prove all 7 leads were processed.
- Optional: include the "Workflow executed successfully" toast.

## 3. Final structured CRM record → `03-crm-record.png`

- Open **Build Final CRM Record** → Output → **Table** view.
- Scroll horizontally so these columns are visible: `lead_id`, `full_name`, `company`, `lead_score`, `lead_category`, `priority`, `sla`, `owner`, `status`, `followup_status`.
- Second option (`03b-crm-record-json.png`): JSON view of the L-1001 record, showing `score_breakdown`, `analysis_summary` and `data_notice`.

## 4. Lead scoring / routing section → `04-scoring-routing.png`

- Open **Score Lead** → Output → JSON, and expand the first item's `scoring.breakdown`:
  `+20 budget fit (strong) | +20 authority level (decision_maker) | …`
- Or open the L-1007 item to show the security override (`-100 malicious / injection attempt` → `override → NEEDS_REVIEW`). It's a strong visual for "safe AI".
- Alternative: the canvas zoomed on **Score Lead → Lead Quality Router → Route ·** nodes with the green sticky's scoring rubric visible.

## 5. Follow-up draft section → `05-followup-draft.png`

- Open **DEMO · Mock Follow-up** → Output → JSON, and expand `followup` for L-1001 (HOT) to show `subject`, `body`, `status: DRAFT_PENDING_REVIEW` and `auto_send: false`.
- Or the purple section on the canvas, where the sticky explains "Drafts are never sent automatically".

## Optional extras

| File | What |
|---|---|
| `06-batch-summary.png` | **Batch Summary** output: counts per route, `ai_calls_attempted: 0`, `emails_sent: 0` |
| `07-config.png` | **Config** node parameters with `config.demo_mode = true` and the model / endpoint fields |
| `08-production-path.png` | A red production strip with the disabled AI HTTP node and its note "Disabled · attach Header Auth credential" |

## Suggested Contra gallery order

1. `01-workflow-overview.png` (cover)
2. `03-crm-record.png`
3. `04-scoring-routing.png`
4. `05-followup-draft.png`
5. `02-demo-execution.png`

Caption for every image: *Demo execution using mock AI responses. Production path is ready for external AI and CRM integrations.*
