#!/bin/sh
# Run from the project root (see docs/SETUP.md > Testing). Requires only Docker and the n8n 2.37.10 image.
# Disposable end-to-end test inside a throwaway n8n 2.37.10 container (--network none).
# Uses a fresh SQLite DB in /tmp; nothing from the live instance is mounted.
export N8N_USER_FOLDER=/tmp/n8n-e2e
export N8N_DIAGNOSTICS_ENABLED=false
export DB_TYPE=sqlite
mkdir -p "$N8N_USER_FOLDER"

node /work/scripts/e2e/make-variants.js /work/workflows/ai-lead-crm-automation.json /tmp || exit 1

for v in demo prod_ai_disabled prod_ai_no_network; do
  echo "=== import $v"
  n8n import:workflow --input=/tmp/wf_$v.json 2>&1 | tail -2
  echo "=== execute $v"
  n8n execute --id="$(node -e "console.log(require('/tmp/wf_$v.json').id)")" --rawOutput > /tmp/out_$v.txt 2>/tmp/err_$v.txt
  echo "exit=$?"
  tail -5 /tmp/err_$v.txt
  node /work/scripts/e2e/verify-e2e.js /tmp/out_$v.txt "$v" /work/test-output || FAILED=1
done
[ -z "$FAILED" ] && echo "E2E: ALL VARIANTS PASSED" || { echo "E2E: FAILURES"; exit 1; }
