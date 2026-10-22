"""Run the REAL Rule Set Preparation agent with the configured model against a live API.

usage: live_preparation.py <apiBase> <workerKey> <runId> <usageOut>
recovery: live_preparation.py --recover-usage <usageOut> <runId> (no provider calls)
Only LLM provider credentials from the repository .env are loaded into this process.
The adjacent .sqlite3 file is authoritative; JSON totals cover completed responses only.
Canonical input tokens exclude separately reported cache-read/write buckets.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from langchain_core.exceptions import ModelError

from middleware.usage_metering import (
    AgentRunState, activate_agent_run_state, extract_provider_usage,
    provider_identity, provider_usage_telemetry,
)
from middleware.usage_recovery import read_usage_evidence, record_usage_evidence
from middleware.paid_admission import parse_run_budget, RunAdmission, RunBudget, reconcile_admission_evidence
from middleware.failure_policy import PaidAdmissionError

ROOT = Path(__file__).resolve().parents[3]
ALLOWED_PREFIXES = (
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "INCEPTION_",
    "APX_",
    "MIRAI_",
    "ANTHROPIC_",
    "LCSP_",
    "LLM_PROVIDER_TIMEOUT",
    "LLM_MAX_PROVIDER",
)


class LiveUsage(AgentRunState):
    """Use the governed per-response port, including independent Auditor calls."""

    def __init__(self, run_id: str, usage_out: str, *, budget: RunBudget | None = None,
                 budget_fingerprint: str | None = None, bounded: bool = False) -> None:
        super().__init__(run_id=run_id, agent_role="rule-set-preparation", bounded=bounded)
        self.store = Path(usage_out + ".sqlite3")
        if self.store.exists() and any(row.get("runId") != run_id for row in read_usage_evidence(self.store)):
            raise ValueError("Usage evidence does not belong to the requested run")
        if budget is not None:
            if budget.run_id != run_id:
                raise PaidAdmissionError("BUDGET_IDENTITY", run_id)
            if self.store.exists():
                from middleware.paid_admission import parse_run_budget, recover_admission
                if (recover_admission(self.store, run_id)["state"] == "LEGACY_UNBOUNDED"
                        or any(row.get("event") == "MODEL_RESPONSE" for row in read_usage_evidence(self.store))):
                    raise PaidAdmissionError("HISTORICAL_UNRESERVED_USAGE", run_id)
            self.admission = RunAdmission(self.store, budget, budget_fingerprint)
        elif bounded:
            raise PaidAdmissionError("MISSING_RUN_BUDGET", run_id)
        record_usage_evidence(self.store, f"run:{run_id}", {
            "runId": run_id, "event": "RUN_STARTED", "startedAt": time.time(),
        })

    def record(self, response, model, invocation_id, *, agent_role=None) -> None:
        super().record(response, model, invocation_id, agent_role=agent_role)
        provider, model_name = provider_identity(model, response)
        payload = {
            "runId": self.run_id, "invocationId": invocation_id,
            "event": "MODEL_RESPONSE", "agentRole": agent_role or self.agent_role,
            "provider": provider, "model": model_name, "occurredAt": time.time(),
            "usage": extract_provider_usage(response, model),
            "reportedUsage": provider_usage_telemetry(response),
        }
        try:
            record_usage_evidence(self.store, f"invocation:{self.run_id}:{invocation_id}", payload)
        except Exception as error:
            # Replaying an answered model call cannot repair a local evidence write.
            raise ModelError("Durable live usage commit failed; stop without replaying the model") from error


def recover_usage(usage_out: str, run_id: str) -> dict:
    """SQLite is authoritative even when the worker never wrote its final JSON."""
    store = Path(usage_out + ".sqlite3")
    if not store.exists():
        return {"runId": run_id, "accountingState": "UNAVAILABLE", "modelCalls": None,
                "inputTokens": None, "outputTokens": None, "profileKey": None}
    rows = read_usage_evidence(store)
    if not rows or any(row.get("runId") != run_id for row in rows):
        raise ValueError("Usage evidence does not belong to the requested run")
    started = next(row["startedAt"] for row in rows if row["event"] == "RUN_STARTED")
    records = [row for row in rows if row["event"] == "MODEL_RESPONSE"]
    response_ids = {r["invocationId"] for r in records}
    fields = ("inputTokens", "inputTokensIncludingCache", "cachedInputTokens", "cacheWriteTokens", "cacheWrite5mTokens", "cacheWrite1hTokens", "outputTokens", "visibleOutputTokens", "reasoningTokens", "totalTokens", "providerResponseId")
    for row in rows:
        if row.get("event") == "MODEL_ATTEMPT" and row.get("attemptStatus") == "COMPLETED" and row["invocationId"] not in response_ids:
            records.append({**row, "event": "MODEL_RESPONSE", "usage": {k: row[k] for k in fields if k in row} or None,
                "reportedUsage": None, "recoveredFromAttemptCommit": True})
            response_ids.add(row["invocationId"])
    complete = all(row["usage"] is not None and "inputTokens" in row["usage"] and "outputTokens" in row["usage"] for row in records)
    known = [row["usage"] for row in records if row["usage"] is not None]
    profiles = sorted({f"{row['provider']}:{row['model']}" for row in records})
    summary = {
        "runId": run_id, "accountingState": "COMPLETE" if complete else "MISSING_PROVIDER_USAGE",
        "coverage": "physical_attempts" if any(r.get("event") == "MODEL_ATTEMPT" for r in rows) else "completed_provider_responses_only", "modelCalls": len(records),
        "missingUsageCalls": sum(not row["usage"] or "inputTokens" not in row["usage"] or "outputTokens" not in row["usage"] for row in records), "invocations": records,
        "seconds": round(time.time() - started, 1), "profiles": profiles,
        "profileKey": profiles[0] if len(profiles) == 1 else None,
    }
    attempts = {}
    for row in rows:
        if row.get("event") == "MODEL_ATTEMPT":
            previous = attempts.get(row["invocationId"])
            if not previous or previous["attemptStatus"] != "COMPLETED":
                attempts[row["invocationId"]] = row
    summary["physicalAttempts"] = len(attempts) if attempts else None
    summary["successfulResponses"] = len(records)
    summary["unresolvedAttempts"] = sum(r["attemptStatus"] in {"STARTED", "OUTCOME_UNKNOWN"} for r in attempts.values()) if attempts else None
    summary["failedAttempts"] = sum(r["attemptStatus"] == "FAILED" for r in attempts.values()) if attempts else None
    summary["attempts"] = list(attempts.values())
    summary["admission"] = reconcile_admission_evidence(store, run_id, records)
    for field in ("inputTokens", "inputTokensIncludingCache", "outputTokens"):
        summary["known" + field[0].upper() + field[1:]] = sum(int(row[field]) for row in known if field in row)
        summary[field] = summary["known" + field[0].upper() + field[1:]] if len(known) == len(records) and all(field in row for row in known) else None
    for field in ("cachedInputTokens", "cacheWriteTokens", "reasoningTokens", "totalTokens"):
        values = [int(row[field]) for row in known if field in row]
        summary["known" + field[0].upper() + field[1:]] = sum(values) if values else None
        summary[field] = sum(values) if values and len(values) == len(records) else None
    target = Path(usage_out)
    with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, delete=False, encoding="utf-8") as handle:
        json.dump(summary, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(handle.name, target)
    return summary


def _load_llm_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name.startswith(ALLOWED_PREFIXES) and name not in os.environ:
            os.environ[name] = value.strip().strip('"').strip("'")


def _route_rule_set_preparation_to(route_id: str, model: str | None = None) -> None:
    """Point only the rule-set-preparation role at ``route_id`` (optionally overriding that
    route's model) through a temporary routes file; the repository config is never changed."""
    import yaml

    config = yaml.safe_load((ROOT / "deepagents" / "config" / "model_routes.yaml").read_text(encoding="utf-8"))
    if route_id not in config["routes"]:
        raise RuntimeError(f"unknown route {route_id!r}")
    if model:
        config["routes"][route_id]["model"] = model
    config["roles"]["rule-set-preparation"] = route_id
    target = Path(tempfile.mkdtemp(prefix="lcsp-live-routes-")) / "model_routes.yaml"
    target.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    os.environ["LCSP_MODEL_ROUTES_FILE"] = str(target)


def main() -> int:
    if sys.argv[1:2] == ["--recover-usage"]:
        print(json.dumps(recover_usage(*sys.argv[2:4])))
        return 0
    base, key, run_id, usage_out = sys.argv[1:5]
    _load_llm_env()
    if not os.environ.get("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY"):
        os.environ["LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY"] = "7c" * 32
    if os.environ.get("LCSP_RULE_SET_PREPARATION_EVAL_ROUTE"):
        _route_rule_set_preparation_to(os.environ["LCSP_RULE_SET_PREPARATION_EVAL_ROUTE"], os.environ.get("LCSP_RULE_SET_PREPARATION_EVAL_MODEL"))

    from langchain_core.callbacks import BaseCallbackHandler
    from rule_set_preparation.runner import run_rule_set_preparation
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    trace_file = os.environ.get("LCSP_LIVE_TRACE_FILE")

    def trace(event: str, **fields) -> None:
        """One JSON line per model/tool event, written as it happens so a stalled run stays attributable."""
        if trace_file:
            with open(trace_file, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({"at": round(time.time(), 1), "event": event, **fields}) + "\n")

    class Trace(BaseCallbackHandler):
        def __init__(self) -> None:
            self.calls = 0
            self.tool_calls: list[dict] = []

        def on_chat_model_start(self, serialized, messages, **kwargs) -> None:  # noqa: ANN001
            trace("model_start", messages=len(messages[0]) if messages else 0)

        def on_llm_error(self, error, **kwargs) -> None:  # noqa: ANN001
            trace("model_error", error=f"{type(error).__name__}: {str(error)[:300]}")

        def on_tool_start(self, serialized, input_str, **kwargs) -> None:  # noqa: ANN001
            self.tool_calls.append(
                {"tool": (serialized or {}).get("name"), "input": str(input_str)[:1200]}
            )
            trace("tool_start", tool=self.tool_calls[-1]["tool"], input=str(input_str)[:400])

        def on_tool_end(self, output, **kwargs) -> None:  # noqa: ANN001
            if self.tool_calls:
                text = str(getattr(output, "content", output))
                # A rejected call keeps the exact finding (audit gaps, rejection text); passing calls stay short.
                self.tool_calls[-1]["output"] = text[:6000] if '"outcome": "FAILED"' in text[:80] else text[:300]
                trace("tool_end", tool=self.tool_calls[-1]["tool"], output=text[:300])

        def on_llm_end(self, response, **kwargs) -> None:  # noqa: ANN001
            self.calls += 1
            trace("model_end", calls=self.calls)

    trace_callback = Trace()
    budget_path = os.environ.get("LCSP_LIVE_BUDGET_FILE")
    budget = parse_run_budget(json.loads(Path(budget_path).read_bytes())) if budget_path else None
    if budget is not None:
        import subprocess
        if budget.candidate_sha != subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip():
            raise PaidAdmissionError("CANDIDATE_CHANGED", run_id)
    usage = LiveUsage(run_id, usage_out, budget=budget,
                      budget_fingerprint=os.environ.get("LCSP_LIVE_BUDGET_SHA256"), bounded=True)
    api = WorkerApiClient(base, key)
    usage.api_client = api
    usage.preparation_run_id = run_id
    from rule_set_preparation.agent import RULE_SET_PREPARATION_ROLE
    from model_policy import resolve_agent_model

    try:
        with activate_agent_run_state(usage):
            model = resolve_agent_model(RULE_SET_PREPARATION_ROLE)
            result = run_rule_set_preparation(api, run_id, model=model, callbacks=[trace_callback])
    finally:
        recover_usage(usage_out, run_id)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
