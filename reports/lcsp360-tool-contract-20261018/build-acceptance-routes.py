"""Derive the acceptance-only route policy for the disposable run from a FRESH readiness probe. Production defaults are never edited.

  deepagents/.venv/bin/python build-acceptance-routes.py PROVIDER_READINESS_final.json

The disposable stack mounts the resulting file and points LCSP_MODEL_ROUTES_FILE at it, so routing, fallback, token rotation and usage
metering all stay the governed ones; only the SET of routes is narrowed. Rules:
  - only routes that are ELIGIBLE in the probe (healthy slot + tool-contract conformance) are approved;
  - routes excluded by policy are never approved, even if healthy (the weak fallback that confounded both earlier live runs);
  - fallback is kept, but only inside the approved set, so a failure can never silently shift acceptance onto an excluded model;
  - no approved route -> decision NOT_READY and NO file is written: the single live allowance stays unused.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "deepagents"))
import model_policy  # noqa: E402

PRODUCTION = ROOT / "deepagents/config/model_routes.yaml"
PREFERENCE = ["primary", "fallback-01"]  # strongest configured route first
EXCLUDED = {"fallback": "google_genai/gemini-3.5-flash-lite is the weak fallback that carried every completion of both earlier live runs; excluded so it cannot confound acceptance"}


def main(readiness_path: Path) -> dict:
    readiness = json.loads(readiness_path.read_text())
    probed = {r["route"]: r for r in readiness["routes"]}
    production = yaml.safe_load(PRODUCTION.read_text())
    approved = [route for route in PREFERENCE if route in production["routes"] and probed.get(route, {}).get("eligible")]
    rejected = {route: ("excluded by policy: " + EXCLUDED[route]) if route in EXCLUDED else ("not eligible in the probe: " + ", ".join(probed.get(route, {}).get("reasons", ["not probed"])))
                for route in production["routes"] if route not in approved}
    decision = {"probedAt": readiness["probedAt"], "decision": "READY" if approved else "NOT_READY", "approvedRoutes": [], "rejectedRoutes": rejected,
                "poolHealth": {r["route"]: {"pool": r.get("pool"), "warnings": r.get("poolWarnings")} for r in readiness["routes"]}, "file": None}
    if approved:
        document = {"version": production["version"], "routes": {route: production["routes"][route] for route in approved},
                    "roles": {role: approved[0] for role in production["roles"]}, "fallbacks": {approved[0]: approved[1:]} if len(approved) > 1 else {}}
        target = HERE / "acceptance-model-routes.yaml"
        target.write_text("# Acceptance-only routes for the disposable run. Derived from a fresh readiness probe; production defaults are untouched.\n" + yaml.safe_dump(document, sort_keys=False))
        previous = os.environ.get(model_policy.ROUTES_FILE_ENV)
        os.environ[model_policy.ROUTES_FILE_ENV] = str(target)
        try:
            model_policy.load_model_routes.cache_clear()
            loaded = model_policy.load_model_routes()  # must satisfy the real validator, fail closed
            assert set(loaded.routes) == set(approved) and all(route == approved[0] for route in loaded.roles.values())
            decision["approvedRoutes"] = sorted(f"{loaded.routes[r]['provider']}/{loaded.routes[r]['model']}" for r in approved)
            decision["routeOrder"] = approved
        finally:
            os.environ.pop(model_policy.ROUTES_FILE_ENV, None) if previous is None else os.environ.__setitem__(model_policy.ROUTES_FILE_ENV, previous)
            model_policy.load_model_routes.cache_clear()
        decision["file"] = {"name": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
    (HERE / "ACCEPTANCE_ROUTES.json").write_text(json.dumps(decision, indent=1) + "\n")
    return decision


if __name__ == "__main__":
    result = main(Path(sys.argv[1]))
    print(json.dumps({k: result[k] for k in ("decision", "approvedRoutes", "rejectedRoutes")}, indent=1))
