"""Sanitized current-account topology and fail-closed proof; no provider networking.

Run with PYTHON_DOTENV_DISABLED=1 PYTHONPATH=deepagents:deepagents/tests.
Loads only the existing live harness's allowed environment variables. Output is
diagnostic evidence, never a production ChargePolicy or spending authorization.
"""
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile


def main(output):
    target = Path(output)
    assert not target.exists(), "Never overwrite an earlier identity snapshot"
    network_attempts = []

    def blocked(*args, **kwargs):
        network_attempts.append(1)
        raise AssertionError("Contract inspection prohibits provider networking")

    # Guard before importing native SDKs or loading any configured credential.
    socket.socket.connect = blocked
    socket.create_connection = blocked
    import httpx
    import anthropic._base_client as anthropic_client
    sdk_http = getattr(anthropic_client, "httpx2", None) or anthropic_client.httpx
    for family in {httpx, sdk_http}:
        family.HTTPTransport.handle_request = blocked
        family.AsyncHTTPTransport.handle_async_request = blocked

    from langchain.agents.middleware.types import ModelRequest
    from langchain_core.messages import HumanMessage
    from middleware.failure_policy import PaidAdmissionError
    from middleware.paid_admission import RunBudget, fingerprint, request_identity
    from middleware.token_fallback import model_with_token
    from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state
    from model_policy import DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV, build_model, load_model_routes
    from provider_credentials import provider_token_source, llm_provider_timeout_seconds
    from vertical.live_preparation import LiveUsage, _load_llm_env

    _load_llm_env()
    routes = load_model_routes()
    config_path = Path(os.environ.get(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
    config_digest = hashlib.sha256(config_path.read_bytes()).hexdigest()
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    salt = secrets.token_hex(32)
    rows, handler_calls = [], []

    def forbidden_handler(request):
        handler_calls.append(1)
        raise AssertionError("Unverified account reached a provider handler")

    with tempfile.TemporaryDirectory(prefix="lcsp360-contract-denial-") as temp:
        for route_id in routes.routes:
            config = routes.config(route_id)
            source = provider_token_source(config.provider)
            if source is None:
                raise RuntimeError(f"Missing configured credentials for route {route_id}; no keys requested")
            model = build_model(config)
            for slot, key in enumerate(source[1], 1):
                bound = model_with_token(model, config.provider, key)
                identity = request_identity(bound, salt)
                run_id = f"offline-contract-denial-{len(rows) + 1}"
                budget = RunBudget(schema_version=2, run_id=run_id, candidate_sha=sha,
                    model_routes_sha256=config_digest, credential_salt=salt,
                    valid_from=1, expires_at=4102444800, maximum_calls=0,
                    maximum_input_tokens=0, maximum_output_tokens=0,
                    maximum_charge_nano_usd=0, policies=())
                state = LiveUsage(run_id, str(Path(temp) / f"{run_id}.json"), budget=budget,
                    budget_fingerprint=fingerprint(budget.model_dump(mode="json")), bounded=True)
                request = ModelRequest(model=bound, messages=[HumanMessage("offline denial only")], tools=[])
                with activate_agent_run_state(state):
                    try:
                        UsageMeteringMiddleware().wrap_model_call(request, forbidden_handler)
                    except PaidAdmissionError as error:
                        assert error.reason == "UNKNOWN_TARIFF", error.reason
                    else:
                        raise AssertionError("Unknown account was admitted")
                rows.append({**identity, "credential_slot": slot, "credential_env_name": source[0],
                    "account_alias": f"UNVERIFIED-{config.provider}-slot-{slot:02}",
                    "account_classification": "UNAVAILABLE_NO_AUTHORIZED_ACCOUNT_RECORDS",
                    "account_or_project_fingerprint": None,
                    "plan_entitlement_topup_overage_tax": None,
                    "production_policy_fingerprint": None,
                    "effective_date": None, "expiration_date": None,
                    "reviewer": "Codex: local identity and public documentation only",
                    "account_contract_review": "PENDING_ACCOUNT_OWNER_AND_INDEPENDENT_REVIEW",
                    "verified_charged_token_buckets": [], "guaranteed_charge_bounds": None,
                    "verified_usd_charge_rules": None,
                    "status": "BLOCKED", "admission": "DENIED_UNKNOWN_TARIFF"})
    assert not network_attempts and not handler_calls
    result = {"schemaVersion": 1, "capturedAt": datetime.now(timezone.utc).isoformat(),
        "reviewedHead": sha, "status": "BLOCKED_EXTERNAL_CONTRACT_EVIDENCE",
        "scope": "Local checkout credentials, not production deployment or verified account ownership",
        "routeConfigSha256": config_digest, "routeConfigIsRepositoryDefault": config_path.resolve() == DEFAULT_ROUTES_FILE.resolve(),
        "credentialSalt": salt, "credentialKdf": "PBKDF2-HMAC-SHA256, 600000 iterations; same admission function",
        "roles": routes.roles, "fallbacks": routes.fallbacks,
        "sdkVersions": {p: version(p) for p in ["langchain-anthropic", "anthropic", sdk_http.__name__,
            "langchain-openai", "openai", "httpx", "langchain-google-genai", "google-genai"]},
        "configuredProviderTimeoutSeconds": llm_provider_timeout_seconds(),
        "bindings": rows, "bindingCount": len(rows),
        "distinctProviderCredentialCount": len({(r["provider"], r["credential_fingerprint"]) for r in rows}),
        "productionPolicies": [], "eligibleRoutes": [], "providerHandlerCalls": len(handler_calls),
        "networkAttempts": len(network_attempts), "paidCalls": 0, "paidTokens": 0, "paidCostUSD": 0,
        "denialOnlyBudgets": "All zero ceilings, no policies, task-owned temporary SQLite; not evaluation runs",
        "accountAccess": "User explicitly confirmed no authorized records/sessions/owner contacts; no billing account accessed"}
    result["snapshotFingerprint"] = fingerprint(result)
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ["status", "bindingCount", "distinctProviderCredentialCount",
        "providerHandlerCalls", "networkAttempts", "snapshotFingerprint"]}))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception as error:
        # SDK validation errors may include constructor arguments containing keys.
        print(json.dumps({"status": "FAILED", "safeErrorType": type(error).__name__}))
        raise SystemExit(1) from None
