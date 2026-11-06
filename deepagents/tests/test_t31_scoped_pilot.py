"""Provider-free tests of the bounded pilot's actual middleware, ledger and native SDK transport."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import stat
import time
from pathlib import Path

import httpx
import pytest
import yaml
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool

from scripts.run_t31_scoped_pilot import (
    LIMITS, MeasuredRunAdmission, PilotInputBoundary, measure_request, preparation_deadline,
    docker_health, summarize_reported_usage, build_budget, runtime_code_digest, select_pilot_routes,
)
from middleware.failure_policy import PaidAdmissionError
from middleware.paid_admission import TokenPolicy, TokenRunBudget, fingerprint, recover_admission, request_identity
from middleware.usage_metering import (
    AgentRoleMiddleware, AgentRunState, UsageMeteringMiddleware, activate_agent_run_state,
)
from middleware.usage_recovery import read_usage_evidence
from model_policy import DEFAULT_ROUTES_FILE, build_model, load_model_routes, model_route_config, resolve_role

SALT = "c" * 64


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(DEFAULT_ROUTES_FILE))
    monkeypatch.setenv("LLM_PROVIDER_TIMEOUT_SECONDS", "45")
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(tmp_path / "usage.sqlite3"))
    for name in ["MIRAI_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "APX_API_KEY"]:
        monkeypatch.setenv(name, "offline-pilot-test-key")
    load_model_routes.cache_clear()
    def blocked(*_args, **_kwargs):
        pytest.fail("Pilot tests must never use real provider networking")
    import anthropic._base_client as anthropic_client
    sdk_httpx = getattr(anthropic_client, "httpx2", None) or getattr(anthropic_client, "httpx")
    for family in {httpx, sdk_httpx}:
        monkeypatch.setattr(family.HTTPTransport, "handle_request", blocked)
        monkeypatch.setattr(family.AsyncHTTPTransport, "handle_async_request", blocked)


def native(route="assessment"):
    return build_model(load_model_routes().config(route))


def state_for(tmp_path, *models, expired=False):
    now = int(time.time())
    policies = tuple(TokenPolicy(**request_identity(model, SALT), valid_from=now - 300,
                     expires_at=now - 1 if expired else now + 180,
                     input_upper_bound=LIMITS["per_attempt_input_upper_bound"],
                     output_upper_bound=LIMITS["per_attempt_output_upper_bound"]) for model in models)
    budget = TokenRunBudget(schema_version=3, run_id="t31-pilot-test", candidate_sha="a" * 40,
        model_routes_sha256=hashlib.sha256(Path(os.environ.get("LCSP_MODEL_ROUTES_FILE") or DEFAULT_ROUTES_FILE).read_bytes()).hexdigest(), credential_salt=SALT,
        valid_from=now - 300, expires_at=now - 1 if expired else now + 180,
        maximum_calls=8, maximum_input_tokens=120000, maximum_output_tokens=16384, policies=policies)
    admission = MeasuredRunAdmission(tmp_path / "usage.sqlite3", budget, fingerprint(budget.model_dump(mode="json")))
    return AgentRunState(run_id=budget.run_id, agent_role="assessment-root",
                         assessment_id="11111111-1111-4111-8111-111111111111", admission=admission, bounded=True)


def request(model, text="PRIVATE_PILOT_PROMPT"):
    return ModelRequest(model=model, messages=[HumanMessage(text)], system_message=SystemMessage("Private instructions"),
                        tools=[], model_settings={})


def response(*, input_tokens=13, output_tokens=3):
    return ModelResponse(result=[AIMessage(content="PRIVATE_PILOT_RESPONSE",
        usage_metadata={"input_tokens": input_tokens, "output_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens})])


def invoke(state, model, handler=None, *, text="PRIVATE_PILOT_PROMPT", role="assessment-root"):
    def measured(req):
        return PilotInputBoundary().wrap_model_call(req, lambda bounded:
            UsageMeteringMiddleware().wrap_model_call(bounded, handler or (lambda _: response())))
    with activate_agent_run_state(state):
        return AgentRoleMiddleware(role).wrap_model_call(request(model, text), measured)


def test_utf8_measurement_covers_system_messages_and_real_tool_schemas():
    def read_selection(path: str) -> str:
        """Read an allowed source path."""
        return path
    model = native()
    req = request(model, "ứng dụng")
    req = req.override(tools=[StructuredTool.from_function(read_selection)])
    measured = measure_request(req)
    assert measured["messageCount"] == 2 and measured["toolCount"] == 1
    assert measured["framingUnits"] == 1024 + 2 * 128 + 256
    assert measured["inputUpperBoundUnits"] == measured["serializedBytes"] + measured["framingUnits"]
    assert "ứng dụng" not in json.dumps(measured)
    assert measured["serializedBytes"] > len("ứng dụng".encode())


def test_real_ledger_records_measurement_before_downstream_provider_handler(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    def downstream(req):
        ledger = recover_admission(state.admission.path, state.run_id)
        assert ledger["admittedAttempts"] == 1
        rows = read_usage_evidence(state.admission.path)
        assert sum(row.get("event") == "INPUT_MEASUREMENT" for row in rows) == 1
        assert any(row.get("attemptStatus") == "STARTED" for row in rows)
        assert req.model_settings["max_tokens"] == 4096
        return response()
    invoke(state, model, downstream)
    ledger = recover_admission(state.admission.path, state.run_id)
    assert ledger["admittedAttempts"] == 1 and ledger["unresolvedAttempts"] == 0
    assert ledger["financialEnforcement"] == "DISABLED"
    assert b"PRIVATE_PILOT_PROMPT" not in state.admission.path.read_bytes()
    assert b"PRIVATE_PILOT_RESPONSE" not in state.admission.path.read_bytes()


def test_missing_measurement_and_oversized_request_fail_before_dispatch(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    with pytest.raises(PaidAdmissionError, match="UNMEASURED_INPUT"):
        state.admission.admit("unmeasured", request_identity(model, SALT))
    assert recover_admission(state.admission.path, state.run_id)["admittedAttempts"] == 0


def test_oversized_utf8_request_never_reaches_physical_handler(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    with pytest.raises(PaidAdmissionError, match="INPUT_BOUND_UNVERIFIED"):
        invoke(state, model, lambda _: pytest.fail("oversized input must not dispatch"), text="a" * 91000)
    assert recover_admission(state.admission.path, state.run_id)["admittedAttempts"] == 0


def test_parent_researcher_and_summary_share_the_eight_attempt_limit(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    for index in range(8):
        invoke(state, model, role=["assessment-root", "repository-researcher", "summary"][index % 3])
    with pytest.raises(PaidAdmissionError, match="CALL_LIMIT"):
        invoke(state, model, lambda _: pytest.fail("ninth attempt must not dispatch"))
    ledger = recover_admission(state.admission.path, state.run_id)
    assert ledger["admittedAttempts"] == 8 and ledger["unresolvedAttempts"] == 0
    assert {json.loads(row["identity"])["agent_role"] for row in ledger["attempts"] if row["state"] != "DENIED"} == {
        "assessment-root", "repository-researcher", "summary",
    }


def test_aggregate_output_limit_stops_the_next_attempt(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    for _ in range(4):
        invoke(state, model, lambda _: response(output_tokens=4096))
    with pytest.raises(PaidAdmissionError, match="OUTPUT_LIMIT"):
        invoke(state, model, lambda _: pytest.fail("aggregate output cap must precede dispatch"))
    assert recover_admission(state.admission.path, state.run_id)["outputExposure"] == 16384


def test_aggregate_input_limit_uses_existing_usage_plus_new_reserved_bound(tmp_path):
    model = native()
    state = state_for(tmp_path, model)
    invoke(state, model, lambda _: response(input_tokens=50000), text="a" * 60000)
    with pytest.raises(PaidAdmissionError, match="INPUT_LIMIT"):
        invoke(state, model, lambda _: pytest.fail("aggregate input cap must precede dispatch"))
    ledger = recover_admission(state.admission.path, state.run_id)
    assert ledger["admittedAttempts"] == 1 and ledger["inputExposure"] == 50000


def test_unknown_attempt_exposure_blocks_fallback_before_another_physical_request(tmp_path):
    from middleware.provider_fallback import ProviderFallbackMiddleware
    first, fallback = native("assessment"), native("primary")
    state = state_for(tmp_path, first, fallback)
    seen = []
    def unanswered(req):
        seen.append(model_route_config(req.model).route_id)
        raise TimeoutError("offline unanswered request")
    def bounded(req):
        return PilotInputBoundary().wrap_model_call(req, lambda measured:
            UsageMeteringMiddleware().wrap_model_call(measured, unanswered))
    with activate_agent_run_state(state), pytest.raises(PaidAdmissionError, match="INPUT_LIMIT"):
        ProviderFallbackMiddleware().wrap_model_call(request(first), bounded)
    ledger = recover_admission(state.admission.path, state.run_id)
    assert len(seen) == 1 and ledger["admittedAttempts"] == 1 and ledger["unresolvedAttempts"] == 1
    assert ledger["inputExposure"] == 90000


def test_expired_work_budget_rejects_before_physical_dispatch(tmp_path):
    model = native()
    state = state_for(tmp_path, model, expired=True)
    with pytest.raises(PaidAdmissionError, match="BUDGET_EXPIRED"):
        invoke(state, model, lambda _: pytest.fail("expired budget must not dispatch"))
    assert recover_admission(state.admission.path, state.run_id)["admittedAttempts"] == 0


@pytest.mark.parametrize("route", ["assessment", "primary", "fallback-01", "fallback-02"])
@pytest.mark.parametrize("asynchronous", [False, True])
def test_real_native_sdk_sends_one_mock_request_with_4096_cap_and_45_second_timeout(tmp_path, route, asynchronous):
    from google import genai
    from google.genai import types
    model = native(route)
    protocol = model_route_config(model).protocol
    if protocol == "anthropic":
        import anthropic._base_client as anthropic_client
        sdk_httpx = getattr(anthropic_client, "httpx2", None) or getattr(anthropic_client, "httpx")
    else:
        sdk_httpx = httpx
    sent = []
    def mock_http(req):
        sent.append((json.loads(req.content), req.extensions.get("timeout", {})))
        return sdk_httpx.Response(503, json={"error": {"code": 503, "message": "offline failure", "type": "api_error"}})
    transport = sdk_httpx.MockTransport(mock_http)
    clients = []
    if protocol == "anthropic":
        sync, async_ = sdk_httpx.Client(transport=transport), sdk_httpx.AsyncClient(transport=transport)
        model._client._client, model._async_client._client = sync, async_
        clients = [sync, async_]
    elif protocol == "openai":
        sync, async_ = sdk_httpx.Client(transport=transport), sdk_httpx.AsyncClient(transport=transport)
        model.root_client._client, model.root_async_client._client = sync, async_
        clients = [sync, async_]
    else:
        model.client = genai.Client(api_key="offline-pilot-test-key", http_options=types.HttpOptions(
            timeout=45000, retry_options=types.HttpRetryOptions(attempts=1),
            client_args={"transport": transport}, async_client_args={"transport": transport}))
    state = state_for(tmp_path, model)
    async def invoke_async():
        async def native_call(req):
            return await req.model.ainvoke(req.messages, **req.model_settings)
        async def metered(req):
            return await UsageMeteringMiddleware().awrap_model_call(req, native_call)
        with activate_agent_run_state(state):
            await PilotInputBoundary().awrap_model_call(request(model), metered)
    try:
        with pytest.raises(Exception):
            if asynchronous:
                asyncio.run(invoke_async())
            else:
                invoke(state, model, lambda req: req.model.invoke(req.messages, **req.model_settings))
        assert len(sent) == 1
        payload, timeout = sent[0]
        assert (payload.get("max_tokens") or payload.get("max_completion_tokens")
                or payload.get("generationConfig", {}).get("maxOutputTokens")) == 4096
        assert timeout["read"] == 45
        ledger = recover_admission(state.admission.path, state.run_id)
        assert ledger["admittedAttempts"] == 1 and ledger["unresolvedAttempts"] == 1
    finally:
        if clients:
            clients[0].close()
            asyncio.run(clients[1].aclose())
        else:
            model.client.close()
            asyncio.run(model.client.aio.aclose())



def test_known_input_usage_includes_cache_and_never_turns_missing_fields_into_zero():
    rows = [
        {"event": "MODEL_ATTEMPT", "attemptStatus": "COMPLETED", "inputTokensIncludingCache": "13", "outputTokens": "3"},
        {"event": "MODEL_ATTEMPT", "attemptStatus": "COMPLETED", "inputTokensIncludingCache": "20", "inputTokens": "7"},
        {"event": "MODEL_ATTEMPT", "attemptStatus": "STARTED"},
    ]
    summary = summarize_reported_usage(rows)
    assert summary["knownInputTokensIncludingCache"] == 33
    assert summary["knownUncachedInputTokens"] == 7
    assert summary["knownOutputTokens"] == 3
    assert summary["incompleteInputUsageCalls"] == 0 and summary["incompleteOutputUsageCalls"] == 1
    unknown = summarize_reported_usage([{"event": "MODEL_ATTEMPT", "attemptStatus": "COMPLETED"}])
    assert unknown["knownInputTokensIncludingCache"] is None and unknown["knownOutputTokens"] is None
    assert unknown["incompleteInputUsageCalls"] == unknown["incompleteOutputUsageCalls"] == 1


@pytest.mark.parametrize("stdout", ['""', "null", "{}", '{"Version":""}'])
def test_docker_exit_zero_with_missing_server_data_is_not_healthy(monkeypatch, stdout):
    from types import SimpleNamespace
    import scripts.run_t31_scoped_pilot as pilot
    def run(args, **_kwargs):
        if args[:3] == ["docker", "context", "show"]:
            return SimpleNamespace(returncode=0, stdout="desktop-linux", stderr="")
        return SimpleNamespace(returncode=0, stdout=stdout, stderr="Cannot connect to the Docker daemon")
    monkeypatch.setattr(pilot.subprocess, "run", run)
    assert docker_health()["healthy"] is False


def test_preparation_deadline_interrupts_before_any_provider_work_and_restores_alarm():
    import signal
    previous = signal.getsignal(signal.SIGALRM)
    with pytest.raises(TimeoutError, match="PILOT_PREPARATION_TIMEOUT"):
        with preparation_deadline(0.02):
            time.sleep(0.1)
    assert signal.getsignal(signal.SIGALRM) is previous
    assert signal.getitimer(signal.ITIMER_REAL)[0] == 0


@pytest.fixture
def isolated_routing_project(monkeypatch, tmp_path):
    import scripts.run_t31_scoped_pilot as pilot
    project = tmp_path / "project"
    source = project / "deepagents/config/model_routes.yaml"
    source.parent.mkdir(parents=True)
    source.write_bytes(DEFAULT_ROUTES_FILE.read_bytes())
    directory = tmp_path / "pilot"
    directory.mkdir(mode=0o700)
    monkeypatch.setattr(pilot, "ROOT", project)
    return source, directory


def test_default_route_selection_keeps_project_bindings_and_creates_no_copy(isolated_routing_project):
    source, directory = isolated_routing_project
    original = source.read_bytes()
    profile = select_pilot_routes(directory)
    data = yaml.safe_load(original)
    assert profile["primaryRoute"] is None and profile["privateCopy"] is False
    assert profile["routesFile"] == str(source)
    assert profile["routesSha256"] == hashlib.sha256(original).hexdigest()
    assert profile["roleBindings"] == {role: data["roles"][role]
        for role in ("assessment-root", "repository-researcher")}
    assert list(directory.iterdir()) == []
    assert source.read_bytes() == original


def test_selected_route_preserves_every_other_binding_and_creates_private_immutable_copy(isolated_routing_project):
    source, directory = isolated_routing_project
    original = source.read_bytes()
    profile = select_pilot_routes(directory, "fallback-01")
    target = Path(profile["routesFile"])
    data, selected = yaml.safe_load(original), yaml.safe_load(target.read_bytes())
    expected = {**data, "roles": {**data["roles"], "assessment-root": "fallback-01",
                                "repository-researcher": "fallback-01"}}
    assert selected == expected
    assert profile["roleBindings"] == {"assessment-root": "fallback-01", "repository-researcher": "fallback-01"}
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert not target.is_symlink() and target.is_file()
    before = target.stat()
    assert select_pilot_routes(directory, "fallback-01") == profile
    after = target.stat()
    assert (before.st_ino, before.st_mtime_ns, before.st_size) == (after.st_ino, after.st_mtime_ns, after.st_size)
    assert source.read_bytes() == original


@pytest.mark.parametrize("route", ["missing-route", "", " fallback-01 "])
def test_primary_route_requires_an_exact_existing_route_without_creating_state(isolated_routing_project, route):
    source, directory = isolated_routing_project
    before = source.read_bytes()
    with pytest.raises(ValueError, match="existing validated route"):
        select_pilot_routes(directory, route)
    assert source.read_bytes() == before and list(directory.iterdir()) == []


@pytest.mark.parametrize("drift", ["copy", "project", "selection", "omitted-selection"])
def test_repeated_selection_rejects_profile_drift_without_overwriting(isolated_routing_project, drift):
    source, directory = isolated_routing_project
    target = Path(select_pilot_routes(directory, "fallback-01")["routesFile"])
    requested = "fallback-01"
    if drift == "copy":
        target.write_bytes(target.read_bytes() + b"\n# altered private copy\n")
    elif drift == "project":
        source.write_bytes(source.read_bytes() + b"\n# changed reviewed source\n")
    elif drift == "selection":
        requested = "assessment"
    else:
        requested = None
    before = target.read_bytes()
    with pytest.raises(ValueError, match="profile"):
        select_pilot_routes(directory, requested)
    assert target.read_bytes() == before


@pytest.mark.parametrize("unsafe", ["symlink", "directory", "fifo", "permissions", "hardlink"])
def test_selected_copy_rejects_unsafe_existing_files(isolated_routing_project, unsafe):
    _, directory = isolated_routing_project
    target = Path(select_pilot_routes(directory, "fallback-01")["routesFile"])
    original = target.read_bytes()
    if unsafe == "permissions":
        target.chmod(0o644)
    elif unsafe == "hardlink":
        os.link(target, directory / "linked-copy.yaml")
    else:
        target.unlink()
        if unsafe == "symlink":
            other = directory / "other.yaml"
            other.write_bytes(original)
            other.chmod(0o600)
            target.symlink_to(other)
        elif unsafe == "directory":
            target.mkdir()
        else:
            os.mkfifo(target, 0o600)
    with pytest.raises(ValueError, match="regular owner-only"):
        select_pilot_routes(directory, "fallback-01")


def test_existing_execution_cannot_select_new_profile_or_modify_previous_state(isolated_routing_project):
    _, directory = isolated_routing_project
    marker, journal = directory / "execution.json", directory / "usage.sqlite3"
    marker.write_text('{"executionId":"retained-failed-run"}')
    journal.write_bytes(b"retained journal evidence")
    before = {p.name: p.read_bytes() for p in directory.iterdir()}
    with pytest.raises(ValueError, match="execution already exists"):
        select_pilot_routes(directory, "fallback-01")
    assert {p.name: p.read_bytes() for p in directory.iterdir()} == before


def test_selected_google_route_binds_real_native_models_and_frozen_budget(monkeypatch, tmp_path):
    original = DEFAULT_ROUTES_FILE.read_bytes()
    profile = select_pilot_routes(tmp_path, "fallback-01")
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", profile["routesFile"])
    load_model_routes.cache_clear()
    models = []
    try:
        for role in ("assessment-root", "repository-researcher"):
            route = resolve_role(role)
            assert (route.route_id, route.provider, route.protocol, route.model) == (
                "fallback-01", "google_genai", "google_genai", "gemini-3.5-flash-lite")
            assert route.fallback_route_ids == ()
            model = build_model(route)
            models.append(model)
            identity = request_identity(model, SALT)
            assert (identity["route_id"], identity["provider"], identity["model"]) == (
                "fallback-01", "google_genai", "gemini-3.5-flash-lite")
        budget = build_budget("selected-route-offline")
        assert budget.model_routes_sha256 == profile["routesSha256"]
        assert {(policy.route_id, policy.provider) for policy in budget.policies} == {
            ("fallback-01", "google_genai")}
        assert (budget.maximum_calls, budget.maximum_input_tokens, budget.maximum_output_tokens) == (8, 120000, 16384)
        assert {(policy.input_upper_bound, policy.output_upper_bound) for policy in budget.policies} == {(90000, 4096)}
        assert DEFAULT_ROUTES_FILE.read_bytes() == original
    finally:
        for model in models:
            model.client.close()
            asyncio.run(model.client.aio.aclose())


def test_runtime_digest_defaults_match_and_selected_copy_bytes_are_bound(monkeypatch, tmp_path):
    default_digest = runtime_code_digest()
    monkeypatch.delenv("LCSP_MODEL_ROUTES_FILE")
    assert runtime_code_digest() == default_digest
    profile = select_pilot_routes(tmp_path, "fallback-01")
    assert runtime_code_digest() == default_digest
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", profile["routesFile"])
    selected_digest = runtime_code_digest()
    assert selected_digest != default_digest
    path = Path(profile["routesFile"])
    path.write_bytes(path.read_bytes() + b"\n# changed after review\n")
    assert runtime_code_digest() != selected_digest


@pytest.mark.parametrize("drift", ["bytes", "missing", "symlink"])
def test_selected_copy_drift_is_denied_by_runtime_admission_before_dispatch(monkeypatch, tmp_path, drift):
    import scripts.run_t31_scoped_pilot as pilot
    profile = select_pilot_routes(tmp_path, "fallback-01")
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", profile["routesFile"])
    load_model_routes.cache_clear()
    model = native("fallback-01")
    state = state_for(tmp_path, model)
    state.admission.runtime_code_sha256 = runtime_code_digest()
    identity = request_identity(model, SALT)
    token = pilot._INPUT_MEASUREMENT.set(measure_request(request(model)))
    target = Path(profile["routesFile"])
    if drift == "bytes":
        target.write_bytes(target.read_bytes() + b"\n# changed after admission was frozen\n")
    elif drift == "missing":
        target.unlink()
    else:
        target.unlink()
        target.symlink_to(DEFAULT_ROUTES_FILE)
    try:
        with pytest.raises(PaidAdmissionError, match="RUNTIME_CODE_CHANGED"):
            state.admission.admit("changed-copy", identity)
        ledger = recover_admission(state.admission.path, state.run_id)
        assert ledger["admittedAttempts"] == 0
        assert ledger["terminalReason"] == "RUNTIME_CODE_CHANGED"
        assert [attempt["state"] for attempt in ledger["attempts"]] == ["DENIED"]
    finally:
        pilot._INPUT_MEASUREMENT.reset(token)
        model.client.close()
        asyncio.run(model.client.aio.aclose())

@pytest.mark.parametrize("drift", ["bytes", "missing"])
def test_root_instruction_drift_is_denied_before_provider_dispatch(monkeypatch, tmp_path, drift):
    import scripts.run_t31_scoped_pilot as pilot

    model = native("fallback-01")
    state = state_for(tmp_path, model)
    state.admission.runtime_code_sha256 = runtime_code_digest()
    identity = request_identity(model, SALT)
    token = pilot._INPUT_MEASUREMENT.set(measure_request(request(model)))
    instructions = pilot.ROOT / "deepagents/assessment_root/instructions.md"
    original_read = Path.read_bytes

    def changed_instruction_bytes(path):
        if path == instructions:
            if drift == "missing":
                raise FileNotFoundError("reviewed Root instructions are unavailable")
            return original_read(path) + b"\\nChanged instruction after review.\\n"
        return original_read(path)

    monkeypatch.setattr(Path, "read_bytes", changed_instruction_bytes)
    try:
        with pytest.raises(PaidAdmissionError, match="RUNTIME_CODE_CHANGED"):
            state.admission.admit("changed-instructions", identity)
        ledger = recover_admission(state.admission.path, state.run_id)
        assert ledger["admittedAttempts"] == 0
        assert ledger["terminalReason"] == "RUNTIME_CODE_CHANGED"
        assert [attempt["state"] for attempt in ledger["attempts"]] == ["DENIED"]
    finally:
        pilot._INPUT_MEASUREMENT.reset(token)
        model.client.close()
        asyncio.run(model.client.aio.aclose())
