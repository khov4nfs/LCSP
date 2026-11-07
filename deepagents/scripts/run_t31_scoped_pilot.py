#!/usr/bin/env python3
"""Bounded T31 pilot using the production Root, Docker source view and complete governance.

Default invocation is a no-provider preflight. Explicit --dispatch requires a prepared,
fresh isolated customer assessment; it never resumes the historical T31 assessment.
The operator scenario, answer contract and gold outcomes are not inputs to this program.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deepagents"))

from langchain.agents.middleware import AgentMiddleware
from langchain_core.utils.function_calling import convert_to_openai_tool

from middleware.failure_policy import PaidAdmissionError
from middleware.paid_admission import (
    RunAdmission, TokenPolicy, TokenRunBudget, fingerprint, recover_admission, request_identity,
)
from middleware.usage_metering import (
    AgentRoleMiddleware, AgentRunState, active_agent_role, active_agent_run_state, activate_agent_run_state,
)
from middleware.usage_recovery import read_usage_evidence, record_usage_evidence

REPOSITORY = "tkhudson/AI-Powered-Customer-Support-Chatbot"
COMMIT = "65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b"
SOURCE_PREFIX = "tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot"
BASELINE = "97004ff3-9240-4e37-8a94-9ade8832c00a"
BASELINE_DIGEST = "f06180635588eb5c026a3dc2e9d3c4da1c3c92853258bb8463f2b52c2478d1ce"
HISTORICAL_ASSESSMENT = "5ec45c57-3625-4368-bedc-22824a396e5e"
LIMITS = {"maximum_calls": 8, "maximum_input_tokens": 120000, "maximum_output_tokens": 16384,
          "per_attempt_input_upper_bound": 90000, "per_attempt_output_upper_bound": 4096,
          "model_work_deadline_seconds": 180, "preparation_timeout_seconds": 600, "provider_read_timeout_seconds": 45}
_INPUT_MEASUREMENT: ContextVar[dict | None] = ContextVar("t31_measured_input", default=None)


def measure_request(request) -> dict:
    """Business purpose: Bound text input before any physical provider attempt is reserved.

    Business rules:
    - Measure actual messages, system text and tool schemas after governance transformations.
    - UTF-8 bytes plus explicit message/tool framing are conservative input units, not reported provider tokens.
    - Unsupported multimodal or response-format input fails closed rather than receiving a guessed bound.

    Execution flow:
    1. Serialize every textual message and actual tool schema without saving their content.
    2. Add 1,024 fixed, 128 per-message and 256 per-tool framing units.
    3. Return only byte counts, conservative units and the active route fingerprint.

    Failure cases:
    - Unobservable message/tool payloads or unsupported content raise before dispatch.

    Side effects:
    - Pure in-memory measurement; never persists prompts, tool bodies or customer source.
    """
    from model_policy import model_route_config
    from middleware.paid_admission import route_fingerprint

    messages = ([request.system_message] if getattr(request, "system_message", None) else []) + list(request.messages)
    payloads = []
    for message in messages:
        if not hasattr(message, "model_dump"):
            raise ValueError("unobservable message serialization")
        content = message.content
        if not isinstance(content, str) and not (
            isinstance(content, list) and all(isinstance(block, str) or
                (isinstance(block, dict) and block.get("type") == "text") for block in content)
        ):
            raise ValueError("unsupported non-text request content")
        payloads.append(message.model_dump(mode="json"))
    if getattr(request, "response_format", None) is not None:
        raise ValueError("unobservable response format")
    tools = [convert_to_openai_tool(tool) for tool in request.tools]
    payload = {"messages": payloads, "tools": tools, "tool_choice": getattr(request, "tool_choice", None)}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    route = model_route_config(request.model)
    if route is None:
        raise ValueError("unbound model route")
    overhead = 1024 + 128 * len(messages) + 256 * len(tools)
    return {"method": "UTF8_BYTES_PLUS_CONSERVATIVE_FRAMING_V1", "serializedBytes": len(encoded),
            "framingUnits": overhead, "inputUpperBoundUnits": len(encoded) + overhead,
            "messageCount": len(messages), "toolCount": len(tools), "routeFingerprint": route_fingerprint(route)}


class MeasuredRunAdmission(RunAdmission):
    def admit(self, attempt_id, identity, *, reason=None):
        """Business purpose: Require measured request input at the durable physical-attempt boundary.

        Business rules:
        - Every Root, researcher, summary and fallback attempt shares this unchanged admission ledger.
        - A missing/mismatched measurement or an input above the pinned per-attempt bound denies dispatch.
        - Reserved exposure remains conservative; provider-reported settlement is kept distinct.
        - Reviewed runtime bytes and any selected private route copy must still match before dispatch.

        Execution flow:
        1. Match the current measurement to the actual native route and frozen policy.
        2. Reserve or deny through the production RunAdmission transaction.
        3. Durably attach numeric measurement evidence before the provider may run.

        Failure cases:
        - Missing input, exceeded bounds, expired budgets or journal failure prevent dispatch.

        Side effects:
        - Writes only numeric measurement and admission evidence; no prompt or source content is stored.
        """
        measurement = _INPUT_MEASUREMENT.get()
        if getattr(self, "runtime_code_sha256", None):
            try:
                unchanged = runtime_code_digest() == self.runtime_code_sha256
            except (OSError, ValueError):
                unchanged = False
            if not unchanged:
                reason = reason or "RUNTIME_CODE_CHANGED"
        policy = next((item for item in self.budget.policies if
                       (item.route_id, item.credential_fingerprint) ==
                       (identity.get("route_id"), identity.get("credential_fingerprint"))), None)
        if not measurement or measurement.get("routeFingerprint") != identity.get("route_fingerprint"):
            reason = reason or "UNMEASURED_INPUT"
        elif policy and measurement["inputUpperBoundUnits"] > policy.input_upper_bound:
            reason = reason or "INPUT_BOUND_UNVERIFIED"
        accepted = super().admit(attempt_id, identity, reason=reason)
        record_usage_evidence(self.path, f"input-bound:{self.run_id}:{attempt_id}", {
            "event": "INPUT_MEASUREMENT", "runId": self.run_id, "invocationId": attempt_id, **measurement,
        })
        return accepted


class PilotInputBoundary(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        """Business purpose: Measure and cap each physical request while retaining all production governance.

        Business rules:
        - This boundary runs inside fallback/key rotation and immediately outside production usage metering.
        - Only the approved output cap is added; the configured model, endpoint and credentials remain unchanged.
        - Missing admission or unobservable input is a terminal denial before any provider call.

        Execution flow:
        1. Bind the active measured admission and the protocol's native output cap.
        2. Measure the transformed request and activate that proof for production admission.
        3. Invoke the next governed boundary and restore the measurement scope.

        Failure cases:
        - Invalid input or missing admission raises PaidAdmissionError and cannot call the downstream handler.

        Side effects:
        - May journal a denial; the downstream metering boundary alone authorizes provider dispatch.
        """
        from middleware.token_fallback import model_protocol

        state = active_agent_run_state()
        if state is None or not isinstance(state.admission, MeasuredRunAdmission):
            raise PaidAdmissionError("MISSING_MEASURED_RUN_BUDGET", state.run_id if state else "unknown")
        protocol = model_protocol(request.model)
        parameter = "max_output_tokens" if protocol == "google_genai" else "max_tokens"
        settings = dict(getattr(request, "model_settings", None) or {})
        for key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
            settings.pop(key, None)
        settings[parameter] = LIMITS["per_attempt_output_upper_bound"]
        request = request.override(model_settings=settings)
        try:
            measurement = measure_request(request)
        except (TypeError, ValueError, AttributeError):
            identity = request_identity(request.model, state.admission.budget.credential_salt)
            identity["agent_role"] = active_agent_role() or state.agent_role
            state.admission.admit(str(uuid4()), identity, reason="UNOBSERVABLE_INPUT")
            raise AssertionError("unobservable input cannot be admitted")
        token = _INPUT_MEASUREMENT.set(measurement)
        try:
            return handler(request)
        finally:
            _INPUT_MEASUREMENT.reset(token)

    async def awrap_model_call(self, request, handler):
        """Business purpose: Apply the same input proof and native cap to asynchronous governed attempts.

        Business rules:
        - Async dispatch must pass the same measurement and durable admission as synchronous dispatch.

        Execution flow:
        1. Use the synchronous preparation boundary to capture the prepared request and its proof.
        2. Activate that proof while awaiting the actual asynchronous governed handler.

        Failure cases:
        - Preparation or admission errors propagate without bypassing the provider boundary.

        Side effects:
        - Temporarily activates numeric measurement context; downstream metering owns provider dispatch.
        """
        prepared = []
        self.wrap_model_call(request, lambda bound: prepared.append((bound, _INPUT_MEASUREMENT.get())))
        bound, measurement = prepared[0]
        token = _INPUT_MEASUREMENT.set(measurement)
        try:
            return await handler(bound)
        finally:
            _INPUT_MEASUREMENT.reset(token)


def build_budget(run_id: str, *, now: int | None = None) -> TokenRunBudget:
    """Business purpose: Freeze current configured routing and technical limits for one fresh execution.

    Business rules:
    - Include existing Root/researcher fallback routes and credential slots without revealing any credential.
    - Native SDK retry identities must already prove one physical request; no financial tariff is invented.
    - Candidate HEAD is accompanied by a working-source digest because this pilot may test uncommitted fixes.

    Execution flow:
    1. Resolve current native models and salted account/endpoint/SDK identities without inference.
    2. Freeze per-attempt policies and the approved aggregate attempt/token/deadline ceilings.

    Failure cases:
    - Unobservable routes, credentials or hidden SDK retries reject budget creation.

    Side effects:
    - Constructs native clients and reads local configuration; performs no provider request or database mutation.
    """
    from model_policy import DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV, build_model, fallback_routes, resolve_role
    from middleware.token_fallback import model_with_token
    from provider_credentials import provider_token_source

    now = int(time.time()) if now is None else now
    salt, identities = secrets.token_hex(32), {}
    routes = {}
    for role in ("assessment-root", "repository-researcher"):
        for route in (resolve_role(role), *fallback_routes(role)):
            routes[route.route_id] = route
    for route in routes.values():
        model = build_model(route)
        pool = provider_token_source(route.provider)
        models = [model_with_token(model, route.provider, value) for value in pool[1]] if pool else [model]
        for native in models:
            identity = request_identity(native, salt)
            identities[(identity["route_id"], identity["credential_fingerprint"])] = identity
    policies = tuple(TokenPolicy(**identity, valid_from=now - 1, expires_at=now + LIMITS["model_work_deadline_seconds"],
                                input_upper_bound=LIMITS["per_attempt_input_upper_bound"],
                                output_upper_bound=LIMITS["per_attempt_output_upper_bound"])
                     for identity in identities.values())
    routes_path = Path(os.environ.get(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
    return TokenRunBudget(
        schema_version=3, run_id=run_id,
        candidate_sha=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        model_routes_sha256=hashlib.sha256(routes_path.read_bytes()).hexdigest(), credential_salt=salt,
        valid_from=now - 1, expires_at=now + LIMITS["model_work_deadline_seconds"],
        maximum_calls=LIMITS["maximum_calls"], maximum_input_tokens=LIMITS["maximum_input_tokens"],
        maximum_output_tokens=LIMITS["maximum_output_tokens"], policies=policies,
    )


def runtime_code_digest() -> str:
    """Business purpose: Identify the actual uncommitted runtime and built API bytes reviewed for this pilot.

    Business rules:
    - Include executed Python, the Root instruction file, routing configuration, built API and contracts; exclude reports and private state.
    - A Git HEAD alone cannot identify an uncommitted working-tree pilot.
    - An explicitly selected private route file adds its path and exact bytes to the reviewed digest.

    Execution flow:
    1. Enumerate the fixed runtime source/build roots and canonical relative paths.
    2. Hash each path and its content into one deterministic source manifest digest.

    Failure cases:
    - Missing required runtime roots, unreadable code or an unsafe selected route copy fails preflight.

    Side effects:
    - Read-only code hashing; does not disclose source content or modify the checkout.
    """
    roots = ["deepagents/assessment_root", "deepagents/middleware", "deepagents/orchestration",
             "deepagents/tools/common", "deepagents/config", "apps/api/dist", "packages/contracts/dist"]
    singles = ["deepagents/model_policy.py", "deepagents/provider_credentials.py",
               "deepagents/assessment_root/instructions.md", "deepagents/scripts/run_t31_scoped_pilot.py",
               "deepagents/scripts/t31_native_runtime.py"]
    paths = set()
    for name in roots:
        base = ROOT / name
        if not base.is_dir():
            raise ValueError("required built runtime is unavailable")
        paths.update(path for path in base.rglob("*") if path.is_file() and path.suffix in {".py", ".js", ".json", ".yaml"})
    paths.update(ROOT / name for name in singles)
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.relative_to(ROOT).as_posix().encode() + b"\x00")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    default_routes = ROOT / "deepagents/config/model_routes.yaml"
    selected_routes = Path(os.environ.get("LCSP_MODEL_ROUTES_FILE") or default_routes)
    if selected_routes.absolute() != default_routes.absolute():
        selected_bytes = _read_private_routes(selected_routes)
        digest.update(b"pilot-selected-model-routes\x00")
        digest.update(str(selected_routes.absolute()).encode() + b"\x00")
        digest.update(hashlib.sha256(selected_bytes).digest())
    return digest.hexdigest()


def private_json(path: Path, value: dict, *, create_only: bool = False) -> None:
    """Business purpose: Persist a private receipt without overwriting another operator's state.

    Business rules:
    - Regular owner-only files with one link are required; symlinks and special files fail closed.
    - Execution and dispatch markers are create-only and cannot reset a retained attempt.
    Execution flow:
    1. Open safely, verify the actual inode, then write and fsync the complete JSON receipt.
    Failure cases:
    - Unsafe permissions, an existing create-only target or filesystem failure propagates.
    Side effects:
    - Writes one private receipt; performs no network action and never truncates an unsafe target.
    """
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
    if create_only:
        flags |= os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        metadata = os.fstat(handle.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077
                or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1):
            raise ValueError("private receipt must be a regular owner-only file")
        handle.truncate(0)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def _read_private_routes(path: Path) -> bytes:
    """Business purpose: Read a pinned pilot route copy without following a substituted file.

    Business rules:
    - The copy must be one regular, owner-only file owned by the operator; symlinks and hard links are rejected.

    Execution flow:
    1. Open without following symlinks or waiting on special files.
    2. Verify the opened inode and return its bytes.

    Failure cases:
    - Missing, linked, nonregular or broadly readable files fail before provider admission.

    Side effects:
    - Reads only the selected local file; performs no write or provider call.
    """
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as handle:
            metadata = os.fstat(handle.fileno())
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077
                    or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1):
                raise ValueError("pilot routes must be a regular owner-only unlinked file")
            return handle.read()
    except OSError:
        raise ValueError("pilot routes must be a regular owner-only non-symlink file") from None


def select_pilot_routes(directory: Path, primary_route: str | None = None) -> dict:
    """Business purpose: Select an existing model route for one fresh pilot without editing project routing.

    Business rules:
    - No selection preserves project routing; an explicit route must already exist in the validated project file.
    - Only assessment-root and repository-researcher bindings change; definitions, options, other roles and fallback chains remain identical.
    - A private copy is create-only and must match exactly on repeated preflight/dispatch; existing executions cannot select a new profile.

    Execution flow:
    1. Validate project routing and resolve the explicit route when supplied.
    2. Derive a credential-free copy with source-digest metadata and the two selected role bindings.
    3. Create an owner-only copy once or verify its exact existing bytes, then report non-secret routing metadata.

    Failure cases:
    - A route ID absent from project routing, changed copy bytes, an existing execution or an unsafe file rejects selection without overwriting state.

    Side effects:
    - Explicit selection creates one private routing YAML in the fresh pilot directory; never changes project routing or calls a provider.
    """
    import yaml
    from model_routes_config import _UniqueKeyLoader, parse_model_routes
    from provider_credentials import PROVIDER_KEY_ENV

    source = ROOT / "deepagents/config/model_routes.yaml"
    source_bytes = source.read_bytes()
    source_text = source_bytes.decode("utf-8")
    routes, roles, fallbacks = parse_model_routes(source_text, tuple(PROVIDER_KEY_ENV))
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    target = directory / "pilot-model-routes.yaml"
    if primary_route is None:
        if target.exists() or target.is_symlink():
            raise ValueError("pilot route profile already selected; repeat --primary-route")
        selected = source
        selected_bytes = source_bytes
    else:
        if primary_route not in routes:
            raise ValueError("pilot primary route must reference an existing validated route")
        marker = directory / "execution.json"
        if marker.exists() or marker.is_symlink():
            raise ValueError("pilot execution already exists; cannot change its route profile")
        data = yaml.load(source_text, Loader=_UniqueKeyLoader)
        data["roles"] = {**data["roles"], "assessment-root": primary_route,
                         "repository-researcher": primary_route}
        metadata = {"primaryRoute": primary_route, "projectRoutesSha256": source_sha256}
        selected_bytes = ("# T31 pilot routing " + json.dumps(metadata, sort_keys=True) + "\n"
                          + yaml.safe_dump(data, allow_unicode=True, sort_keys=False)).encode("utf-8")
        selected_routes, selected_roles, selected_fallbacks = parse_model_routes(
            selected_bytes.decode("utf-8"), tuple(PROVIDER_KEY_ENV))
        if selected_routes != routes or selected_fallbacks != fallbacks:
            raise ValueError("pilot routing must preserve project route definitions and fallbacks")
        roles = selected_roles
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            if _read_private_routes(target) != selected_bytes:
                raise ValueError("pilot route profile changed; existing copy is immutable")
        else:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(selected_bytes)
                handle.flush()
                os.fsync(handle.fileno())
        if _read_private_routes(target) != selected_bytes:
            raise ValueError("pilot route profile changed during preparation")
        selected = target
    return {"primaryRoute": primary_route, "routesFile": str(selected),
            "routesSha256": hashlib.sha256(selected_bytes).hexdigest(),
            "projectRoutesSha256": source_sha256, "privateCopy": primary_route is not None,
            "roleBindings": {role: roles.get(role, roles["default"])
                             for role in ("assessment-root", "repository-researcher")}}


def canonical_audit_membership(rows: list[dict]) -> list[list[str]]:
    """Business purpose: Verify the exact full243 pinned rule membership.

    Business rules:
    - Every identity and version is explicit; duplicates, blanks and partial catalogs are invalid.
    Execution flow:
    1. Validate all243 rows and sort their identity/version pairs for the frozen digest.
    Failure cases:
    - Malformed or incomplete membership raises before any provider admission.
    Side effects:
    - Pure validation; writes no state and exposes no customer source.
    """
    if not isinstance(rows, list) or len(rows) != 243:
        raise ValueError("frozen full243 audit membership required")
    pairs = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid audit member")
        pair = [row.get("assessmentRuleId"), row.get("assessmentRuleVersion")]
        if not all(isinstance(value, str) and value.strip() == value and value for value in pair):
            raise ValueError("invalid audit identity or version")
        pairs.append(pair)
    if len({row[0] for row in pairs}) != 243:
        raise ValueError("duplicate audit identity")
    return sorted(pairs)


def validate_prepared_runtime(runtime: dict) -> None:
    """Business purpose: Bind a new pilot to explicit customer intent and native transport.

    Business rules:
    - V2 manifests carry the full243 audit, frozen source/baseline and canonical persisted command.
    - Historical assessments, remote endpoints and unauthenticated owner reads are forbidden.
    Execution flow:
    1. Validate source, database, loopback and UUID bindings.
    2. Verify exact audit membership/digest and the canonical start command.
    Failure cases:
    - Any missing or changed binding stops before native server startup or provider admission.
    Side effects:
    - Pure validation of private preparation data.
    """
    if runtime.get("manifestVersion") != "T31_SCOPED_PILOT_RUNTIME_V2":
        raise ValueError("fresh V2 native pilot preparation required; old ledgers cannot be reused")
    api, agent = urlsplit(runtime["apiBase"]), urlsplit(runtime["agentBase"])
    for endpoint in (api, agent):
        if (endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1"
                or not endpoint.port or endpoint.port < 1024 or endpoint.username or endpoint.password
                or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment):
            raise ValueError("pilot API and native server require separate private loopback HTTP ports")
    if agent.port == api.port:
        raise ValueError("native server cannot share the API port")
    checkpoint = urlsplit(runtime["checkpointDatabaseUrl"])
    if (checkpoint.scheme not in {"postgresql", "postgres"}
            or checkpoint.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not checkpoint.path.startswith("/lcsp_assessment_t31_")):
        raise ValueError("pilot checkpoint database must be a uniquely prepared loopback database")
    expected = {"repositoryFullName": REPOSITORY, "repositoryCommit": COMMIT,
                "sourcePathPrefix": SOURCE_PREFIX, "ruleSetVersionId": BASELINE,
                "ruleSetDigest": BASELINE_DIGEST, "auditScopeMode": "FULL_RULE_SET",
                "auditRequestRevision": 1}
    if any(runtime.get(key) != value for key, value in expected.items()):
        raise ValueError("prepared source or full audit binding changed")
    for name in ("assessmentId", "repositorySnapshotId", "repositoryScanJobId", "auditRequestId"):
        value = runtime.get(name)
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError("fresh canonical assessment and audit UUIDs required")
    if runtime["assessmentId"] == HISTORICAL_ASSESSMENT:
        raise ValueError("historical assessment is forbidden")
    pairs = canonical_audit_membership(runtime.get("auditRules"))
    digest = hashlib.sha256(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    if digest != runtime.get("auditMembershipSha256"):
        raise ValueError("frozen audit membership digest changed")
    command = runtime.get("rootCommandPayload")
    key = "rule-audit:" + runtime["auditRequestId"] + ":start"
    if (not isinstance(command, dict) or runtime.get("rootCommandKey") != key
            or not isinstance(runtime.get("rootCommandId"), str) or not runtime["rootCommandId"]
            or command.get("idempotencyKey") != key
            or command.get("assessmentId") != runtime["assessmentId"]
            or command.get("auditRequestId") != runtime["auditRequestId"]):
        raise ValueError("exact persisted canonical audit command required")
    if not all(isinstance(runtime.get(key), str) and runtime[key] for key in ("workerKey", "customerSessionToken")):
        raise ValueError("private worker and owner session bindings required")


def configure_runtime(path: Path, *, primary_route: str | None = None) -> tuple[dict, Path]:
    """Business purpose: Bind the pilot to its fresh isolated API, checkpoint store and selected source.

    Business rules:
    - Only loopback runtime endpoints and the exact approved T31 source/baseline are permitted.
    - The historical assessment cannot be claimed; no scenario, gold or prior facts are loaded.
    - Only configured provider credential/base-URL names are imported from the project environment.
    - An explicit primary route uses the verified private copy for both Root and researcher; project routing stays unchanged.

    Execution flow:
    1. Validate the private prepared manifest and immutable source selection.
    2. Pin the default or explicitly selected private route profile, local endpoints and approved provider timeout.
    3. Switch to the private state directory with automatic ambient environment loading disabled.

    Failure cases:
    - Remote endpoints, wrong pins, historical identity or unsafe state permissions stop before execution.

    Side effects:
    - Reads private configuration, optionally creates one private route copy and updates this process environment/CWD; creates no assessment or provider call.
    """
    from dotenv import dotenv_values

    path = path.absolute()
    runtime = json.loads(_read_private_routes(path))
    validate_prepared_runtime(runtime)
    api, checkpoint = urlsplit(runtime["apiBase"]), urlsplit(runtime["checkpointDatabaseUrl"])
    if api.scheme != "http" or api.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("pilot API must be loopback HTTP")
    if checkpoint.hostname not in {"127.0.0.1", "localhost", "::1"} or not checkpoint.path.startswith("/lcsp_assessment_t31_"):
        raise ValueError("pilot checkpoint database must be a uniquely prepared loopback database")
    if (runtime["repositoryFullName"] != REPOSITORY or runtime["repositoryCommit"] != COMMIT
            or runtime["sourcePathPrefix"] != SOURCE_PREFIX or runtime["ruleSetVersionId"] != BASELINE
            or runtime["assessmentId"] == HISTORICAL_ASSESSMENT):
        raise ValueError("prepared pilot source or assessment identity does not match")
    directory = path.parent.resolve()
    metadata = directory.stat()
    if metadata.st_mode & 0o077 or metadata.st_uid != os.geteuid():
        raise ValueError("pilot state directory must be owner-only")
    routing = select_pilot_routes(directory, primary_route)
    runtime["pilotRouting"] = routing
    provider_names = {"OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "INCEPTION_API_KEY",
                      "APX_API_KEY", "ANTHROPIC_API_KEY", "MIRAI_API_KEY", "INCEPTION_BASE_URL", "APX_BASE_URL"}
    configured = dotenv_values(ROOT / ".env")
    for name in provider_names:
        if configured.get(name):
            os.environ[name] = configured[name]
    os.environ.update({
        "NESTJS_API_BASE_URL": runtime["apiBase"], "WORKER_API_KEY": runtime["workerKey"],
        "LANGGRAPH_CHECKPOINT_DATABASE_URL": runtime["checkpointDatabaseUrl"],
        "DATABASE_URL": runtime["checkpointDatabaseUrl"], "PYTHON_DOTENV_DISABLED": "1",
        "RABBITMQ_URL": "amqp://guest:guest@127.0.0.1:55999",
        "REDIS_URL": "redis://127.0.0.1:63999/0",
        "USAGE_RECOVERY_STORE_PATH": str(directory / "usage.sqlite3"),
        "LEGAL_SOURCE_STORAGE_ROOT": str(directory / "legal-source-storage"),
        "LLM_PROVIDER_TIMEOUT_SECONDS": str(LIMITS["provider_read_timeout_seconds"]),
        "PHOENIX_ENABLED": "false", "LANGSMITH_TRACING": "false", "OTEL_SDK_DISABLED": "true",
        "LCSP_MODEL_ROUTES_FILE": routing["routesFile"],
        "LCSP_AGENT_RUNTIME_MODE": "production", "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER": "1",
        "LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS": "1", "LCSP_AGENT_SERVER_URL": runtime["agentBase"],
        "LCSP_AGENT_SERVER_LOCK_PATH": str(directory / "native-server.lock"),
    })
    local_env = directory / ".env"
    if not local_env.exists():
        local_env.write_text("# Isolated pilot: configuration comes from explicit process environment.\n")
    os.chdir(directory)
    return runtime, directory


def docker_health() -> dict:
    """Business purpose: Require an actual reachable production Docker engine before a genuine pilot.

    Business rules:
    - CLI exit status or an empty JSON version never proves engine health.
    - Require nonempty server metadata and the selected local Unix socket; never switch contexts.

    Execution flow:
    1. Read the selected context, its endpoint and bounded server metadata.
    2. Verify a nonempty server version and connect read-only to the same Unix socket.

    Failure cases:
    - Missing server data, unsupported endpoint, absent socket or command timeout returns unhealthy.

    Side effects:
    - Read-only Docker metadata and socket probes; no container, context or service is changed.
    """
    try:
        context = subprocess.run(["docker", "context", "show"], capture_output=True, text=True, timeout=5)
        if context.returncode != 0 or not context.stdout.strip():
            return {"healthy": False, "reason": "DOCKER_CONTEXT_UNAVAILABLE"}
        name = context.stdout.strip()
        server = subprocess.run(["docker", "version", "--format", "{{json .Server}}"],
                                capture_output=True, text=True, timeout=5)
        data = json.loads(server.stdout) if server.stdout.strip() else None
        if server.returncode != 0 or not isinstance(data, dict) or not isinstance(data.get("Version"), str) or not data["Version"].strip():
            return {"healthy": False, "context": name, "reason": "DOCKER_SERVER_UNAVAILABLE", "serverVersion": None}
        inspected = subprocess.run(["docker", "context", "inspect", name], capture_output=True, text=True, timeout=5)
        endpoint = json.loads(inspected.stdout)[0]["Endpoints"]["docker"]["Host"] if inspected.returncode == 0 else ""
        parsed = urlsplit(endpoint)
        if parsed.scheme != "unix" or not parsed.path:
            return {"healthy": False, "context": name, "reason": "DOCKER_LOCAL_SOCKET_REQUIRED"}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(1)
            connection.connect(parsed.path)
        return {"healthy": True, "context": name, "serverVersion": data["Version"], "socketReachable": True}
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, IndexError):
        return {"healthy": False, "reason": "DOCKER_UNAVAILABLE"}


@contextmanager
def preparation_deadline(seconds: float):
    """Business purpose: Bound provider-free archive hydration, indexing and budget preparation.

    Business rules:
    - This POSIX operator deadline is distinct from the cooperative model-work deadline and SDK read timeout.
    - Main-thread preparation uses a POSIX alarm; native worker preparation shares cooperative cancellation.
    - A blocked native hydration may drain late, but cannot advance into provider admission after expiry.

    Execution flow:
    1. Install a temporary alarm that raises before inference when preparation expires.
    2. Run preparation and restore the previous process alarm state on every exit.

    Failure cases:
    - Unsupported threading/platform or expired preparation stops the new execution without model dispatch.

    Side effects:
    - Temporarily sets the current operator process alarm; does not stop any unrelated service or container.
    """
    if threading.current_thread() is not threading.main_thread():
        from orchestration.agent_stream import active_agent_stream_cancel
        cancel = active_agent_stream_cancel.get()
        if cancel is None:
            raise RuntimeError("native preparation requires the physical run cancellation scope")
        expired_at = time.monotonic() + seconds
        timer = threading.Timer(seconds, cancel.set)
        timer.daemon = True
        timer.start()
        try:
            if cancel.is_set():
                raise TimeoutError("PILOT_PREPARATION_CANCELLED")
            yield
            if cancel.is_set() or time.monotonic() >= expired_at:
                raise TimeoutError("PILOT_PREPARATION_TIMEOUT")
        finally:
            timer.cancel()
        return
    if not hasattr(signal, "setitimer"):
        raise RuntimeError("main-thread preparation requires a POSIX alarm")
    previous_handler = signal.getsignal(signal.SIGALRM)
    def expired(_signum, _frame):
        """Business purpose: Stop preparation when its allotted operator interval expires.

        Business rules:
        - An expired preparation cannot continue to initialize provider dispatch.

        Execution flow:
        1. Raise the preparation timeout into the owning execution boundary.

        Failure cases:
        - The timeout remains visible so the fresh execution can be settled as failed.

        Side effects:
        - Interrupts this process's current preparation; changes no unrelated service.
        """
        raise TimeoutError("PILOT_PREPARATION_TIMEOUT")
    signal.signal(signal.SIGALRM, expired)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)
        signal.signal(signal.SIGALRM, previous_handler)


def summarize_reported_usage(rows: list[dict]) -> dict:
    """Business purpose: Report known provider usage without losing cache-inclusive input or inventing zero usage.

    Business rules:
    - InputTokensIncludingCache is the normalized total input; inputTokens alone is the uncached bucket.
    - Missing input/output reports remain explicit incomplete counts, not zero charged work.

    Execution flow:
    1. Select completed physical-attempt records and their present normalized numeric fields.
    2. Return known subtotals and missing-usage counts separately.

    Failure cases:
    - Malformed normalized numeric values propagate rather than becoming estimated usage.

    Side effects:
    - Pure receipt projection; neither settles admission nor requests model work.
    """
    completed = [row for row in rows if row.get("event") == "MODEL_ATTEMPT" and row.get("attemptStatus") == "COMPLETED"]
    inputs = [int(row["inputTokensIncludingCache"]) for row in completed if row.get("inputTokensIncludingCache") is not None]
    outputs = [int(row["outputTokens"]) for row in completed if row.get("outputTokens") is not None]
    uncached = [int(row["inputTokens"]) for row in completed if row.get("inputTokens") is not None]
    return {"completedResponses": len(completed), "knownInputTokensIncludingCache": sum(inputs) if inputs else None,
            "knownUncachedInputTokens": sum(uncached) if uncached else None,
            "knownOutputTokens": sum(outputs) if outputs else None,
            "incompleteInputUsageCalls": len(completed) - len(inputs),
            "incompleteOutputUsageCalls": len(completed) - len(outputs), "unreportedUsageIsNotZero": True}


def owner_read(runtime: dict, suffix: str = "") -> dict:
    """Business purpose: Read authoritative pilot state using its prepared customer session.

    Business rules:
    - Reads are restricted to the one private assessment; no worker lease is forged or reused.
    Execution flow:
    1. GET the assessment or its audit resource from the validated isolated API.
    2. Require a successful data envelope and return it for pin/state verification.
    Failure cases:
    - Authentication, transport or response errors stop validation without a provider call.
    Side effects:
    - Performs one bounded read-only owner request; never stores the session in public receipts.
    """
    import httpx
    if suffix and not suffix.startswith("/rule-audits/"):
        raise ValueError("unsupported pilot owner resource")
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        response = client.get(runtime["apiBase"] + "/assessments/" + runtime["assessmentId"] + suffix,
                              headers={"Authorization": "Bearer " + runtime["customerSessionToken"]})
        response.raise_for_status()
        envelope = response.json()
    if envelope.get("ok") is not True or not isinstance(envelope.get("data"), dict):
        raise ValueError("authoritative pilot owner response required")
    return envelope["data"]


def validate_authoritative_context(runtime: dict, claim: dict, context: dict) -> None:
    """Business purpose: Reject stale or inherited state inside the admitted native Root.

    Business rules:
    - Source pins, the explicit full243 audit and every identity/version must still agree.
    - A fresh pilot cannot resume checkpoints or inherit facts, decisions or human requests.
    Execution flow:
    1. Compare authoritative source and audit identities with the prepared manifest.
    2. Validate zero-fact state and exact full coverage membership.
    Failure cases:
    - Any drift fails before Docker hydration, budget activation or a physical provider request.
    Side effects:
    - Pure validation; performs no admission or state mutation.
    """
    expected = {"assessmentId": runtime["assessmentId"], "repositorySnapshotId": runtime["repositorySnapshotId"],
                "repositoryScanJobId": runtime["repositoryScanJobId"], "repositoryCommit": COMMIT,
                "sourcePathPrefix": SOURCE_PREFIX, "ruleSetVersionId": BASELINE}
    if any(context.get(key) != value for key, value in expected.items()):
        raise ValueError("pilot authoritative source pins changed")
    audit = context.get("auditRequest") or {}
    members = canonical_audit_membership(runtime["auditRules"])
    if (claim.get("checkpointThreadId") != runtime["auditRequestId"]
            or claim.get("assessmentId") != runtime["assessmentId"]
            or claim.get("threadId") != context.get("threadId")
            or audit.get("requestId") != runtime["auditRequestId"]
            or audit.get("scopeMode") != "FULL_RULE_SET"
            or sorted(audit.get("selectedRuleIds", [])) != [row[0] for row in members]
            or canonical_audit_membership(context.get("coverage")) != members):
        raise ValueError("pilot authoritative audit membership changed")
    if (context.get("caseRevision") != 0 or context.get("facts") or context.get("evidence")
            or context.get("openHumanRequestIds") or context.get("humanRequests")
            or any(row.get("currentDecisionId") is not None for row in context["coverage"])
            or claim.get("resumeCheckpointId") or claim.get("recoveredExecution")
            or claim.get("humanAnswerReviewRequired")):
        raise ValueError("pilot assessment is not a fresh zero-fact baseline")


def run_pilot(runtime: dict, directory: Path) -> dict:
    """Business purpose: Execute one bounded fresh T31 audit through the production native server.

    Business rules:
    - Native registration, real telemetry, atomic reservation and physical drain remain mandatory.
    - Exact source/full243 intent and every frozen budget/governance check run inside the server.
    - Existing dispatch or execution markers prohibit resume, reset and automatic redispatch.
    - The first human wait or technical boundary ends this pilot without automatic answers.
    Execution flow:
    1. Start the owned native runtime and wait for a genuine positive capacity observation.
    2. Create an immutable dispatch marker and submit the persisted command through native HTTP.
    3. Observe physical drain and read the authoritative domain state and usage separately.
    Failure cases:
    - Unsupported hosts or missing capacity block dispatch; transport uncertainty is never called success.
    - Late physical calls retain their reservation and exposure until production cleanup completes.
    Side effects:
    - Explicit dispatch may hydrate this fresh Docker source view and make governed paid model calls.
    - Preserves historical assessments, journals, approved baseline and pending candidates.
    """
    from assessment_root.boundary import sandbox_backend_factory
    from assessment_root.execution_policy import NativeRootExecutionPolicy
    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
    from orchestration.agent_stream import active_agent_stream_cancel
    from orchestration.runtime_control import active_runtime_run_id, active_runtime_incarnation_id
    from tools.common.capabilities.platform.api_client import WorkerApiClient
    from scripts.t31_native_runtime import owned_native_server, dispatch_owned_native

    validate_prepared_runtime(runtime)
    if any((directory / name).exists() for name in ("execution.json", "native-dispatch.json")):
        raise ValueError("pilot already has a retained attempt; this launcher cannot resume or reset it")
    observed = {}
    def factory(client, claim, context):
        """Business purpose: Admit one fresh server-owned execution only after scoped Docker hydration.

        Business rules:
        - The authoritative context must match every prepared source pin and have no inherited case facts or decisions.

        Execution flow:
        1. Verify fresh state and hydrate with the production sandbox factory.
        2. Freeze one execution-bound measured budget and return its shared activation scope.

        Failure cases:
        - Mismatched pins or nonempty accepted state fail before model dispatch.

        Side effects:
        - Hydrates this new sandbox and persists its private execution/budget receipts.
        """
        validate_authoritative_context(runtime, claim, context)
        audit = owner_read(runtime, "/rule-audits/" + runtime["auditRequestId"])
        if (audit.get("requestId") != runtime["auditRequestId"]
                or audit.get("scopeMode") != "FULL_RULE_SET"
                or audit.get("ruleSetVersionId") != BASELINE
                or audit.get("ruleSetDigest") != BASELINE_DIGEST
                or audit.get("repositorySnapshotId") != runtime["repositorySnapshotId"]
                or audit.get("repositoryCommit") != COMMIT
                or audit.get("requestRevision") != 1
                or canonical_audit_membership(audit.get("rules")) != canonical_audit_membership(runtime["auditRules"])
                or any(row.get("decisionId") is not None for row in audit["rules"])):
            raise ValueError("authoritative frozen audit membership or pins changed")
        cancel = active_agent_stream_cancel.get()
        if cancel is None:
            raise ValueError("native physical cancellation scope required")
        observed.update(executionId=claim["executionId"], threadId=claim["threadId"],
                        auditRequestId=runtime["auditRequestId"], nativeRunId=active_runtime_run_id.get(),
                        nativeIncarnationId=active_runtime_incarnation_id.get())
        private_json(directory / "execution.json", observed, create_only=True)
        with preparation_deadline(LIMITS["preparation_timeout_seconds"]):
            backend, activation = sandbox_backend_factory(claim, context)
            # Runner heartbeats start before hydration; require a fresh authoritative renewal before inference.
            client.heartbeat()
            budget = build_budget(claim["executionId"])
        private_json(directory / "budget.json", budget.model_dump(mode="json"))
        admission = MeasuredRunAdmission(directory / "usage.sqlite3", budget, fingerprint(budget.model_dump(mode="json")))
        admission.runtime_code_sha256 = runtime["runtimeCodeSha256"]
        observed["admission"] = admission
        state = AgentRunState(run_id=claim["executionId"], agent_role="assessment-root", assessment_id=runtime["assessmentId"],
                              api_client=WorkerApiClient(runtime["apiBase"], runtime["workerKey"]),
                              admission=admission, bounded=True)

        @contextmanager
        def activate():
            """Business purpose: Keep all nested model work inside one execution budget and deadline.

            Business rules:
            - Cancellation and admission context are inherited by researchers, summaries and physical fallback calls.

            Execution flow:
            1. Start the work deadline and activate the measured run and production repository contexts.
            2. Restore contexts and stop the timer after investigation ends.

            Failure cases:
            - Expiry cooperatively cancels governed work; an already in-flight synchronous transport may finish late.
            - Unresolved attempts retain their reserved exposure; this is not whole-process or streaming-transport termination.

            Side effects:
            - Starts one local timer and scoped contexts; performs no independent provider call.
            """
            timer = threading.Timer(LIMITS["model_work_deadline_seconds"], cancel.set)
            timer.daemon = True
            record_usage_evidence(directory / "usage.sqlite3", f"run:{claim['executionId']}", {
                "runId": claim["executionId"], "event": "RUN_STARTED", "startedAt": time.time(),
            })
            timer.start()
            try:
                if cancel.is_set():
                    raise TimeoutError("PILOT_NATIVE_RUN_CANCELLED")
                with activate_agent_run_state(state), activation:
                    yield
            finally:
                timer.cancel()
        return backend, activate()


    governance = [AgentRoleMiddleware("assessment-root"), *MODEL_GOVERNANCE_MIDDLEWARE[:-1],
                  PilotInputBoundary(), MODEL_GOVERNANCE_MIDDLEWARE[-1]]
    policy = NativeRootExecutionPolicy(
        assessment_id=runtime["assessmentId"], audit_request_id=runtime["auditRequestId"],
        command_key=runtime["rootCommandKey"], backend_factory=factory, governance=tuple(governance),
    )
    started = time.monotonic()
    native = {}
    status = "NATIVE_PILOT_OBSERVATION_INCOMPLETE"
    try:
        with owned_native_server(runtime, policy) as server:
            deadline = time.monotonic() + 60
            while True:
                capacity = server._capacity.readiness()
                if capacity["ready"] or time.monotonic() >= deadline:
                    break
                threading.Event().wait(0.1)
            private_json(directory / "native-capacity-preflight.json", capacity)
            if not capacity["ready"]:
                return {"status": "BLOCKED_NATIVE_CAPACITY", "result": {"state": None},
                        "capacity": capacity, "providerCalls": 0}
            private_json(directory / "native-dispatch.json", {
                "assessmentId": runtime["assessmentId"], "auditRequestId": runtime["auditRequestId"],
                "commandId": runtime["rootCommandId"], "commandKey": runtime["rootCommandKey"],
                "runtimeCodeSha256": runtime["runtimeCodeSha256"],
                "incarnationId": capacity["incarnationId"], "startedAt": time.time(),
                "automaticResumeAllowed": False,
            }, create_only=True)
            native = dispatch_owned_native(server, runtime, timeout_seconds=(
                LIMITS["preparation_timeout_seconds"] + LIMITS["model_work_deadline_seconds"]
                + LIMITS["provider_read_timeout_seconds"]
            ))
            status = "BOUNDED_NATIVE_PILOT_OBSERVED"
    except Exception as error:
        # Exception text can contain HTTP bodies. Preserve a safe type, never a fabricated domain state.
        native = {**native, "errorType": type(error).__name__, "observationComplete": False}
    result = {"state": None, "authoritativeStateObserved": False}
    try:
        detail = owner_read(runtime)
        if detail.get("assessment_id") != runtime["assessmentId"]:
            raise ValueError("authoritative assessment changed")
        state = detail.get("runtime") or {}
        result = {"state": state.get("executionState"), "lifecycle": detail.get("lifecycle"),
                  "executionId": state.get("currentExecutionId"), "authoritativeStateObserved": True}
    except Exception as error:
        result["observationErrorType"] = type(error).__name__
    summary = {"status": status, "result": result, "native": native,
               "assessmentId": runtime["assessmentId"], "auditRequestId": runtime["auditRequestId"],
               "auditMembershipSha256": runtime["auditMembershipSha256"], "sourcePathPrefix": SOURCE_PREFIX,
               "elapsedIncludingHydrationSeconds": round(time.monotonic() - started, 2),
               "technicalLimits": LIMITS, "financialCap": "NOT_CLAIMED", "semanticAcceptance": "NOT_EVALUATED"}
    if observed.get("executionId") and (directory / "usage.sqlite3").exists():
        summary["admission"] = recover_admission(directory / "usage.sqlite3", observed["executionId"])
        summary["reportedUsage"] = summarize_reported_usage(read_usage_evidence(directory / "usage.sqlite3"))
    return summary


def main() -> int:
    """Business purpose: Make the isolated pilot reviewable before explicitly authorized dispatch.

    Business rules:
    - Default mode records prerequisites only; native capacity and atomic reservation remain unproven until dispatch.
    - Explicit dispatch requires a genuine supported Linux host, real capacity and healthy Docker.
    - Preflight validates native SDK/account binding without contacting provider generation endpoints.
    - An explicit primary route is an existing project route pinned in a private profile and included in the reviewed runtime digest.

    Execution flow:
    1. Load the private runtime manifest and inspect configured routes, limits and Docker health.
    2. Save preflight evidence and optionally invoke the one fresh governed pilot.
    3. Print only safe status and artifact paths.

    Failure cases:
    - Failed prerequisites produce a blocked receipt and no provider dispatch.

    Side effects:
    - Writes private receipts; only explicit dispatch may invoke the documented bounded pilot.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--dispatch", action="store_true")
    parser.add_argument("--primary-route", help="Existing route for Root/researcher in this fresh pilot only; repeat on preflight and dispatch.")
    parser.add_argument("--expected-code-sha256", help="Required for dispatch; copy from the reviewed preflight receipt.")
    arguments = parser.parse_args()
    runtime, directory = configure_runtime(arguments.runtime, primary_route=arguments.primary_route)
    code_digest = runtime_code_digest()
    if arguments.dispatch and arguments.expected_code_sha256 != code_digest:
        raise ValueError("dispatch requires the exact reviewed runtime code SHA-256")
    runtime["runtimeCodeSha256"] = code_digest
    budget = build_budget("t31-preflight-no-provider")
    health = docker_health()
    from scripts.t31_native_runtime import native_host_prerequisites
    native_host = native_host_prerequisites()
    prereqs = health["healthy"] and native_host["supported"]
    preflight = {"status": "PREREQUISITES_OBSERVED_NATIVE_ADMISSION_PENDING" if prereqs else "BLOCKED_NATIVE_PREREQUISITES",
                 "docker": health, "nativeHost": native_host, "nativeCapacityVerified": False,
                 "assessmentId": runtime["assessmentId"], "auditRequestId": runtime["auditRequestId"],
                 "auditMembershipSha256": runtime["auditMembershipSha256"],
                 "runtimeCodeSha256": code_digest, "candidateHeadSha": budget.candidate_sha,
                 "technicalLimits": LIMITS, "sourcePathPrefix": SOURCE_PREFIX, "pilotRouting": runtime["pilotRouting"],
                 "routes": sorted({(p.route_id, p.provider, p.model) for p in budget.policies}),
                 "nativeIdentityAndSingleAttemptSdkVerified": True, "providerCalls": 0, "financialCap": "NOT_CLAIMED"}
    private_json(directory / "pilot-preflight.json", preflight)
    if not arguments.dispatch or not prereqs:
        print(json.dumps({"status": preflight["status"], "providerCalls": 0, "receipt": str(directory / "pilot-preflight.json")}))
        return 0 if not arguments.dispatch else 2
    result = run_pilot(runtime, directory)
    private_json(directory / "pilot-result.json", result)
    print(json.dumps({"status": result["status"], "executionState": result["result"].get("state"),
                      "receipt": str(directory / "pilot-result.json")}))
    return 0 if result["status"] == "BOUNDED_NATIVE_PILOT_OBSERVED" else 2


if __name__ == "__main__":
    raise SystemExit(main())