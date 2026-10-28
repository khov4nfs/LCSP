#!/usr/bin/env python3
"""User-run live broker/server preparation of the reviewed synthetic legal_source fixture.

Only legal_source/index preconditions are seeded; the real agent must author and activate
the rule_set. This does not prove official acquisition or legal semantic quality.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import UUID, uuid4, uuid5

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_staging", ROOT / "tests/staging-stack.py")
assert spec and spec.loader
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)
require = staging.require


def quote(value: str) -> str:
    require("\0" not in value, "NUL in SQL fixture")
    return "'" + value.replace("'", "''") + "'"


def check_fixture(fixture: dict, pin: dict, raw: bytes) -> None:
    require(len(raw) == pin["byteLength"] and
            "sha256:" + hashlib.sha256(raw).hexdigest() == pin["sourceSha256"], "source pin mismatch")
    require(fixture["documentId"] == pin["documentId"] and
            fixture["sourceSha256"] == pin["sourceSha256"].removeprefix("sha256:"), "fixture identity mismatch")
    chunks = fixture["chunks"]
    require(len(chunks) == len(pin["chunkSha256"]) and
            {c["locator"] for c in chunks} == set(pin["chunkSha256"]), "fixture locators mismatch")
    for chunk in chunks:
        require(chunk["contentSha256"] == pin["chunkSha256"][chunk["locator"]] ==
                "sha256:" + hashlib.sha256(chunk["content"].encode()).hexdigest(), "chunk pin mismatch")


def fixture_input() -> tuple[dict, dict]:
    directory = ROOT / "deepagents/tests/fixtures/compliance_rule_set_context"
    pin = next(p for p in staging.json_file(directory / "pins.json")["sources"]
               if p["legalSourceVersion"] == "SYNTHETIC-LEGAL_SOURCE-V1")
    result = subprocess.run([sys.executable, str(ROOT / "deepagents/tests/vertical/fixture_chunks.py")],
                            cwd=ROOT, capture_output=True, text=True, check=True, timeout=30)
    fixture = json.loads(result.stdout)
    check_fixture(fixture, pin, (directory / pin["sourceFile"]).read_bytes())
    return fixture, pin


def verify_stack(stack, access: dict) -> None:
    manifest = stack.manifest
    accepted = staging.accepted_images(manifest["imageEvidence"])
    require(manifest["runId"] == stack.run_id and manifest["network"] == stack.prefix,
            "owned manifest identity mismatch")
    require(stack.docker("info", "--format", "{{.ID}}") == manifest["daemonId"], "Docker daemon changed")
    require(all(manifest["images"][role] == image for role, image in accepted.items()), "candidate image mismatch")
    require(manifest["images"]["bridge"] == accepted["worker"], "bridge image mismatch")
    for role, image in manifest["resources"].items():
        info = stack.inspect(f"{stack.prefix}-{role}")
        require(info and staging.owned_container(info, stack.run_id, role, image) and info["State"]["Running"],
                "owned service is missing, changed or stopped")
    require(set(manifest["resources"]) == {"postgres", "rabbitmq", "server", "api", "bridge", "web"},
            "incomplete staging stack")
    require(access["runId"] == stack.run_id and
            all(access[key] == stack.url(role, port) for key, role, port in
                (("api", "api", 8080), ("web", "web", 8080), ("agentServer", "server", 8000))),
            "access endpoints differ from owned containers")
    require(stack.docker("exec", f"{stack.prefix}-server", "docker", "info", "--format", "{{.ID}}") == manifest["daemonId"],
            "Agent Server Docker daemon mismatch")


def api(access: dict, route: str, body: dict | None = None) -> tuple[int, dict]:
    request = Request(access["api"] + "/internal/compliance-rule-set/" + route,
                      data=None if body is None else json.dumps(body).encode(),
                      headers={"content-type": "application/json", "x-worker-api-key": access["workerKey"]},
                      method="GET" if body is None else "POST")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def activate_source(access: dict, legal_source_id: str, idempotency_key: str) -> dict:
    body = {"idempotencyKey": idempotency_key,
            "integrityManifestRef": "fixture-integrity:" + legal_source_id,
            "retrievalValidationRef": "fixture-index:" + legal_source_id}
    request = Request(access["api"] + "/internal/legal-sources/" + legal_source_id + "/activate-validated",
                      data=json.dumps(body).encode(), method="POST",
                      headers={"content-type": "application/json", "x-worker-api-key": access["workerKey"]})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
        require(response.status == 200 and result.get("ok") is True, "Legal Source activation failed")
        return result


def seed_sql(legal_source_id: str, version: str, fixture: dict, pin: dict, *, status: str = "DRAFT") -> str:
    require(status in {"DRAFT", "ACTIVE"}, "unsupported synthetic legal_source precondition status")
    document_id = str(uuid4())
    digest = hashlib.sha256(json.dumps(fixture, sort_keys=True).encode()).hexdigest()
    manifest = json.dumps({"synthetic": True, "scope": "RELEASE_REVIEWED_SYNTHETIC_PREPARATION_FIXTURE",
                           "sourceSha256": pin["sourceSha256"], "officialSourceAcquisition": "NOT_RUN"})
    statements = ["BEGIN; SET LOCAL standard_conforming_strings = on;",
        f'INSERT INTO "LegalSourceVersion"(id,version,status,"sourceManifest") VALUES '
        f'({quote(legal_source_id)},{quote(version)},{quote(status)},{quote(manifest)}::jsonb);',
        'INSERT INTO "LegalSourceDocument"(id,"legalSourceVersionId","documentId",title,"sourceUrl",'
        f'"sourceSha256","sourceEffectStatus") VALUES ({quote(document_id)},{quote(legal_source_id)},'
        f'{quote(pin["documentId"])},\'Reviewed synthetic notice\',\'https://example.invalid/release-synthetic\','
        f'{quote(pin["sourceSha256"])},{quote(pin["sourceEffectStatus"])});']
    for chunk in fixture["chunks"]:
        values = [f'{version}:{chunk["locator"]}', legal_source_id, document_id, pin["documentId"],
                  chunk["locator"], chunk["content"], chunk["contentSha256"], json.dumps(chunk["hierarchy"]), "IN_FORCE"]
        statements.append('INSERT INTO "LegalDocumentChunk"(id,"legalSourceVersionId","legalSourceDocumentId",'
                          '"documentId",locator,content,"contentSha256",hierarchy,"legalStatus") VALUES (' +
                          ",".join(quote(value) for value in values) + ');')
    # The existing eval's VALID index is a fixture precondition, not live Chroma/acquisition proof.
    statements.append('INSERT INTO "LegalRetrievalIndex"(id,"legalSourceVersionId",version,status,"configHash",'
                      '"contentHash","validationManifestRef","validatedAt") VALUES (' +
                      ",".join(quote(value) for value in [str(uuid4()), legal_source_id, "index-" + version, "VALID",
                                                        digest, digest, "fixture-index:" + legal_source_id]) + ',now()); COMMIT;')
    return "\n".join(statements)


def run(stack, access: dict) -> dict:
    verify_stack(stack, access)
    fixture, pin = fixture_input()
    control_path = stack.private / "rule-set-preparation-control.json"
    if not control_path.exists():
        require(stack.sql('SELECT count(*) FROM "LegalSourceVersion";') == "0" and
                stack.sql('SELECT count(*) FROM "RuleSetPreparationRun";') == "0", "fresh fixture scope is not empty")
        control = {"legalSourceId": str(uuid4()), "version": f"release-synthetic-{stack.run_id}",
                   "idempotencyKey": f"release-staging-legal-{stack.run_id}"}
        staging.write_json(control_path, control, private=True)
    control = staging.json_file(control_path)
    legal_source_id = str(UUID(control["legalSourceId"]))
    require(control["version"] == f"release-synthetic-{stack.run_id}" and
            control["idempotencyKey"] == f"release-staging-legal-{stack.run_id}", "fixture control mismatch")
    exists = stack.sql(f'SELECT count(*) FROM "LegalSourceVersion" WHERE id={quote(legal_source_id)};')
    if exists == "0":
        require(stack.sql('SELECT count(*) FROM "LegalSourceVersion";') == "0", "foreign legal_source refused")
        stack.sql(seed_sql(legal_source_id, control["version"], fixture, pin))
    stored = json.loads(stack.sql('SELECT json_agg(json_build_object(\'locator\',locator,\'hash\',"contentSha256",'
                                 '\'content\',content) ORDER BY locator) FROM "LegalDocumentChunk" '
                                 f'WHERE "legalSourceVersionId"={quote(legal_source_id)};'))
    require(stored == sorted([{"locator": c["locator"], "hash": c["contentSha256"], "content": c["content"]}
                             for c in fixture["chunks"]], key=lambda c: c["locator"]), "persisted fixture changed")
    document = json.loads(stack.sql('SELECT row_to_json(d) FROM (SELECT "documentId","sourceSha256",'
                                   f'"sourceEffectStatus" FROM "LegalSourceDocument" WHERE "legalSourceVersionId"={quote(legal_source_id)}) d;'))
    require(document == {key: pin[key] for key in ("documentId", "sourceSha256", "sourceEffectStatus")},
            "persisted source pin changed")
    response = activate_source(access, legal_source_id, control["idempotencyKey"])
    staging.write_json(stack.private / "legal-source-activation.json", response, private=True)
    replay = activate_source(access, legal_source_id, control["idempotencyKey"])
    require(replay["data"]["result"]["outboxEventRef"] == response["data"]["result"]["outboxEventRef"], "source activation replay changed event")
    deadline = time.monotonic() + 60
    while True:
        runs = json.loads(stack.sql('SELECT coalesce(json_agg(id),\'[]\') FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"=' + quote(legal_source_id) + ';'))
        if runs:
            require(len(runs) == 1, "activation created duplicate preparations")
            run_id = str(UUID(runs[0]))
            break
        require(time.monotonic() < deadline, "activation event did not start preparation")
        time.sleep(1)
    print(f"Observing real preparation {run_id}; 20-minute observer deadline, no runtime cancellation", flush=True)
    query = ('SELECT row_to_json(r) FROM (SELECT p."executionState",p."failureReason",p."correlationId",'
             'p."outboxEventId",v.id AS "rule_setId",v."lifecycleState",v."validationOutcome",'
             'o.status AS "outboxStatus" FROM "RuleSetPreparationRun" p '
             'LEFT JOIN "ComplianceRuleSetVersion" v ON v."preparationRunId"=p.id '
             'LEFT JOIN "OutboxMessage" o ON o.id=p."outboxEventId" '
             f'WHERE p.id={quote(run_id)}) r;')
    deadline, last_print = time.monotonic() + 1200, 0.0
    while True:
        state = json.loads(stack.sql(query))
        staging.write_json(stack.private / "legal-terminal-state.json", state, private=True)
        if state["executionState"] in {"SUCCEEDED", "FAILED"}:
            break
        require(time.monotonic() < deadline, "observer deadline reached; run continues, rerun to reattach")
        if time.monotonic() - last_print >= 30:
            print(f"Preparation state: {state['executionState']}; outbox: {state['outboxStatus']}", flush=True)
            last_print = time.monotonic()
        time.sleep(3)
    require(state["executionState"] == "SUCCEEDED" and state["lifecycleState"] == "ACTIVE" and
            state["validationOutcome"] == "PASSED" and state["outboxStatus"] == "PUBLISHED",
            "preparation did not activate a valid rule_set; see private diagnostics")
    status, active = api(access, "active")
    staging.write_json(stack.private / "legal-active-rule_set.json", active, private=True)
    require(status == 200 and active.get("ok") is True and active["data"]["ruleSetVersionId"] == state["rule_setId"],
            "ACTIVE API differs from persisted rule_set")
    namespace = UUID("b7b26975-09de-44e5-a7d5-c996523fd289")
    thread = str(uuid5(namespace, f"event:rule_set_preparation_requested:{state['correlationId']}"))
    checkpoints = int(stack.sql(f"SELECT count(*) FROM checkpoints WHERE thread_id={quote(thread)};", "lcsp_langgraph"))
    require(checkpoints > 0, "native Agent Server checkpoint absent")
    require(stack.sql(f'SELECT count(*) FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"={quote(legal_source_id)};') == "1",
            "duplicate logical preparation")
    require(stack.sql(f'SELECT count(*) FROM "ComplianceRuleSetActivationRecord" WHERE "preparationRunId"={quote(run_id)};') == "1",
            "expected one governed activation")
    stack.capture_logs()
    verify_stack(stack, access)
    data = active["data"]
    return {"scope": "RELEASE_EXACT_IMAGE_LIVE_BROKER_SERVER_SYNTHETIC_PREPARATION", "status": "PASS_RUNTIME_MECHANICS",
            "runId": stack.run_id, "preparationRunId": run_id, "ruleSetVersionId": state["rule_setId"],
            "legalSourceVersionId": legal_source_id, "sourceSha256": pin["sourceSha256"], "sourceChunks": len(stored),
            "legalRequirements": len(data["legalRequirements"]), "assessmentRules": len(data["assessmentRules"]),
            "contextRelations": len(data["contextRelations"]), "nativeCheckpointCount": checkpoints,
            "legalSourceActivationReplay": "PASS", "automaticPreparation": True, "outboxPublished": True, "governedActivationCount": 1,
            "images": stack.manifest["images"], "semanticReview": "REQUIRED",
            "rubric": "deepagents/tests/fixtures/rule_set_preparation_eval/rubric.json",
            "legalSourceAndIndexSeeding": "REVIEWED_SYNTHETIC_FIXTURE_PRECONDITIONS",
            "officialSourceAcquisition": "NOT_RUN", "liveRetrievalIndex": "NOT_RUN",
            "failedAttemptPreservesPreviousActive": "NOT_RUN", "frozen25RowStagingMatrix": "NOT_PROVEN",
            "productionDeployment": False, "releaseEligible": False}


def self_check(image_evidence: str | Path) -> None:
    fixture, pin = fixture_input()
    raw = (ROOT / "deepagents/tests/fixtures/compliance_rule_set_context" / pin["sourceFile"]).read_bytes()
    for mutated in (raw + b"x", raw.replace(b"7 days", b"9 days")):
        try:
            check_fixture(fixture, pin, mutated)
        except RuntimeError:
            pass
        else:
            raise AssertionError("tampered source accepted")
    altered = json.loads(json.dumps(fixture))
    altered["chunks"][0]["content"] += " changed"
    try:
        check_fixture(altered, pin, raw)
    except RuntimeError:
        pass
    else:
        raise AssertionError("tampered chunk accepted")
    sql = seed_sql(str(uuid4()), "test'fixture", fixture, pin)
    assert "test''fixture" in sql and sql.startswith("BEGIN;") and sql.endswith("COMMIT;")
    assert '"ComplianceRuleSetVersion"' not in sql and '"RuleSetPreparationRun"' not in sql and "ACTIVE" not in sql
    assert len(staging.accepted_images(image_evidence)) == 4
    accepted = {role: "sha256:" + "a" * 64 for role in ("api", "web", "worker", "server")}
    run_id = "a" * 16
    prefix = f"lcsp-release-staging-{run_id}"
    images = {**accepted, "bridge": accepted["worker"], "postgres": "pg", "rabbitmq": "mq"}
    resources = {role: image for role, image in images.items() if role != "worker"}
    info = {"Name": f"/{prefix}-api", "Image": accepted["api"], "Config": {"Labels": {staging.OWNER_LABEL: run_id}},
            "State": {"Running": True}}
    access = {"runId": run_id, "api": "http://localhost:1", "web": "http://localhost:2", "agentServer": "http://localhost:3"}
    fake = SimpleNamespace(run_id=run_id, prefix=prefix, manifest={"runId": run_id, "network": prefix,
                           "imageEvidence": image_evidence,
                           "images": images, "resources": resources, "daemonId": "owned"},
                           docker=Mock(return_value="owned"),
                           inspect=Mock(side_effect=lambda name: {**info, "Name": "/" + name,
                                        "Image": resources[name.removeprefix(prefix + "-")]}),
                           url=lambda role, port: access[{"api": "api", "web": "web", "server": "agentServer"}[role]])
    with patch.object(staging, "accepted_images", return_value=accepted) as accepted_images_check:
        verify_stack(fake, access)
        accepted_images_check.assert_called_once_with(image_evidence)
        for mutate, restore in (
            (lambda: fake.docker.configure_mock(return_value="foreign"), lambda: fake.docker.configure_mock(return_value="owned")),
            (lambda: info["State"].update(Running=False), lambda: info["State"].update(Running=True)),
            (lambda: info["Config"]["Labels"].update({staging.OWNER_LABEL: "foreign"}),
             lambda: info["Config"]["Labels"].update({staging.OWNER_LABEL: run_id})),
        ):
            mutate()
            try:
                verify_stack(fake, access)
            except RuntimeError:
                pass
            else:
                raise AssertionError("foreign or stopped stack accepted")
            finally:
                restore()
        bad_access = {**access, "api": "http://production.invalid"}
        original_url = fake.url
        fake.url = lambda role, port: access[{"api": "api", "web": "web", "server": "agentServer"}[role]]
        try:
            verify_stack(fake, bad_access)
        except RuntimeError:
            pass
        else:
            raise AssertionError("foreign endpoint accepted")
        finally:
            fake.url = original_url
    print("PASS — candidates, pinned-byte tamper rejection, legal_source-only transaction, daemon/service/label/endpoint guards")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id", nargs="?")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--image-evidence", help="repository-relative accepted release image evidence directory")
    args = parser.parse_args()
    if args.self_check:
        self_check(args.image_evidence)
        return 0
    require(bool(args.run_id), "owned staging run ID required")
    stack = staging.Stack(args.run_id)
    stack.manifest = staging.json_file(stack.private / "stack.json")
    access = staging.json_file(stack.private / "access.json")
    try:
        report = run(stack, access)
    except Exception as error:
        staging.write_json(stack.private / "legal-observer-error.json", {"type": type(error).__name__,
                           "traceback": traceback.format_exc()}, private=True)
        report = {"scope": "RELEASE_EXACT_IMAGE_LIVE_BROKER_SERVER_SYNTHETIC_PREPARATION", "status": "FAIL",
                  "runId": stack.run_id, "exceptionType": type(error).__name__,
                  "privateDiagnostics": str(stack.private.relative_to(ROOT)), "runtimeCancellation": False,
                  "semanticReview": "NOT_PROVEN", "productionDeployment": False, "releaseEligible": False}
    staging.write_json(stack.evidence / "rule-set-preparation.json", report)
    print(json.dumps(report, indent=2))
    print(f"Evidence directory: {stack.evidence}")
    return 0 if report["status"] == "PASS_RUNTIME_MECHANICS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
