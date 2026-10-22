"""Fail-closed evaluation admission in the existing durable usage journal.

Policies are trusted, independently reviewed configuration, pinned by digest in
the immutable run envelope. This module verifies their binding, not the truth of
a provider's billing promise. No production tariff is supplied by the code.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from middleware.failure_policy import PaidAdmissionError
from middleware.usage_recovery import _connect

UInt = Annotated[int, Field(strict=True, ge=0, le=10**12)]
Positive = Annotated[int, Field(strict=True, gt=0, le=10**12)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


def fingerprint(value: dict) -> str:
    """Fingerprint canonical, secret-free configuration or usage evidence."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class TokenPolicy(BaseModel):
    """Pinned technical token allowances; these do not guarantee a provider charge."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    route_id: str = Field(min_length=1, max_length=100)
    route_fingerprint: Digest
    credential_fingerprint: Digest
    endpoint_fingerprint: Digest
    sdk_fingerprint: Digest
    provider: str = Field(min_length=1, max_length=40)
    protocol: Literal["anthropic", "openai", "google_genai"]
    model: str = Field(min_length=1, max_length=200)
    valid_from: Positive
    expires_at: Positive
    input_upper_bound: Positive
    output_upper_bound: Positive


class ChargePolicy(TokenPolicy):
    """Optional independently verified all-charge contract; unchanged schema-2 semantics."""
    evidence_url: str = Field(pattern=r"^https://", max_length=1000)
    evidence_sha256: Digest
    verified_by: str = Field(min_length=1, max_length=100)
    valid_from: Positive
    expires_at: Positive
    coverage: Literal["ALL_CHARGES_AND_PROVIDER_HARD_TOKEN_LIMITS"]
    currency: Literal["USD"] = "USD"
    input_upper_bound: Positive
    output_upper_bound: Positive
    input_rate: UInt
    cache_read_rate: UInt
    cache_write_rate: UInt
    output_rate: UInt
    reasoning_rate: UInt
    fixed_charge: UInt
    minimum_charge: UInt
    rounding_quantum: Positive

    def charge(self, input_tokens, cached, written, output, reasoning):
        subtotal = (self.fixed_charge + input_tokens * self.input_rate
                    + cached * self.cache_read_rate + written * self.cache_write_rate
                    + (output - reasoning) * self.output_rate + reasoning * self.reasoning_rate)
        subtotal = max(subtotal, self.minimum_charge)
        return ((subtotal + self.rounding_quantum - 1) // self.rounding_quantum) * self.rounding_quantum

    def exposure(self):
        input_rate = max(self.input_rate, self.cache_read_rate, self.cache_write_rate)
        output_rate = max(self.output_rate, self.reasoning_rate)
        subtotal = max(self.fixed_charge + self.input_upper_bound * input_rate
                       + self.output_upper_bound * output_rate, self.minimum_charge)
        return ((subtotal + self.rounding_quantum - 1) // self.rounding_quantum) * self.rounding_quantum


class RunBudget(BaseModel):
    """One immutable run envelope. Constructing one does not authorize inference."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[2]
    run_id: str = Field(min_length=1, max_length=200)
    candidate_sha: Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
    model_routes_sha256: Digest
    credential_salt: Digest
    valid_from: Positive
    expires_at: Positive
    maximum_calls: UInt
    maximum_input_tokens: UInt
    maximum_output_tokens: UInt
    maximum_charge_nano_usd: UInt
    policies: tuple[ChargePolicy, ...]


