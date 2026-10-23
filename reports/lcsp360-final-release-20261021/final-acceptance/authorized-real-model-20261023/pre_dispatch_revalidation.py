"""Provider-free, read-only prepared-run revalidation before the one approved dispatch."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import time

import psycopg
from psycopg.rows import dict_row

context_file, budget_file, private_env, output_file = map(Path, sys.argv[1:])
context = json.loads(context_file.read_bytes())
budget_data = json.loads(budget_file.read_bytes())
root = Path.cwd()
candidate = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
assert candidate == context["candidateSha"] == budget_data["candidate_sha"] == "bc990176cbb046ea95e12a94fc29e81bc8869653"
assert context["runId"] == budget_data["run_id"] == "4ae336f3-35b4-4393-ba42-cb4eeb4d500f"
assert hashlib.sha256(context_file.read_bytes()).hexdigest() == "c6244500515eb56fd696592802b75812261201736aab8ee25f531a50413b1718"
assert hashlib.sha256(budget_file.read_bytes()).hexdigest() == "142178f87795bef7508a317181f1ca76a1e4bd7b6503ca4cdfd89603031d36c3"
assert not subprocess.check_output(["git", "diff", "HEAD", "--", ".", ":(exclude)reports"], text=True)
key_line = next(line for line in private_env.read_text().splitlines() if line.startswith("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY="))
key = shlex.split(key_line)[0].partition("=")[2]
assert hashlib.sha256(bytes.fromhex(key)).hexdigest() == context["auditKeySha256"]
source = root / "deepagents/tests/fixtures/compliance_rule_set_context/synthetic-notice-v1.txt"
source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
assert source_digest == context["sourceSha256"]
with psycopg.connect(host="127.0.0.1", port=context["dbPort"], dbname=context["database"], user="postgres", password="postgres", options="-c default_transaction_read_only=on", row_factory=dict_row) as db:
    run = db.execute('SELECT id,"executionState","legalSourceVersionId","claimPhase" FROM "RuleSetPreparationRun" WHERE id=%s', (context["runId"],)).fetchone()
    assert run["executionState"] == "QUEUED" and str(run["legalSourceVersionId"]) == context["sourceVersionId"]
    docs = db.execute('SELECT id,"documentId","sourceSha256" FROM "LegalSourceDocument" WHERE "legalSourceVersionId"=%s', (context["sourceVersionId"],)).fetchall()
    assert len(docs) == 1 and docs[0]["sourceSha256"] == "sha256:" + source_digest
    chunks = db.execute('SELECT content,"contentSha256","legalSourceDocumentId" FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=%s', (context["sourceVersionId"],)).fetchall()
    assert len(chunks) == 15 and all(c["contentSha256"] == "sha256:" + hashlib.sha256(c["content"].encode()).hexdigest() and c["legalSourceDocumentId"] == docs[0]["id"] for c in chunks)
    counts = db.execute('SELECT (SELECT count(*) FROM "LlmUsageEvent") AS usage,(SELECT count(*) FROM "RuleSetPreparationSemanticAudit") AS audits,(SELECT count(*) FROM "ComplianceRuleSetVersion") AS versions').fetchone()
    assert counts == {"usage": 0, "audits": 0, "versions": 0}

network_attempts = []
def blocked(*args, **kwargs):
    network_attempts.append(1)
    raise AssertionError("Provider networking is prohibited during revalidation")
socket.socket.connect = blocked
socket.create_connection = blocked
from middleware.paid_admission import parse_run_budget, fingerprint, request_identity, RunAdmission, recover_admission
from middleware.token_fallback import model_with_token
from middleware.usage_metering import output_token_limit
from model_policy import load_model_routes, build_model, DEFAULT_ROUTES_FILE
from provider_credentials import provider_token_source
from vertical.live_preparation import _load_llm_env
_load_llm_env()
budget = parse_run_budget(budget_data)
now = time.time()
assert budget.valid_from <= now and budget.expires_at > now + 4200
assert fingerprint(budget.model_dump(mode="json")) == "498f7ff6f243f748f6ae43ebf0c7a6e3f3eabe2089ac9515a3d8aa891bcf1bd3"
assert (budget.maximum_calls, budget.maximum_input_tokens, budget.maximum_output_tokens) == (256, 4000000, 256000)
assert hashlib.sha256(DEFAULT_ROUTES_FILE.read_bytes()).hexdigest() == budget.model_routes_sha256
assert not os.environ.get("LCSP_RULE_SET_PREPARATION_EVAL_ROUTE") and not os.environ.get("LCSP_RULE_SET_PREPARATION_EVAL_MODEL")
routes = load_model_routes()
bindings = []
for route_id in routes.routes:
    route = routes.config(route_id)
    model = build_model(route)
    source = provider_token_source(route.provider)
    assert source and source[1]
    for slot, credential in enumerate(source[1], 1):
        native = model_with_token(model, route.provider, credential)
        identity = request_identity(native, budget.credential_salt)
        policy = next(p for p in budget.policies if p.route_id == route_id and p.credential_fingerprint == identity["credential_fingerprint"])
        assert all(getattr(policy, k) == v for k, v in identity.items())
        assert policy.valid_from <= now and policy.expires_at > now + 4200
        assert output_token_limit(native) == policy.output_upper_bound
        bindings.append({"route": route_id, "slot": slot, "provider": policy.provider, "model": policy.model, "outputAllowance": policy.output_upper_bound})
assert len(bindings) == len(budget.policies) == 40
assert 2 * max(p.input_upper_bound for p in budget.policies) <= budget.maximum_input_tokens
assert 2 * max(p.output_upper_bound for p in budget.policies) <= budget.maximum_output_tokens
# Verify durable reservation/recovery on a separate offline identity, never the paid run.
with tempfile.TemporaryDirectory(prefix="lcsp360-approved-admission-probe-") as temp:
    probe = budget.model_copy(update={"run_id": "offline-approved-run-revalidation"})
    store = Path(temp) / "usage.sqlite3"
    admission = RunAdmission(store, probe, fingerprint(probe.model_dump(mode="json")))
    first = probe.policies[0]
    identity = {k: getattr(first, k) for k in ("route_id", "route_fingerprint", "credential_fingerprint", "endpoint_fingerprint", "sdk_fingerprint", "provider", "protocol", "model")}
    admission.admit("preflight-no-provider-dispatch", identity)
    admission.transition("preflight-no-provider-dispatch", "IN_FLIGHT")
    admission.transition("preflight-no-provider-dispatch", "OUTCOME_UNKNOWN")
    recovered = recover_admission(store, probe.run_id)
    assert recovered["admittedAttempts"] == recovered["unresolvedAttempts"] == 1
    assert recovered["inputExposure"] == first.input_upper_bound
assert not network_attempts
result = {"status": "PASS_BEFORE_PAID_DISPATCH", "capturedAtEpoch": now, "candidateSha": candidate, "worktree": str(root), "runId": context["runId"], "preparedContextSha256": hashlib.sha256(context_file.read_bytes()).hexdigest(), "budgetSha256": hashlib.sha256(budget_file.read_bytes()).hexdigest(), "budgetFingerprint": fingerprint(budget.model_dump(mode="json")), "expiresAtEpoch": budget.expires_at, "remainingValiditySeconds": int(budget.expires_at-now), "sourceSha256": source_digest, "verifiedChunks": len(chunks), "run": run, "countsBefore": counts, "bindingCount": len(bindings), "bindings": bindings, "roles": routes.roles, "fallbacks": routes.fallbacks, "durableAdmissionRecovery": "PASS_SEPARATE_OFFLINE_RUN", "budgetFeasibility": "All individual attempts and two-role concurrent reservations fit approved ceilings; completion within ceilings is not guaranteed; unknown outcomes retain exposure", "networkAttempts": len(network_attempts), "paidCalls": 0}
output_file.write_text(json.dumps(result, indent=2, default=str) + "\n")
print(json.dumps({k: result[k] for k in ["status", "candidateSha", "runId", "bindingCount", "remainingValiditySeconds", "networkAttempts", "paidCalls"]}))
