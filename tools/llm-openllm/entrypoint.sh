#!/bin/sh
set -e

if [ -z "$OPENLLM_MODEL" ]; then
  echo "OPENLLM_MODEL is not set." >&2
  echo "Set it to a HuggingFace model repo id (e.g. HuggingFaceTB/SmolLM2-1.7B-Instruct) and restart." >&2
  exit 1
fi

exec openllm start "$OPENLLM_MODEL" --port "${PORT:-3000}"
