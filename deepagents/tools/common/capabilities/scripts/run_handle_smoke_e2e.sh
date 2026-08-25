#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

exec .venv/bin/python -m pytest -q -m e2e tests/test_handle_smoke_e2e.py "$@"
