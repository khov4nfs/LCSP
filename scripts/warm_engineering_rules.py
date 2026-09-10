#!/usr/bin/env python3
"""Pre-run Legal Rule Triage over a bounded LegalRule scope so rules are READY early.

This drives the same Root Orchestration dispatch the readiness boundary uses, so the
Triage subagent still owns every Candidate/Context/Reject and EngineeringRule decision.
It only moves that work ahead of the first Assessment that would otherwise block on
ENGINEERING_RULE_NOT_READY.

Warm-up never crawls or refreshes official legal sources; it triages the already
approved catalog only. Export the result with export_precompiled_engineering_rules.py
so a cleared cache recovers without re-running the model.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "deepagents"))

from orchestration.dispatcher import RootSubagentDispatcher
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.triage.legal_rule_triage.service import LegalRuleTriageService


WARM_TRIGGER = "SCHEDULED"

INSTRUCTION = (
    "Bounded legal-preparation warm-up. Claim the Triage singleton and triage ONLY the "
    "supplied approved LegalRule scope. Do NOT call maintain_legal_catalog, do not crawl "
    "or refresh official legal sources, and do not broaden scope beyond the supplied rule "
    "IDs. For each ready work item read the exact authoritative legal chunks, apply the "
    "legal-rule-triage skill, decide exactly one verdict per chunk, prepare EngineeringRule "
    "proposals for Candidate chunks only, and persist each fully triaged LegalRule through "
    "persist_legal_rule_triage_result. Keep requesting the next page with the same "
    "triage_execution_id until pendingRuleCount is zero, then call "
    "finish_legal_rule_triage_execution. Use no Assessment or customer context."
)


def approved_rule_ids(limit: int | None) -> list[str]:
    config = load_config()
    api = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    catalog = api.get_active_legal_rule_catalog()
    rule_ids = [
        LegalRuleTriageService._rule_id(rule)
        for rule in (catalog.get("rules") or [])
        if isinstance(rule, dict) and LegalRuleTriageService._is_approved_rule(rule)
    ]
    rule_ids = [value for value in rule_ids if value]
    return rule_ids[:limit] if limit else rule_ids


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument(
        "--legal-rule-id",
        action="append",
        default=[],
        help="Triage exactly these LegalRule IDs (repeatable)",
    )
    scope.add_argument(
        "--limit",
        type=int,
        help="Triage the first N approved LegalRules from the active catalog",
    )
    parser.add_argument(
        "--idempotency-key",
        default=None,
        help="Reuse a key to resume an interrupted warm-up instead of starting fresh",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the scope only")
    args = parser.parse_args()

    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")

    rule_ids = (
        list(dict.fromkeys(args.legal_rule_id))
        if args.legal_rule_id
        else approved_rule_ids(args.limit)
    )
    if not rule_ids:
        raise SystemExit("no approved LegalRules resolved for the requested scope")

    idempotency_key = args.idempotency_key or f"warm-{uuid.uuid4()}"
    if args.dry_run:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "legalRuleIds": rule_ids,
                    "idempotencyKey": idempotency_key,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    result = RootSubagentDispatcher().dispatch(
        subagent_type="triage",
        instruction=INSTRUCTION,
        affected_rule_ids=rule_ids,
        idempotency_key=idempotency_key,
        trigger=WARM_TRIGGER,
        metadata={
            "workflow_run_id": f"triage:{idempotency_key}",
            "node_name": "engineering_rule_warm_up",
            "trigger": WARM_TRIGGER,
        },
        thread_id=f"triage:{idempotency_key}",
        reenter_root=False,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if result.get("status") == "ALREADY_RUNNING":
        print(
            "another Triage execution owns the singleton; rerun with the same "
            f"--idempotency-key {idempotency_key} once it finishes",
            file=sys.stderr,
        )
        return 2
    return 0 if result.get("status") == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
