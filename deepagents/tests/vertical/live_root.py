"""Live-model Assessment Root eval. Real governed tools/API/checkpoint; synthetic data only."""
from __future__ import annotations

import json
import os
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path
from langchain_core.callbacks import BaseCallbackHandler

from vertical.live_preparation import ROOT, _load_llm_env

MAX_SECONDS, MAX_CALLS, MAX_INPUT_TOKENS = 120, 20, 150_000


class ReviewTrace(BaseCallbackHandler):
    raise_error = True

    def __init__(self):
        self._lock = threading.Lock()
        self.calls, self.attempted_calls, self.input_tokens, self.output_tokens = 0, 0, 0, 0
        self.tools, self.messages, self.model_errors = [], [], []

    def on_chat_model_start(self, serialized, messages, **kwargs):
        with self._lock:
            if self.attempted_calls >= MAX_CALLS:
                raise RuntimeError("W4 eval model-call budget exhausted")
            if self.input_tokens >= MAX_INPUT_TOKENS:
                raise RuntimeError("W4 eval input-token budget exhausted")
            self.attempted_calls += 1

    def on_llm_end(self, response, **kwargs):
        with self._lock:
            self.calls += 1
            for generations in response.generations:
                for generation in generations:
                    message = getattr(generation, "message", None)
                    usage = getattr(message, "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    self.output_tokens += int(usage.get("output_tokens", 0))
                    self.messages.append({"content": getattr(message, "content", ""), "tool_calls": getattr(message, "tool_calls", [])})

    def on_llm_error(self, error, **kwargs):
        self.model_errors.append(type(error).__name__)

    def on_tool_start(self, serialized, input_str, **kwargs):
        self.tools.append({"tool": (serialized or {}).get("name"), "input": str(input_str), "runId": str(kwargs.get("run_id"))})

    def on_tool_end(self, output, **kwargs):
        for entry in reversed(self.tools):
            if entry["runId"] == str(kwargs.get("run_id")):
                content = str(getattr(output, "content", output))
                entry.update(output=content[:12000], outputTruncated=len(content) > 12000)
                break


def evaluation_timeout(_signum, _frame):
    raise TimeoutError("W4 eval exceeded its 120-second Root budget")


def main() -> None:
    base, key, assessment_id, repo_dir, output = sys.argv[1:6]
    _load_llm_env()
    # Optional eval-only route selection. The production route file remains unchanged.
    route = os.environ.get("LCSP_W4_EVAL_ROUTE")
    if route:
        import yaml
        config = yaml.safe_load((ROOT / "deepagents/config/model_routes.yaml").read_text())
        config["roles"]["default"] = route
        config["roles"]["assessment-root"] = route
        config["roles"]["repository-researcher"] = route
        target = Path(tempfile.mkdtemp(prefix="lcsp-w4-eval-route-")) / "routes.yaml"
        target.write_text(yaml.safe_dump(config))
        os.environ["LCSP_MODEL_ROUTES_FILE"] = str(target)
    from deepagents.backends import FilesystemBackend
    from langgraph.checkpoint.postgres import PostgresSaver
    from assessment_root.client import AssessmentRuntimeClient
    from assessment_root.runner import run_assessment_root
    from model_policy import resolve_role, resolve_agent_model

    trace = ReviewTrace()
    config = resolve_role("assessment-root")
    started = time.monotonic()
    with PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
        saver.setup()
        signal.signal(signal.SIGALRM, evaluation_timeout)
        signal.alarm(MAX_SECONDS)
        try:
            result = run_assessment_root(AssessmentRuntimeClient(base, key), assessment_id,
                backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
                model=resolve_agent_model("assessment-root"), checkpointer=saver, governance=(),
                recursion_limit=60, extra_callbacks=[trace])
        finally:
            signal.alarm(0)
    evidence = {"result": result, "model": f"{config.provider}:{config.model}", "calls": trace.calls,
                "inputTokens": trace.input_tokens, "outputTokens": trace.output_tokens,
                "seconds": round(time.monotonic()-started, 2), "tools": trace.tools, "messages": trace.messages,
                "attemptedCalls": trace.attempted_calls, "modelErrors": trace.model_errors,
                "budgets": {"rootSeconds": MAX_SECONDS, "modelCalls": MAX_CALLS, "inputTokens": MAX_INPUT_TOKENS},
                "limitations": "Synthetic fixtures; governance billing middleware excluded; completed provider usage observed by callback; failed-attempt usage may be unavailable."}
    Path(output).write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    print(json.dumps({key: evidence[key] for key in ("result", "model", "calls", "inputTokens", "outputTokens", "seconds")}))


if __name__ == "__main__":
    main()
