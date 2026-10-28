"""Run the genuine Assessment Root agent on a pinned repository and active rule set.

This investigator executes the real Assessment Root Deep Agent graph, tool plane,
FilesystemBackend, and HTTP runtime client using real model reasoning without
hardcoded outcome assertions. The agent inspects the repository files on disk,
cites them via cite_repository_source (which verifies line ranges and
cryptographically hashes them), evaluates applicability conditions, criteria,
and compliance outcomes, and submits evidence-backed rule decisions through
the authoritative Completion Gate.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from vertical.live_preparation import ROOT, _load_llm_env

MAX_SECONDS = int(os.environ.get("LCSP_ASSESSMENT_MAX_SECONDS", "300"))
MAX_CALLS = int(os.environ.get("LCSP_ASSESSMENT_MAX_CALLS", "60"))
MAX_INPUT_TOKENS = int(os.environ.get("LCSP_ASSESSMENT_MAX_INPUT_TOKENS", "6000000"))


class ReviewTrace(BaseCallbackHandler):
    raise_error = True

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.calls, self.attempted_calls, self.input_tokens, self.output_tokens = 0, 0, 0, 0
        self.tools, self.messages, self.model_errors = [], [], []

    def on_chat_model_start(self, serialized: Any, messages: Any, **kwargs: Any) -> None:
        with self._lock:
            if self.attempted_calls >= MAX_CALLS:
                raise RuntimeError("ASSESSMENT investigator model-call budget exhausted")
            if self.input_tokens >= MAX_INPUT_TOKENS:
                raise RuntimeError("ASSESSMENT investigator input-token budget exhausted")
            self.attempted_calls += 1

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        with self._lock:
            self.calls += 1
            for generations in response.generations:
                for generation in generations:
                    message = getattr(generation, "message", None)
                    usage = getattr(message, "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    self.output_tokens += int(usage.get("output_tokens", 0))
                    self.messages.append({
                        "content": getattr(message, "content", ""),
                        "tool_calls": getattr(message, "tool_calls", []),
                    })

    def on_llm_error(self, error: Exception, **kwargs: Any) -> None:
        self.model_errors.append(type(error).__name__)

    def on_tool_start(self, serialized: Any, input_str: Any, **kwargs: Any) -> None:
        self.tools.append({
            "tool": (serialized or {}).get("name"),
            "input": str(input_str),
            "runId": str(kwargs.get("run_id")),
        })

    def on_tool_end(self, output: Any, **kwargs: Any) -> None:
        for entry in reversed(self.tools):
            if entry["runId"] == str(kwargs.get("run_id")):
                content = str(getattr(output, "content", output))
                entry.update(output=content[:12000], outputTruncated=len(content) > 12000)
                break


def evaluation_timeout(_signum: int, _frame: Any) -> None:
    raise TimeoutError("ASSESSMENT investigator exceeded its execution budget")


def main() -> int:
    base = sys.argv[1]
    key = sys.argv[2]
    assessment_id = sys.argv[3]
    repo_dir = sys.argv[4]
    output_file = sys.argv[5] if len(sys.argv) > 5 else None

    _load_llm_env()

    # Model route configuration: default to "preparation" route (Inception mercury-3)
    route = os.environ.get("LCSP_ASSESSMENT_EVAL_ROUTE", "preparation")
    if route:
        import yaml

        config = yaml.safe_load((ROOT / "deepagents/config/model_routes.yaml").read_text(encoding="utf-8"))
        config["roles"]["default"] = route
        config["roles"]["assessment-root"] = route
        config["roles"]["repository-researcher"] = route
        temp_dir = tempfile.mkdtemp(prefix="lcsp-assessment-investigator-route-")
        target = Path(temp_dir) / "routes.yaml"
        target.write_text(yaml.safe_dump(config), encoding="utf-8")
        os.environ["LCSP_MODEL_ROUTES_FILE"] = str(target)

    from deepagents.backends import FilesystemBackend
    from assessment_root.client import AssessmentRuntimeClient
    from assessment_root.runner import run_assessment_root
    from model_policy import resolve_agent_model, resolve_role

    import contextlib

    role_config = resolve_role("assessment-root")
    model = resolve_agent_model("assessment-root")
    client = AssessmentRuntimeClient(base, key)
    trace = ReviewTrace()

    checkpoint_url = os.environ.get("LANGGRAPH_CHECKPOINT_DATABASE_URL")
    if checkpoint_url:
        from langgraph.checkpoint.postgres import PostgresSaver

        checkpoint_cm = PostgresSaver.from_conn_string(checkpoint_url)
    else:
        from langgraph.checkpoint.memory import InMemorySaver

        checkpoint_cm = contextlib.nullcontext(InMemorySaver())

    from langgraph.store.memory import InMemoryStore
    store = InMemoryStore()

    started = time.monotonic()
    signal.signal(signal.SIGALRM, evaluation_timeout)
    signal.alarm(MAX_SECONDS)
    try:
        with checkpoint_cm as checkpointer:
            if hasattr(checkpointer, "setup"):
                checkpointer.setup()
            result = run_assessment_root(
                client,
                assessment_id,
                backend_factory=lambda claim, context: (
                    FilesystemBackend(root_dir=repo_dir, virtual_mode=True),
                    None,
                ),
                model=model,
                checkpointer=checkpointer,
                store=store,
                governance=None,
                extra_callbacks=[trace],
            )
    finally:
        signal.alarm(0)

    elapsed = round(time.monotonic() - started, 2)
    evidence = {
        "result": result,
        "model": f"{role_config.provider}:{role_config.model}",
        "calls": trace.calls,
        "inputTokens": trace.input_tokens,
        "outputTokens": trace.output_tokens,
        "seconds": elapsed,
        "tools": trace.tools,
        "attemptedCalls": trace.attempted_calls,
        "modelErrors": trace.model_errors,
    }

    if output_file:
        Path(output_file).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps({
            "result": result,
            "model": f"{role_config.provider}:{role_config.model}",
            "calls": trace.calls,
            "inputTokens": trace.input_tokens,
            "outputTokens": trace.output_tokens,
            "seconds": elapsed,
            "evidence_records": trace.calls,
        })
    )
    return 0 if result.get("state") == "SUCCEEDED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
