"""Run the REAL Legal Preparation agent with the configured model against a live API.

usage: live_preparation.py <apiBase> <workerKey> <runId> <usageOut>
Only LLM provider credentials from the repository .env are loaded into this process.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ALLOWED_PREFIXES = ("LLM7_", "GOOGLE_API_KEY", "GEMINI_API_KEY", "INCEPTION_", "APX_", "LLM_PROVIDER_TIMEOUT", "LLM_MAX_PROVIDER")


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


def _route_legal_preparation_to(route_id: str, model: str | None = None) -> None:
    """Point only the legal-preparation role at ``route_id`` (optionally overriding that
    route's model) through a temporary routes file; the repository config is never changed."""
    import tempfile

    import yaml

    config = yaml.safe_load((ROOT / "deepagents" / "config" / "model_routes.yaml").read_text(encoding="utf-8"))
    if route_id not in config["routes"]:
        raise RuntimeError(f"unknown route {route_id!r}")
    if model:
        config["routes"][route_id]["model"] = model
    config["roles"]["legal-preparation"] = route_id
    target = Path(tempfile.mkdtemp(prefix="lcsp-live-routes-")) / "model_routes.yaml"
    target.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    os.environ["LCSP_MODEL_ROUTES_FILE"] = str(target)


def main() -> int:
    base, key, run_id, usage_out = sys.argv[1:5]
    _load_llm_env()
    if os.environ.get("LCSP_W2_LIVE_ROUTE"):
        _route_legal_preparation_to(os.environ["LCSP_W2_LIVE_ROUTE"], os.environ.get("LCSP_W2_LIVE_MODEL"))

    from langchain_core.callbacks import BaseCallbackHandler
    from legal_preparation.runner import run_legal_preparation
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    class Usage(BaseCallbackHandler):
        def __init__(self) -> None:
            self.calls = 0
            self.input_tokens = 0
            self.output_tokens = 0
            self.tool_calls: list[dict] = []

        def on_tool_start(self, serialized, input_str, **kwargs) -> None:  # noqa: ANN001
            self.tool_calls.append(
                {"tool": (serialized or {}).get("name"), "input": str(input_str)[:140]}
            )

        def on_tool_end(self, output, **kwargs) -> None:  # noqa: ANN001
            if self.tool_calls:
                self.tool_calls[-1]["output"] = str(getattr(output, "content", output))[:200]

        def on_llm_end(self, response, **kwargs) -> None:  # noqa: ANN001
            self.calls += 1
            for generations in response.generations:
                for generation in generations:
                    usage = getattr(getattr(generation, "message", None), "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    self.output_tokens += int(usage.get("output_tokens", 0))

    usage = Usage()
    api = WorkerApiClient(base, key)
    started = time.time()
    # Count tokens from every model call by wrapping the default model's callbacks.
    from legal_preparation.agent import LEGAL_PREPARATION_ROLE
    from model_policy import resolve_role, resolve_agent_model

    config = resolve_role(LEGAL_PREPARATION_ROLE)
    model = resolve_agent_model(LEGAL_PREPARATION_ROLE)
    model.callbacks = [usage]
    result = run_legal_preparation(api, run_id, model=model, recursion_limit=120, callbacks=[usage])
    Path(usage_out).write_text(json.dumps({
        "modelCalls": usage.calls,
        "toolCalls": usage.tool_calls,
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
        "seconds": round(time.time() - started, 1),
        "profileKey": f"{config.provider}:{config.model}",
    }), encoding="utf-8")
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
