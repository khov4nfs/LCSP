"""Prepare an UNAPPROVED token-only envelope; verify native bindings offline.

No billing guarantee, inference authorization or live-run journal is created.
Usage: PYTHON_DOTENV_DISABLED=1 PYTHONPATH=deepagents:deepagents/tests python this.py <prepared-context> <new-output-directory>
"""
import hashlib
import json
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import time


def main(context_file, output):
    target = Path(output)
    target.mkdir(parents=True, exist_ok=False)
    network, dispatches = [], []

    def blocked(*args, **kwargs):
        network.append(1)
        raise AssertionError("Envelope preparation forbids provider networking")

    socket.socket.connect = blocked
    socket.create_connection = blocked
    import httpx
    import anthropic._base_client as anthropic_client
    sdk_http = getattr(anthropic_client, "httpx2", None) or anthropic_client.httpx
    for family in {httpx, sdk_http}:
        family.HTTPTransport.handle_request = blocked
        family.AsyncHTTPTransport.handle_async_request = blocked

    from langchain.agents.middleware.types import ModelRequest, ModelResponse
    from langchain_core.messages import AIMessage, HumanMessage
    from middleware.paid_admission import TokenPolicy, TokenRunBudget, fingerprint, recover_admission, request_identity
    from middleware.token_fallback import model_with_token
    from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state, output_token_limit
    from model_policy import DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV, build_model, load_model_routes
    from provider_credentials import provider_token_source
    from vertical.live_preparation import LiveUsage, _load_llm_env
    import os

    context = json.loads(Path(context_file).read_text())
    assert context["paidCalls"] == 0 and context["executionState"] == "QUEUED"
    _load_llm_env()
    routes = load_model_routes()
    config = Path(os.environ.get(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
    assert config.resolve() == DEFAULT_ROUTES_FILE.resolve()
    salt, now = secrets.token_hex(32), int(time.time())
    policies, models, bindings = [], [], []
    for route_id in routes.routes:
        route = routes.config(route_id)
        source = provider_token_source(route.provider)
        assert source and source[1], "Configured credential pool missing"
        model = build_model(route)
        for slot, key in enumerate(source[1], 1):
            bound = model_with_token(model, route.provider, key)
            identity = request_identity(bound, salt)
            policy = TokenPolicy(**identity, valid_from=now-60, expires_at=now+86400,
                input_upper_bound=1048576, output_upper_bound=output_token_limit(bound))
            policies.append(policy)
            models.append(bound)
            bindings.append({**identity, "credentialSlot": slot, "nativeOutputLimit": policy.output_upper_bound,
                "inputReservationAllowance": policy.input_upper_bound})
    budget = TokenRunBudget(schema_version=3, run_id=context["runId"], candidate_sha=context["candidateSha"],
        model_routes_sha256=hashlib.sha256(config.read_bytes()).hexdigest(), credential_salt=salt,
        valid_from=now-60, expires_at=now+86400, maximum_calls=256, maximum_input_tokens=4000000,
        maximum_output_tokens=256000, policies=tuple(policies))
    # Separate synthetic run: do not admit any attempt against the queued live run.
    diagnostic = budget.model_copy(update={"run_id": "offline-current-binding-verification"})
    with tempfile.TemporaryDirectory(prefix="lcsp360-token-bindings-") as temp:
        state = LiveUsage(diagnostic.run_id, str(Path(temp)/"usage.json"), budget=diagnostic,
            budget_fingerprint=fingerprint(diagnostic.model_dump(mode="json")), bounded=True)
        def handler(request):
            dispatches.append(1)
            return ModelResponse(result=[AIMessage(content="offline", usage_metadata={"input_tokens":2,
                "output_tokens":1,"total_tokens":3,"input_token_details":{"cache_read":0,"cache_creation":0}})])
        with activate_agent_run_state(state):
            for model in models:
                request = ModelRequest(model=model,messages=[HumanMessage("offline binding check")],tools=[])
                UsageMeteringMiddleware().wrap_model_call(request,handler)
        ledger = recover_admission(state.store, diagnostic.run_id)
        assert ledger["admittedAttempts"] == len(models) == len(dispatches)
        assert ledger["unresolvedAttempts"] == 0 and ledger["financialEnforcement"] == "DISABLED"
        assert ledger["inputExposure"] == 2*len(models) and ledger["outputExposure"] == len(models)
    assert not network
    (target/"token-budget.UNAPPROVED.json").write_text(budget.model_dump_json(indent=2)+"\n")
    proof = {"status":"PASS_OFFLINE_BINDINGS_ONLY","candidateSha":context["candidateSha"],
        "preparedContextSha256":hashlib.sha256(Path(context_file).read_bytes()).hexdigest(),
        "budgetFingerprint":fingerprint(budget.model_dump(mode="json")),"budgetApproved":False,
        "runId":context["runId"],"bindings":bindings,"roles":routes.roles,"fallbacks":routes.fallbacks,
        "bindingCount":len(bindings),"distinctCredentials":len({(p.provider,p.credential_fingerprint) for p in policies}),
        "offlineHandlerCalls":len(dispatches),"networkAttempts":len(network),"paidCalls":0,
        "financialEnforcement":"DISABLED","actualProviderChargeGuarantee":False,
        "inputAllowanceBasis":"Technical reservation of 1,048,576 inclusive-input tokens per attempt, covering published context labels of configured models. Not a tokenizer estimate, verified gateway charge bound, or financial guarantee. Unknown usage retains full allowance; reported breach stops the run.",
        "providerAvailability":"Native construction and credentials present only; endpoint acceptance/quota not probed",
        "authorization":"ABSENT; no authorization file generated; all proposed limits remain unapproved"}
    (target/"binding-readiness.json").write_text(json.dumps(proof,indent=2)+"\n")
    print(json.dumps({k:proof[k] for k in ["status","candidateSha","bindingCount","distinctCredentials","offlineHandlerCalls","networkAttempts","paidCalls","budgetFingerprint"]}))


if __name__ == "__main__":
    try:
        main(*sys.argv[1:])
    except Exception as error:
        print(json.dumps({"status":"FAIL","safeErrorType":type(error).__name__}))
        raise SystemExit(1) from None