class TokenRunBudget(BaseModel):
    """Call/token governance independent of reference pricing or private billing."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[3]
    run_id: str = Field(min_length=1, max_length=200)
    candidate_sha: Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
    model_routes_sha256: Digest
    credential_salt: Digest
    valid_from: Positive
    expires_at: Positive
    maximum_calls: UInt
    maximum_input_tokens: UInt
    maximum_output_tokens: UInt
    policies: tuple[TokenPolicy, ...]


def parse_run_budget(value: dict) -> RunBudget | TokenRunBudget:
    return (TokenRunBudget if value.get("schema_version") == 3 else RunBudget).model_validate(value)


class RunAdmission:
    """Atomic reservations and reconciliation; all rows share the usage SQLite file."""

    def __init__(self, path: str | Path, budget: RunBudget | TokenRunBudget, expected_fingerprint: str):
        self.path = Path(path)
        self.budget = parse_run_budget(budget.model_dump())
        self.identity = fingerprint(self.budget.model_dump(mode="json"))
        self.run_id = budget.run_id
        if self.identity != expected_fingerprint:
            raise PaidAdmissionError("BUDGET_IDENTITY", self.run_id)
        routes = [(p.route_id, p.credential_fingerprint) for p in budget.policies]
        if len(routes) != len(set(routes)):
            raise PaidAdmissionError("DUPLICATE_POLICY", self.run_id)
        with self._transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS inference_budgets (run_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, envelope TEXT NOT NULL, stopped TEXT)")
            db.execute("""CREATE TABLE IF NOT EXISTS inference_attempts (
                run_id TEXT NOT NULL, attempt_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('ADMITTED','IN_FLIGHT','SETTLED','OUTCOME_UNKNOWN','DENIED')),
                identity TEXT NOT NULL, input_exposure INTEGER NOT NULL CHECK(input_exposure>=0), output_exposure INTEGER NOT NULL CHECK(output_exposure>=0),
                charge_exposure INTEGER NOT NULL CHECK(charge_exposure>=0), usage TEXT, actual_charge INTEGER, history TEXT NOT NULL,
                PRIMARY KEY(run_id,attempt_id), FOREIGN KEY(run_id) REFERENCES inference_budgets(run_id))""")
            old = db.execute("SELECT fingerprint FROM inference_budgets WHERE run_id=?", (self.run_id,)).fetchone()
            if old and old[0] != self.identity:
                raise PaidAdmissionError("BUDGET_CHANGED", self.run_id)
            db.execute("INSERT OR IGNORE INTO inference_budgets VALUES (?,?,?,NULL)",
                       (self.run_id, self.identity, json.dumps(budget.model_dump(mode="json"), sort_keys=True)))

    @contextmanager
    def _transaction(self):
        db = None
        try:
            db = _connect(self.path)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA synchronous=FULL")
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except (sqlite3.Error, OSError) as error:
            raise PaidAdmissionError("DURABILITY", self.run_id) from error
        finally:
            if db is not None:
                db.close()

    def _check_identity(self, db):
        row = db.execute("SELECT * FROM inference_budgets WHERE run_id=?", (self.run_id,)).fetchone()
        if (fingerprint(self.budget.model_dump(mode="json")) != self.identity or not row
                or row["fingerprint"] != self.identity or fingerprint(json.loads(row["envelope"])) != self.identity):
            raise PaidAdmissionError("BUDGET_CHANGED", self.run_id)
        return row

    def admit(self, attempt_id: str, identity: dict, *, reason: str | None = None) -> ChargePolicy | TokenPolicy:
        """Commit admission or terminal denial before the caller may dispatch."""
        policy = next((p for p in self.budget.policies if (p.route_id, p.credential_fingerprint)
                       == (identity.get("route_id"), identity.get("credential_fingerprint"))), None)
        now = time.time()
        if not self.budget.valid_from <= now < self.budget.expires_at:
            reason = "BUDGET_EXPIRED"
        if policy is None:
            reason = reason or ("UNKNOWN_TOKEN_POLICY" if isinstance(self.budget, TokenRunBudget) else "UNKNOWN_TARIFF")
        elif any(identity.get(k) != getattr(policy, k) for k in (
            "route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model"
        )) or not policy.valid_from <= now < policy.expires_at:
            reason = reason or "UNVERIFIED_POLICY"
        if not isinstance(attempt_id, str) or not 1 <= len(attempt_id) <= 200:
            raise PaidAdmissionError("ATTEMPT_IDENTITY", self.run_id)
        failure = None
        with self._transaction() as db:
            envelope = self._check_identity(db)
            if db.execute("SELECT 1 FROM inference_attempts WHERE run_id=? AND attempt_id=?", (self.run_id, attempt_id)).fetchone():
                db.execute("UPDATE inference_budgets SET stopped=coalesce(stopped,'DUPLICATE_ATTEMPT') WHERE run_id=?", (self.run_id,))
                db.commit()
                raise PaidAdmissionError("DUPLICATE_ATTEMPT", self.run_id, attempt_id)
            reason = envelope["stopped"] or reason
            exposure = (policy.input_upper_bound, policy.output_upper_bound, (policy.exposure() if isinstance(policy, ChargePolicy) else 0)) if policy else (0, 0, 0)
            totals = db.execute("""SELECT count(*),coalesce(sum(input_exposure),0),coalesce(sum(output_exposure),0),coalesce(sum(charge_exposure),0)
                FROM inference_attempts WHERE run_id=? AND state!='DENIED'""", (self.run_id,)).fetchone()
            for label, used, increment, limit in zip(
                ("CALL_LIMIT", "INPUT_LIMIT", "OUTPUT_LIMIT", "CHARGE_LIMIT"), totals,
                (1, *exposure), (self.budget.maximum_calls, self.budget.maximum_input_tokens,
                                 self.budget.maximum_output_tokens, getattr(self.budget, "maximum_charge_nano_usd", 0))
            ):
                if used + increment > limit:
                    reason = reason or label
            state = "DENIED" if reason else "ADMITTED"
            safe_identity = {k: identity[k] for k in (
                "route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model", "agent_role"
            ) if k in identity}
            db.execute("INSERT INTO inference_attempts VALUES (?,?,?,?,?,?,?,NULL,NULL,?)",
                       (self.run_id, attempt_id, state, json.dumps(safe_identity, sort_keys=True),
                        *(exposure if not reason else (0, 0, 0)), json.dumps([{
                            "state": state, "at": time.time(), "inputReserved": exposure[0] if not reason else 0,
                            "outputReserved": exposure[1] if not reason else 0, "chargeReservedNanoUSD": exposure[2] if not reason else 0}])))
            if reason:
                db.execute("UPDATE inference_budgets SET stopped=coalesce(stopped,?) WHERE run_id=?", (reason, self.run_id))
                failure = PaidAdmissionError(reason, self.run_id, attempt_id)
        if failure:
            raise failure
        return policy

    def transition(self, attempt_id: str, state: Literal["IN_FLIGHT", "OUTCOME_UNKNOWN"]):
        with self._transaction() as db:
            self._check_identity(db)
            row = db.execute("SELECT * FROM inference_attempts WHERE run_id=? AND attempt_id=?", (self.run_id, attempt_id)).fetchone()
            allowed = {"IN_FLIGHT": {"ADMITTED"}, "OUTCOME_UNKNOWN": {"ADMITTED", "IN_FLIGHT"}}
            if row is None or row["state"] == "DENIED":
                raise PaidAdmissionError("ATTEMPT_IDENTITY", self.run_id, attempt_id)
            if row["state"] not in allowed[state]:
                return  # Late settlement must never be reverted to unknown.
            history = json.loads(row["history"]) + [{"state": state, "at": time.time()}]
            db.execute("UPDATE inference_attempts SET state=?,history=? WHERE run_id=? AND attempt_id=?",
                       (state, json.dumps(history), self.run_id, attempt_id))

    def settle(self, attempt_id: str, usage: dict | None):
        """Idempotent authoritative reconciliation; incomplete usage retains all exposure."""
        failure = None
        with self._transaction() as db:
            self._check_identity(db)
            row = db.execute("SELECT * FROM inference_attempts WHERE run_id=? AND attempt_id=?", (self.run_id, attempt_id)).fetchone()
            if row is None or row["state"] == "DENIED":
                raise PaidAdmissionError("ATTEMPT_IDENTITY", self.run_id, attempt_id)
            token_only = isinstance(self.budget, TokenRunBudget)
            fields = ("inputTokensIncludingCache", "outputTokens") if token_only else ("inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens")
            usage = {k: usage[k] for k in fields if k in usage} if isinstance(usage, dict) else None
            raw = json.dumps(usage, sort_keys=True) if usage is not None else None
            if row["state"] == "SETTLED":
                if row["usage"] != raw:
                    db.execute("UPDATE inference_budgets SET stopped=coalesce(stopped,'CONFLICTING_SETTLEMENT') WHERE run_id=?", (self.run_id,))
                    db.commit()
                    raise PaidAdmissionError("CONFLICTING_SETTLEMENT", self.run_id, attempt_id)
                return
            if row["state"] == "OUTCOME_UNKNOWN" and row["usage"] == raw:
                if row["actual_charge"] is not None:
                    raise PaidAdmissionError("PROVIDER_BOUND_BREACH", self.run_id, attempt_id)
                return
            identity = json.loads(row["identity"])
            policy = next(p for p in self.budget.policies if (p.route_id, p.credential_fingerprint)
                          == (identity["route_id"], identity["credential_fingerprint"]))
            numbers = []
            for name in fields:
                value = (usage or {}).get(name)
                if isinstance(value, str) and value.isascii() and value.isdecimal():
                    value = int(value)
                if type(value) is not int or value < 0:
                    break
                numbers.append(value)
            state, exposure, charge = "OUTCOME_UNKNOWN", None, None
            if len(numbers) == len(fields):
                if token_only:
                    inputs, output = numbers
                    cached, written, reasoning, charge = 0, 0, 0, 0
                else:
                    inputs, cached, written, output, reasoning = numbers
                    charge = policy.charge(*numbers)
                if (inputs + cached + written > policy.input_upper_bound or output > policy.output_upper_bound
                        or reasoning > output or charge > row["charge_exposure"]):
                    failure = PaidAdmissionError("PROVIDER_BOUND_BREACH", self.run_id, attempt_id)
                    db.execute("UPDATE inference_budgets SET stopped=? WHERE run_id=?", (failure.reason, self.run_id))
                    if reasoning > output:
                        charge = None  # Contradictory buckets cannot establish an actual charge.
                    exposure = (max(row["input_exposure"], inputs + cached + written),
                                max(row["output_exposure"], output), max(row["charge_exposure"], charge or 0))
                else:
                    state, exposure = "SETTLED", (inputs + cached + written, output, charge)
            history = json.loads(row["history"]) + [{"state": state, "at": time.time()}]
            db.execute("UPDATE inference_attempts SET state=?,usage=?,actual_charge=?,history=? WHERE run_id=? AND attempt_id=?",
                       (state, raw, None if token_only else charge, json.dumps(history), self.run_id, attempt_id))
            if exposure:
                db.execute("UPDATE inference_attempts SET input_exposure=?,output_exposure=?,charge_exposure=? WHERE run_id=? AND attempt_id=?",
                           (*exposure, self.run_id, attempt_id))
        if failure:
            raise failure


def recover_admission(path: str | Path, run_id: str) -> dict:
    """Read-only recovery; unresolved ADMITTED/IN_FLIGHT rows keep their full bound."""
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='inference_budgets'").fetchone():
            return {"state": "LEGACY_UNBOUNDED", "runId": run_id}
        budget = db.execute("SELECT * FROM inference_budgets WHERE run_id=?", (run_id,)).fetchone()
        if not budget:
            return {"state": "LEGACY_UNBOUNDED", "runId": run_id}
        rows = [dict(r) for r in db.execute("SELECT * FROM inference_attempts WHERE run_id=? ORDER BY rowid", (run_id,))]
        token_only = json.loads(budget["envelope"])["schema_version"] == 3
        result = {"state": "STOPPED" if budget["stopped"] else "BOUNDED", "runId": run_id,
                "schemaVersion": json.loads(budget["envelope"])["schema_version"],
                "budgetFingerprint": budget["fingerprint"], "terminalReason": budget["stopped"],
                "attempts": rows, "admittedAttempts": sum(r["state"] != "DENIED" for r in rows),
                "inputExposure": sum(r["input_exposure"] for r in rows),
                "outputExposure": sum(r["output_exposure"] for r in rows),
                "chargeExposureNanoUSD": sum(r["charge_exposure"] for r in rows),
                "knownActualChargeNanoUSD": sum(r["actual_charge"] or 0 for r in rows),
                "actualChargeNanoUSD": (None if any(r["state"] in {"ADMITTED", "IN_FLIGHT", "OUTCOME_UNKNOWN"} for r in rows)
                                        else sum(r["actual_charge"] or 0 for r in rows)),
                "unresolvedChargeExposureNanoUSD": sum(r["charge_exposure"] for r in rows if r["state"] != "SETTLED"),
                "unresolvedAttempts": sum(r["state"] in {"ADMITTED", "IN_FLIGHT", "OUTCOME_UNKNOWN"} for r in rows)}
        result["financialEnforcement"] = "DISABLED" if token_only else "STRICT_ACCOUNT_CONTRACT"
        if token_only:
            for key in ("chargeExposureNanoUSD", "knownActualChargeNanoUSD", "actualChargeNanoUSD", "unresolvedChargeExposureNanoUSD"):
                result[key] = None
        return result
    finally:
        db.close()


def reconcile_admission_evidence(path: str | Path, run_id: str, records: list[dict]) -> dict:
    """Finish a crash-interrupted settlement from already committed usage; never dispatch."""
    snapshot = recover_admission(path, run_id)
    if snapshot["state"] == "LEGACY_UNBOUNDED":
        return snapshot
    if snapshot["schemaVersion"] not in (2, 3):
        return {**snapshot, "state": "LEGACY_RESERVATIONS_RETAINED", "reconciliation": "REQUIRES_ORIGINAL_POLICY_VERSION"}
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    try:
        raw, digest = db.execute("SELECT envelope,fingerprint FROM inference_budgets WHERE run_id=?", (run_id,)).fetchone()
    finally:
        db.close()
    admission = RunAdmission(path, parse_run_budget(json.loads(raw)), digest)
    attempts = {r["attempt_id"]: r for r in snapshot["attempts"]}
    for record in records:
        attempt_id = record["invocationId"]
        if attempt_id not in attempts:
            raise PaidAdmissionError("UNRESERVED_USAGE", run_id, attempt_id)
        identity = json.loads(attempts[attempt_id]["identity"])
        if record["provider"].lower() != identity["provider"] or record["model"] != identity["model"]:
            raise PaidAdmissionError("SETTLEMENT_IDENTITY", run_id, attempt_id)
        admission.settle(attempt_id, record["usage"])
    return recover_admission(path, run_id)


def route_fingerprint(route) -> str:
    return fingerprint({"routeId": route.route_id, "provider": route.provider, "protocol": route.protocol,
                        "model": route.model, "options": route.options})


def request_identity(model, credential_salt: str) -> dict:
    """Bind billing policy to the actual native client, endpoint and credential."""
    from langchain_anthropic import ChatAnthropic
    from langchain_openai import ChatOpenAI
    from langchain_google_genai import ChatGoogleGenerativeAI
    from model_policy import model_route_config
    from importlib.metadata import version
    import anthropic._base_client as anthropic_client

    route = model_route_config(model)
    if route is None:
        raise PaidAdmissionError("UNBOUND_MODEL_ROUTE", "unknown")
    if isinstance(model, ChatAnthropic) and route.protocol == "anthropic":
        key, endpoint = model._client.api_key, str(model._client.base_url).rstrip("/")
        if model.model != route.model or model._async_client.api_key != key or str(model._async_client.base_url).rstrip("/") != endpoint:
            raise PaidAdmissionError("UNBOUND_ACCOUNT", "unknown")
        single = model.max_retries == 0 and model._client.max_retries == 0 and model._async_client.max_retries == 0
    elif isinstance(model, ChatOpenAI) and route.protocol == "openai":
        key, endpoint = model.root_client.api_key, str(model.root_client.base_url).rstrip("/")
        if model.model_name != route.model or model.root_async_client.api_key != key or str(model.root_async_client.base_url).rstrip("/") != endpoint:
            raise PaidAdmissionError("UNBOUND_ACCOUNT", "unknown")
        single = model.max_retries == 0 and model.root_client.max_retries == 0 and model.root_async_client.max_retries == 0
    elif isinstance(model, ChatGoogleGenerativeAI) and route.protocol == "google_genai":
        key = model.client._api_client.api_key
        endpoint = str(model.client._api_client._http_options.base_url).rstrip("/")
        if model.model != route.model:
            raise PaidAdmissionError("UNBOUND_MODEL_ROUTE", "unknown")
        single = model.max_retries == 1 and not model.client.vertexai
    else:
        raise PaidAdmissionError("UNOBSERVABLE_TRANSPORT", "unknown")
    if not single:
        raise PaidAdmissionError("SDK_RETRIES_UNBOUNDED", "unknown")
    raw = key.get_secret_value() if hasattr(key, "get_secret_value") else key
    if not isinstance(raw, str) or not raw or endpoint == "None":
        raise PaidAdmissionError("UNBOUND_ACCOUNT", "unknown")
    anthropic_http = getattr(anthropic_client, "httpx2", None) or getattr(anthropic_client, "httpx")
    packages = {"anthropic": ("langchain-anthropic", "anthropic", anthropic_http.__name__),
                "openai": ("langchain-openai", "openai", "httpx"),
                "google_genai": ("langchain-google-genai", "google-genai", "httpx")}
    return {"route_id": route.route_id, "route_fingerprint": route_fingerprint(route),
            "provider": route.provider, "protocol": route.protocol, "model": route.model,
            "credential_fingerprint": hashlib.pbkdf2_hmac("sha256", raw.encode(), bytes.fromhex(credential_salt), 600000).hex(),
            "endpoint_fingerprint": hashlib.sha256(endpoint.encode()).hexdigest(),
            "sdk_fingerprint": fingerprint({name: version(name) for name in packages[route.protocol]})}


def prepare_admitted_request(admission: RunAdmission, request, attempt_id: str, agent_role: str):
    """Pin native caps/retry settings and reserve the full verified provider bounds."""
    from model_policy import DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV
    import os

    identity, reason = {}, None
    try:
        identity = request_identity(request.model, admission.budget.credential_salt)
    except PaidAdmissionError as error:
        reason = error.reason
    except (AttributeError, TypeError, ValueError):
        reason = "UNOBSERVABLE_TRANSPORT"
    identity["agent_role"] = agent_role
    config = Path(os.environ.get(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
    try:
        if hashlib.sha256(config.read_bytes()).hexdigest() != admission.budget.model_routes_sha256:
            reason = "ROUTES_CHANGED"
    except OSError:
        reason = "ROUTES_UNAVAILABLE"
    if any(getattr(request.model, name, None) for name in ("model_kwargs", "extra_body", "http_options")):
        reason = reason or "UNOBSERVABLE_TRANSPORT"
    if getattr(request.model, "n", 1) not in (None, 1):
        reason = reason or "UNBOUNDED_REQUEST_OPTIONS"
    protocol = identity.get("protocol")
    parameter = "max_output_tokens" if protocol == "google_genai" else "max_tokens"
    settings = getattr(request, "model_settings", None) or {}
    # No transport, alternative cap, reasoning or call-time HTTP override can
    # replace the frozen route's charging/retry contract in bounded mode.
    if set(settings) - {parameter} or type(settings.get(parameter)) is not int or settings.get(parameter, 0) <= 0:
        reason = reason or "UNBOUNDED_REQUEST_OPTIONS"
    policy = next((p for p in admission.budget.policies if (p.route_id, p.credential_fingerprint)
                   == (identity.get("route_id"), identity.get("credential_fingerprint"))), None)
    if policy and settings.get(parameter, 0) > policy.output_upper_bound:
        reason = reason or "OUTPUT_BOUND_UNVERIFIED"
    if not hasattr(request, "override"):
        reason = reason or "UNBOUNDED_REQUEST_OPTIONS"
    admission.admit(attempt_id, identity, reason=reason)
    if protocol == "google_genai":
        # Google uses total attempts, not retry count: 1 means one physical request.
        request = request.override(model_settings={**settings, "max_retries": 1,
                                                   "candidate_count": 1,
                                                   "automatic_function_calling": {"disable": True}})
    elif protocol == "openai":
        request = request.override(model_settings={**settings, "n": 1})
    return request
