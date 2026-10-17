"""Bounded readiness probe of each candidate route, built exactly the way production builds it (model_policy.build_model).

  deepagents/.venv/bin/python provider-readiness.py [routes.yaml] [out.json]

Each provider variable holds a POOL of tokens (comma separated); the SDK gets only the first and the governed token-fallback middleware
rotates through the rest on 429/401. So every credential SLOT is probed on its own with one liveness call (reported by safe slot id,
never by key). On the first healthy slot, 3 tool-contract conformance calls run against the REAL author_legal_requirement schema with a
tiny synthetic claim pair (no legal corpus). A route is ELIGIBLE if at least one slot is healthy and the conformance is at least 2 of 3;
refused (401) or rate-limited (429) slots are reported as pool fragility either way. No Preparation is created. Credentials come from the
repository .env, only the four provider variables the disposable stack forwards, and are never printed or written.
"""
import concurrent.futures
import json
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values
from jsonschema import Draft7Validator

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "deepagents"))
for name, value in dotenv_values(ROOT / ".env").items():
    if name in {"APX_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"} and value and name not in os.environ:
        os.environ[name] = value.strip()

import model_policy  # noqa: E402
import provider_credentials  # noqa: E402

CONTRACT = json.loads((HERE / "AUTHORING_TOOL_CONTRACT.json").read_text())
TOOL = next(t for t in CONTRACT["tools"] if t["name"] == "author_legal_requirement")
SCHEMA = {"type": "object", "properties": TOOL["arguments"], "required": TOOL["required"], "additionalProperties": False}
OPERATIVE, SCOPE = "a1" * 32, "b2" * 32
PROMPT = (f"Two claims of a frozen inventory:\nclaimId {OPERATIVE} DUTY: the operator must export a user's personal data on request.\n"
          f"claimId {SCOPE} SCOPE: this applies to operators that process personal data.\n"
          "Call author_legal_requirement with requirement_key R-1 and title 'Export on request'. Put the DUTY claim in operative_claim_ids and the SCOPE claim in "
          "applicability_claim_ids. Use the exact claimIds.")
TIMEOUT = 150


def classify(error: BaseException) -> str:
    text = f"{type(error).__name__} {error}".lower()
    if "429" in text or "ratelimit" in text or "rate limit" in text or "rate_limit" in text:
        return "RATE_LIMITED"
    if "401" in text or "403" in text or "authentication" in text or "permission" in text:
        return "AUTH_FAILED"
    if "timeout" in text or "timed out" in text:
        return "TIMEOUT"
    return "ERROR:" + type(error).__name__


def call(model, messages):
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(model.invoke, messages)
        try:
            return future.result(timeout=TIMEOUT), int((time.monotonic() - started) * 1000), None
        except BaseException as error:  # noqa: BLE001 - the classification IS the result
            return None, int((time.monotonic() - started) * 1000), classify(error)


def usage_of(message) -> dict:
    usage = getattr(message, "usage_metadata", None) or {}
    return {"input": usage.get("input_tokens"), "output": usage.get("output_tokens")}


def liveness(config) -> dict:
    model = model_policy.build_model(config)
    message, ms, error = call(model, "Reply with the single word READY.")
    return {"status": ("OK" if message and "ready" in str(message.content).lower() else "NO_ANSWER") if error is None else error, "ms": ms, "usage": usage_of(message) if message else None}


def conformance(config, rounds: int = 3) -> list[dict]:
    model = model_policy.build_model(config)
    tool = {"type": "function", "function": {"name": "author_legal_requirement", "description": TOOL["description"], "parameters": SCHEMA}}
    tooled = model.bind_tools([tool], tool_choice="author_legal_requirement") if config.provider != "inception" else model.bind_tools([tool])
    out = []
    for _ in range(rounds):
        message, ms, error = call(tooled, PROMPT)
        entry = {"ms": ms, "error": error, "validSchema": False, "rolesCorrect": False, "usage": usage_of(message) if message else None}
        if message is not None and len(message.tool_calls) == 1 and message.tool_calls[0]["name"] == "author_legal_requirement":
            args = message.tool_calls[0]["args"]
            entry["validSchema"] = not list(Draft7Validator(SCHEMA).iter_errors(args))
            entry["rolesCorrect"] = args.get("operative_claim_ids") == [OPERATIVE] and args.get("applicability_claim_ids") == [SCOPE]
        out.append(entry)
        if error in ("RATE_LIMITED", "AUTH_FAILED"):
            break  # a refusal is the answer; do not hammer the slot
    return out


def probe(route_id: str, config) -> dict:
    result = {"route": route_id, "provider": config.provider, "model": config.model, "protocol": config.protocol, "slots": [], "conformance": []}
    source = provider_credentials.provider_token_source(config.provider)
    if source is None:
        result.update(eligible=False, reasons=["NO_CREDENTIAL"], pool={"total": 0})
        return result
    env_name, tokens = source
    original = os.environ.get(env_name)
    try:
        for index, token in enumerate(tokens):
            os.environ[env_name] = token  # the SDK is handed exactly one token, as in production
            slot = {"slot": f"CREDENTIAL_SLOT_{index + 1:02d}", **liveness(config)}
            result["slots"].append(slot)
            if slot["status"] == "OK" and not result["conformance"]:
                result["conformance"] = conformance(config)
                result["conformanceSlot"] = slot["slot"]
    finally:
        os.environ[env_name] = original or ""
    counts = {}
    for slot in result["slots"]:
        counts[slot["status"]] = counts.get(slot["status"], 0) + 1
    conforming = sum(1 for c in result["conformance"] if c["validSchema"] and c["rolesCorrect"])
    reasons = []
    if not counts.get("OK"):
        reasons.append("NO_HEALTHY_CREDENTIAL_SLOT")
    if counts.get("OK") and conforming < 2:
        reasons.append(f"TOOL_CONTRACT_CONFORMANCE_{conforming}_OF_3")
    warnings = [f"{counts[k]} slot(s) {k}" for k in sorted(counts) if k not in ("OK",)]
    result.update(pool={"total": len(tokens), "envVariable": env_name, "byStatus": counts}, conformingCalls=conforming, eligible=not reasons, reasons=reasons, poolWarnings=warnings)
    return result


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        os.environ["LCSP_MODEL_ROUTES_FILE"] = str(Path(sys.argv[1]).resolve())
    model_policy.load_model_routes.cache_clear()
    routes = model_policy.load_model_routes()
    report = {"probedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "routesFile": os.environ.get("LCSP_MODEL_ROUTES_FILE", "production default (config/model_routes.yaml)"),
              "credentialsPresent": sorted(k for k in ("APX_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY") if os.environ.get(k)),
              "routes": [probe(route_id, routes.config(route_id)) for route_id in routes.routes]}
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "PROVIDER_READINESS.json"
    out.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({"credentialsPresent": report["credentialsPresent"], "routes": [{k: r.get(k) for k in ("route", "provider", "model", "eligible", "reasons", "conformingCalls", "pool", "poolWarnings")} for r in report["routes"]]}, indent=1))
