#!/bin/sh
set -eu

MARKER="/home/node/.n8n/.aspan-workflow-imported-v2"
WORKFLOW="/opt/aspan/aspan_proposal_workflow.json"

if [ ! -f "$MARKER" ]; then
  n8n import:workflow --input="$WORKFLOW"
  touch "$MARKER"
fi

exec n8n start
