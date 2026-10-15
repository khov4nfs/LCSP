#!/usr/bin/env python3
"""Run a live Preparation from an API-ingested synthetic Legal Source fixture.

The disposable application creates and validates the source; the real agent must author
and activate the Rule Set. This does not prove official acquisition or legal quality.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import secrets
import signal
import socket
import subprocess
from pathlib import Path
import time
import traceback
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from uuid import UUID, uuid5

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_staging", ROOT / "tests/staging-stack.py")
assert spec and spec.loader
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)
require = staging.require
MINI_FIXTURE_PATH = ROOT / "tests/fixtures/lcsp360-mini-fixture.txt"
SOURCE_EFFECT_STATUS = "EFFECTIVE"
SOURCE_STATUS_REF = "LCSP-360-MINI-FIXTURE"
EXPECTED_LOCATORS = tuple(f"art-{number}" for number in range(1, 7))


def quote(value: str) -> str:
    require("\0" not in value, "NUL in SQL fixture")
    return "'" + value.replace("'", "''") + "'"


def fixture_input() -> tuple[bytes, dict]:
    raw = MINI_FIXTURE_PATH.read_bytes()
    text = raw.decode("utf-8")
    require("SYNTHETIC TEST FIXTURE" in text, "mini source is not marked synthetic")
    require(all(f"Article {number}." in text for number in range(1, 7)),
            "mini source must contain six numbered articles")
    require(all(fragment in text for fragment in (
        "Covered Organization means", "Protected Record means", "more than 1,000",
        "once every 12 months", "no more than 30 days", "MINI-002 still applies",
        "Where MINI-003 applies", "available to affected individuals",
    )), "mini source is missing a required fixture provision")
    return raw, {
        "sourceSha256": "sha256:" + hashlib.sha256(raw).hexdigest(),
        "sourceEffectStatus": SOURCE_EFFECT_STATUS,
        "sourceRef": SOURCE_STATUS_REF,
        "expectedLocators": list(EXPECTED_LOCATORS),
    }


def verify_stack(stack, access: dict) -> None:
    stack.verify(access)


def worker_api(access: dict, route: str, body: dict | None = None) -> tuple[int, dict]:
    request = Request(access["api"] + "/internal/" + route,
                      data=None if body is None else json.dumps(body).encode(),
                      headers={"content-type": "application/json", "x-worker-api-key": access["workerKey"]},
                      method="GET" if body is None else "POST")
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def api(access: dict, route: str, body: dict | None = None) -> tuple[int, dict]:
    return worker_api(access, "compliance-rule-set/" + route, body)


def admin_request(access: dict, token: str | None, route: str, *, method: str,
                  body: dict | bytes | None = None, content_type: str = "application/json") -> tuple[int, dict]:
    if isinstance(body, bytes):
        data = body
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    headers = {"content-type": content_type} if data is not None else {}
    if token:
        headers["authorization"] = "Bearer " + token
    request = Request(access["api"] + route, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Legal Source admin request returned HTTP {error.code}") from None


def admin_data(access: dict, token: str, route: str, *, method: str = "GET",
               body: dict | bytes | None = None, content_type: str = "application/json") -> dict:
    status, result = admin_request(access, token, route, method=method, body=body,
                                   content_type=content_type)
    require(200 <= status < 300 and result.get("ok") is True and isinstance(result.get("data"), dict),
            f"Legal Source admin request failed with HTTP {status}")
    return result["data"]


def admin_session(access: dict) -> str:
    account = access["accounts"]["admin"]
    status, result = admin_request(access, None, "/auth/sign-in", method="POST",
                                   body={"email": account["email"], "password": account["password"]})
    token = result.get("data", {}).get("session_token")
    require(status == 200 and result.get("ok") is True and isinstance(token, str) and token,
            "disposable fixture admin sign-in failed")
    return token


def effect_status_request(pin: dict) -> dict:
    return {"status": pin["sourceEffectStatus"], "sourceRef": pin["sourceRef"]}


def source_status_preflight(version: dict, document: dict, chunks: dict, pin: dict) -> dict:
    require(version.get("status") in {"DRAFT", "ACTIVE"}, "mini source version is not activatable")
    require(document.get("ingestionState") == "READY", "mini source document is not READY")
    require(document.get("sourceSha256") == pin["sourceSha256"], "mini source digest changed")
    require(document.get("sourceEffectStatus") == pin["sourceEffectStatus"],
            "mini source document effect status is not established")
    items = chunks.get("items")
    require(isinstance(items, list) and chunks.get("total") == len(items) == len(pin["expectedLocators"]),
            "mini source chunk set is incomplete")
    require({item.get("locator") for item in items} == set(pin["expectedLocators"]),
            "mini source locators differ from the fixture")
    require(all(item.get("legalEffectStatus") == pin["sourceEffectStatus"] and
                item.get("legalStatusSourceRef") == pin["sourceRef"] for item in items),
            "mini source status provenance is missing or undetermined")
    index = version.get("index")
    require(isinstance(index, dict) and index.get("status") == "VALID" and
            isinstance(index.get("contentHash"), str) and index["contentHash"].startswith("sha256:"),
            "mini source structural validation is not valid")
    return {
        "legalSourceId": version["source"]["id"],
        "legalSourceVersionId": version["id"],
        "documentRowId": document["id"],
        "sourceSha256": pin["sourceSha256"],
        "sourceEffectStatus": pin["sourceEffectStatus"],
        "sourceStatusRef": pin["sourceRef"],
        "sourceStatusProvenance": "PRESENT",
        "chunkCount": len(items),
        "locators": sorted(item["locator"] for item in items),
        "structuralIndexStatus": index["status"],
        "syntheticTestFixture": True,
        "preparationGate": "PASS",
    }


def structural_activation_refs(index: dict) -> dict:
    content_hash = index["contentHash"].removeprefix("sha256:")
    require(len(content_hash) == 64 and all(c in "0123456789abcdef" for c in content_hash),
            "structural index digest is invalid")
    return {
        "integrityManifestRef": "structural-integrity:" + content_hash,
        "retrievalValidationRef": "structural-validation:" + content_hash,
    }


def activate_source(access: dict, version_id: str, idempotency_key: str,
                    index: dict) -> dict:
    body = {"idempotencyKey": idempotency_key,
            **structural_activation_refs(index),
            "scopeDescription": "SYNTHETIC TEST FIXTURE; not real legislation"}
    status, result = worker_api(access, f"legal-sources/{version_id}/activate-validated", body)
    require(status == 200 and result.get("ok") is True, "Legal Source activation failed")
    return result


def run(stack, access: dict) -> dict:
    verify_stack(stack, access)
    raw, pin = fixture_input()
    control_path = stack.private / "rule-set-preparation-control.json"
    if not control_path.exists():
        require(stack.sql('SELECT count(*) FROM "LegalSourceVersion";') == "0" and
                stack.sql('SELECT count(*) FROM "RuleSetPreparationRun";') == "0", "fresh fixture scope is not empty")
        control = {"sourceSlug": f"lcsp360-mini-{stack.run_id}",
                   "idempotencyKey": f"release-staging-legal-{stack.run_id}"}
        staging.write_json(control_path, control, private=True)
    control = staging.json_file(control_path)
    require(control["sourceSlug"] == f"lcsp360-mini-{stack.run_id}" and
            control["idempotencyKey"] == f"release-staging-legal-{stack.run_id}", "fixture control mismatch")
    token = admin_session(access)
    if not control.get("legalSourceId"):
        source = admin_data(access, token, "/admin/legal-sources", method="POST", body={
            "name": f"SYNTHETIC TEST FIXTURE - LCSP-360 Mini Source {stack.run_id}",
            "slug": control["sourceSlug"],
            "description": "Synthetic test fixture for disposable Rule Set Preparation acceptance; not real legislation.",
        })
        control["legalSourceId"] = str(UUID(source["id"]))
        staging.write_json(control_path, control, private=True)
    legal_source_id = control["legalSourceId"]
    if not control.get("legalSourceVersionId"):
        version = admin_data(access, token, f"/admin/legal-sources/{legal_source_id}/versions",
                             method="POST", body={})
        control["legalSourceVersionId"] = str(UUID(version["id"]))
        staging.write_json(control_path, control, private=True)
    legal_source_version_id = control["legalSourceVersionId"]
    version_route = f"/admin/legal-source-versions/{legal_source_version_id}"
    version_detail = admin_data(access, token, version_route)
    require(version_detail.get("id") == legal_source_version_id and
            version_detail.get("source", {}).get("id") == legal_source_id,
            "mini source/version identity differs from the recorded fixture")
    document = next((item for item in version_detail["documents"]
                     if item.get("sourceSha256") == pin["sourceSha256"]), None)
    if document is None:
        query = urlencode({"fileName": "lcsp360-mini-fixture.txt",
                           "title": "SYNTHETIC TEST FIXTURE - LCSP-360 Mini Source",
                           "structureProfile": "ARTICLES"})
        document = admin_data(access, token,
                              f"{version_route}/documents/upload?{query}", method="POST",
                              body=raw, content_type="text/plain")
    document_row_id = str(UUID(document["id"]))
    control["documentRowId"] = document_row_id
    staging.write_json(control_path, control, private=True)
    deadline = time.monotonic() + 240
    while True:
        version_detail = admin_data(access, token, version_route)
        document = next((item for item in version_detail["documents"]
                         if item.get("id") == document_row_id), None)
        require(document is not None, "uploaded mini source document was not found")
        if document.get("ingestionState") == "READY":
            break
        if document.get("ingestionState") == "FAILED":
            raise RuntimeError("synthetic mini source ingestion failed")
        require(time.monotonic() < deadline, "synthetic mini source ingestion readiness timed out")
        time.sleep(1)
    if version_detail.get("status") == "DRAFT":
        admin_data(access, token,
                   f"{version_route}/documents/{document_row_id}/effect",
                   method="PATCH", body=effect_status_request(pin))
    version_detail = admin_data(access, token, version_route)
    require(version_detail.get("id") == legal_source_version_id and
            version_detail.get("source", {}).get("id") == legal_source_id,
            "mini source/version identity changed before activation")
    document = next((item for item in version_detail["documents"]
                     if item.get("id") == document_row_id), None)
    require(document is not None, "mini source document disappeared")
    chunks_query = urlencode({"page": 1, "pageSize": 100})
    chunks = admin_data(access, token,
                        f"{version_route}/documents/{document_row_id}/chunks?{chunks_query}")
    source_preflight = source_status_preflight(version_detail, document, chunks, pin)
    staging.write_json(stack.private / "source-status-preflight.json", source_preflight, private=True)
    index = version_detail["index"]
    require(stack.sql('SELECT count(*) FROM "RuleSetPreparationRun";') == "0" and
            stack.sql('SELECT count(*) FROM "AssessmentRuntimeEvent";') == "0" and
            stack.sql('SELECT count(*) FROM "LlmUsageEvent";') == "0", "model activity preceded the input gate")
    source_preflight["modelCallsBeforePreparation"] = 0
    staging.write_json(stack.private / "source-status-preflight.json", source_preflight, private=True)
    # An exclusive durable latch forbids a second activation from this harness.
    with (stack.private / "preparation-started").open("x") as latch:
        latch.write(legal_source_version_id + "\n")
    response = activate_source(access, legal_source_version_id, control["idempotencyKey"], index)
    staging.write_json(stack.private / "legal-source-activation.json", response, private=True)
    replay = activate_source(access, legal_source_version_id, control["idempotencyKey"], index)
    require(replay["data"]["result"]["outboxEventRef"] == response["data"]["result"]["outboxEventRef"], "source activation replay changed event")
    deadline = time.monotonic() + 60
    while True:
        runs = json.loads(stack.sql('SELECT coalesce(json_agg(id),\'[]\') FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"=' + quote(legal_source_version_id) + ';'))
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
        require(time.monotonic() < deadline, "observer deadline reached; inspect this run without starting another")
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
    require(stack.sql(f'SELECT count(*) FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"={quote(legal_source_version_id)};') == "1",
            "duplicate logical preparation")
    require(stack.sql(f'SELECT count(*) FROM "ComplianceRuleSetActivationRecord" WHERE "preparationRunId"={quote(run_id)};') == "1",
            "expected one governed activation")
    stack.capture_logs()
    verify_stack(stack, access)
    data = active["data"]
    return {"scope": "CANONICAL_NATIVE_DISPOSABLE_MINI_PREPARATION", "status": "PASS_RUNTIME_MECHANICS",
            "runId": stack.run_id, "preparationRunId": run_id, "ruleSetVersionId": state["rule_setId"],
            "legalSourceId": legal_source_id, "legalSourceVersionId": legal_source_version_id,
            "sourceSha256": pin["sourceSha256"], "sourceChunks": len(chunks["items"]),
            "legalRequirements": len(data["legalRequirements"]), "assessmentRules": len(data["assessmentRules"]),
            "contextRelations": len(data["contextRelations"]), "nativeCheckpointCount": checkpoints,
            "legalSourceActivationReplay": "PASS", "automaticPreparation": True, "outboxPublished": True, "governedActivationCount": 1,
            "canonicalSha": stack.manifest["sha"], "applicationImages": False, "semanticReview": "REQUIRED",
            "rubric": "deepagents/tests/fixtures/rule_set_preparation_eval/rubric.json",
            "sourceStatusPreflight": "PASS",
            "sourceEffectStatus": pin["sourceEffectStatus"],
            "sourceStatusRef": pin["sourceRef"],
            "legalSourceAndIndexLifecycle": "SUPPORTED_APPLICATION_APIS",
            "officialSourceAcquisition": "NOT_RUN", "liveRetrievalIndex": "NOT_RUN",
            "failedAttemptPreservesPreviousActive": "NOT_RUN", "frozen25RowStagingMatrix": "NOT_PROVEN",
            "productionDeployment": False, "releaseEligible": False}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def process_identity(pid: int) -> str | None:
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except FileNotFoundError:
        return None


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class NativeStack(staging.Stack):
    """Reuse owned infrastructure; run canonical application entry points directly."""

    def verify(self, access: dict) -> None:
        require(self.manifest["sha"] == git("rev-parse", "HEAD") ==
                git("rev-parse", "origin/fix/LCSP-360-corpus-driven-applicability"), "canonical SHA changed")
        require(not git("diff", "HEAD", "--name-only"), "tracked source changed")
        require(self.manifest["daemonId"] == self.docker("info", "--format", "{{.ID}}"), "Docker daemon changed")
        require(set(self.manifest["resources"]) == {"postgres", "rabbitmq"}, "unexpected application container")
        for role, image in self.manifest["resources"].items():
            info = self.inspect(f"{self.prefix}-{role}")
            require(info and staging.owned_container(info, self.run_id, role, image) and info["State"]["Running"],
                    "owned infrastructure changed or stopped")
            bindings = info["NetworkSettings"]["Ports"] or {}
            require(all(binding["HostIp"] == "127.0.0.1" for values in bindings.values() if values for binding in values),
                    "infrastructure is not loopback isolated")
        require(set(self.manifest["processes"]) == {"api", "server", "bridge"}, "incomplete native runtime")
        for item in self.manifest["processes"].values():
            require(process_identity(item["pid"]) == item["startTicks"], "native process changed or stopped")
        require(access["runId"] == self.run_id and
                all(access[key] == self.manifest[key] for key in ("api", "agentServer")), "foreign endpoint refused")
        require(staging.http_ok(access["api"] + "/health") and staging.http_ok(access["agentServer"] + "/ok"),
                "native runtime health failed")

    def launch(self, role: str, command: list[str], env: dict, cwd: Path) -> None:
        staging.write_json(self.private / f"{role}-environment.json", env, private=True)
        with (self.private / f"{role}.log").open("ab") as log:
            process = subprocess.Popen(command, env={**self.host_env, **env}, cwd=cwd,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.manifest["processes"][role] = {"pid": process.pid, "startTicks": process_identity(process.pid),
                                             "command": command, "cwd": str(cwd)}
        self.save()

    def wait_native(self, role: str, check) -> None:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            item = self.manifest["processes"][role]
            require(process_identity(item["pid"]) == item["startTicks"], f"native {role} exited; see private log")
            try:
                if check():
                    return
            except (OSError, RuntimeError):
                pass
            time.sleep(1)
        raise RuntimeError(f"native {role} readiness timed out")

    def start_native(self) -> dict:
        require(git("branch", "--show-current") == "fix/LCSP-360-corpus-driven-applicability", "wrong branch")
        require(not git("diff", "HEAD", "--name-only"), "commit source before native launch")
        sha = git("rev-parse", "HEAD")
        require(sha == git("rev-parse", "origin/fix/LCSP-360-corpus-driven-applicability"), "push source before native launch")
        self.private.mkdir(parents=True, mode=0o700, exist_ok=False)
        self.private.chmod(0o700)
        self.evidence.mkdir(parents=True, exist_ok=False)
        (self.private / "commands.log").touch(mode=0o600)
        infrastructure = {role: json.loads(self.docker("image", "inspect", tag))[0]["Id"] for role, tag in
                          (("postgres", "postgres:16"), ("rabbitmq", "rabbitmq:3.13-management"))}
        self.manifest = {"runId": self.run_id, "sha": sha, "network": self.prefix,
                         "daemonId": self.docker("info", "--format", "{{.ID}}"), "images": infrastructure,
                         "resources": {}, "processes": {}}
        self.save()
        self.docker("network", "create", "--label", f"{staging.OWNER_LABEL}={self.run_id}", self.prefix)
        provider = staging.provider_credentials(os.environ, staging.dotenv_values(ROOT / ".env"))
        envs = staging.environment(self.run_id, {"worker": "unused-native-mini-no-repository"}, provider)
        self.create("postgres", envs["postgres"], port=5432)
        self.wait("postgres", lambda: self.sql("SELECT 1;") == "1", target="isolated PostgreSQL")
        require(self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") == "0",
                "fresh isolated database is not empty")
        self.docker("exec", f"{self.prefix}-postgres", "createdb", "-U", "postgres", "lcsp_langgraph")
        self.create("rabbitmq", envs["rabbitmq"], port=5672)
        self.wait("rabbitmq", lambda: self.docker("exec", "--user", "rabbitmq", f"{self.prefix}-rabbitmq",
                  "rabbitmq-diagnostics", "-q", "ping") is not None, target="isolated RabbitMQ")
        pg_port = self.url("postgres", 5432).rsplit(":", 1)[1]
        mq_port = self.url("rabbitmq", 5672).rsplit(":", 1)[1]
        api_url, server_url = (f"http://127.0.0.1:{free_port()}" for _ in range(2))
        self.manifest.update(api=api_url, agentServer=server_url)
        self.save()
        for role in ("api", "server", "bridge"):
            env = envs[role]
            env["DATABASE_URL"] = env["DATABASE_URL"].replace(f"{self.prefix}-postgres:5432", f"127.0.0.1:{pg_port}")
            env["RABBITMQ_URL"] = env["RABBITMQ_URL"].replace(f"{self.prefix}-rabbitmq:5672", f"127.0.0.1:{mq_port}")
            env["LANGGRAPH_CHECKPOINT_DATABASE_URL"] = env["DATABASE_URL"].replace("/lcsp_staging?schema=public", "/lcsp_langgraph")
            env.update(NESTJS_API_BASE_URL=api_url, LCSP_AGENT_SERVER_URL=server_url,
                       LCSP_AGENT_RUNTIME_HOST="127.0.0.1",
                       LCSP_AGENT_RUNTIME_RECONCILE_STALE_RUNS="false")
            env["PORT"] = (api_url if role == "api" else server_url).rsplit(":", 1)[1]
            for key, name in (("LEGAL_SOURCE_STORAGE_ROOT", "legal-source"), ("LEGAL_CHROMA_PATH", "chroma"),
                              ("LCSP_ARTIFACT_STORAGE_PATH", "artifacts"), ("LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR", "snapshot-cache")):
                path = self.private / name
                path.mkdir(mode=0o700, exist_ok=True)
                env[key] = str(path)
            env["USAGE_RECOVERY_STORE_PATH"] = str(self.private / f"{role}-usage.sqlite3")
        # Local API dotenv discovery starts at cwd; blank config prevents loading real workspace credentials.
        (self.private / ".env.pm2").touch(mode=0o600)
        (self.private / ".env").touch(mode=0o600)
        for name, command in (
            ("migrations", ["pnpm", "--dir", str(ROOT / "apps/api"), "exec", "prisma", "migrate", "deploy"]),
            ("build", ["pnpm", "--dir", str(ROOT / "apps/api"), "build"]),
        ):
            with (self.private / f"{name}.log").open("wb") as log:
                subprocess.run(command, cwd=self.private, env={**self.host_env, **envs["api"]},
                               stdout=log, stderr=subprocess.STDOUT, check=True, timeout=300)
        migrations = self.sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')
        require(int(migrations) == len(list((ROOT / "apps/api/prisma/migrations").glob("*/migration.sql"))),
                "migration count differs from canonical source")
        python = str(ROOT / "deepagents/.venv/bin/python")
        self.launch("server", [python, "-m", "tools.common.capabilities.agent_runtime.local_server"], envs["server"], ROOT / "deepagents")
        self.wait_native("server", lambda: staging.http_ok(server_url + "/ok"))
        self.launch("api", ["node", str(ROOT / "apps/api/dist/src/main.js")], envs["api"], self.private)
        self.wait_native("api", lambda: staging.http_ok(api_url + "/health"))
        self.launch("bridge", [python, "-m", "tools.common.capabilities.agent_runtime.rabbitmq_consumer"], envs["bridge"], ROOT / "deepagents")

        def queues_ready() -> bool:
            output = self.docker("exec", "--user", "rabbitmq", f"{self.prefix}-rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "consumers")
            queues = {parts[0]: int(parts[1]) for line in output.splitlines()
                      if len(parts := line.split()) == 2 and parts[1].isdigit()}
            return all(queues.get(name) == 1 for name in staging.queue_names())

        self.wait_native("bridge", queues_ready)
        password = "MINI!" + secrets.token_hex(20)
        email = f"mini-admin-{self.run_id}@staging.invalid"
        access = {"runId": self.run_id, "api": api_url, "agentServer": server_url, "workerKey": envs["api"]["WORKER_API_KEY"]}
        status, body = admin_request(access, None, "/auth/sign-up", method="POST",
                                     body={"email": email, "password": password, "display_name": "SYNTHETIC MINI ADMIN"})
        require(status == 201 and body.get("ok") is True, "fixture account registration failed")
        user_id = str(UUID(body["data"]["user_id"]))
        # Bootstrap only the isolated test account; legal authority/status always uses normal APIs.
        require(self.sql(f'UPDATE "User" SET role=\'ADMIN\', "updatedAt"=now() WHERE id={quote(user_id)} '
                         f'AND role=\'CUSTOMER\' RETURNING id;').splitlines()[0] == user_id, "fixture admin promotion failed")
        access["accounts"] = {"admin": {"email": email, "password": password, "userId": user_id}}
        staging.write_json(self.private / "access.json", access, private=True)
        admin_session(access)
        self.verify(access)
        receipt = {"status": "READY", "sha": sha, "applicationImages": False, "migrations": int(migrations),
                   "readyConsumers": len(staging.queue_names()), "databaseIsolation": "FRESH_OWNED_CONTAINER",
                   "modelCalls": 0, "runId": self.run_id}
        staging.write_json(self.evidence / "readiness.json", receipt)
        return receipt

    def capture_logs(self) -> None:
        for table in ("RuleSetPreparationRun", "AssessmentRuntimeEvent", "ComplianceRuleSetVersion", "LlmUsageEvent"):
            data = self.sql(f'SELECT coalesce(json_agg(t),\'[]\') FROM "{table}" t;')
            staging.write_json(self.private / f"{table}.json", json.loads(data), private=True)

    def stop_native(self) -> dict:
        require(self.manifest["daemonId"] == self.docker("info", "--format", "{{.ID}}"), "Docker daemon changed")
        for role in ("bridge", "api", "server"):
            item = self.manifest.get("processes", {}).get(role)
            if item and process_identity(item["pid"]) is not None:
                require(process_identity(item["pid"]) == item["startTicks"] and os.getpgid(item["pid"]) == item["pid"],
                        "cleanup process identity mismatch")
                os.killpg(item["pid"], signal.SIGTERM)
                deadline = time.monotonic() + 30
                while process_identity(item["pid"]) is not None and time.monotonic() < deadline:
                    time.sleep(0.2)
                require(process_identity(item["pid"]) is None, "native process has not stopped")
        postgres = self.inspect(f"{self.prefix}-postgres")
        if postgres and postgres["State"]["Running"]:
            try:
                self.capture_logs()
            except RuntimeError:
                pass  # A launch failure may precede migrations.
        for role, image in self.manifest.get("resources", {}).items():
            info = self.inspect(f"{self.prefix}-{role}")
            if info:
                require(staging.owned_container(info, self.run_id, role, image), "cleanup container ownership mismatch")
                self.docker("rm", "-f", "-v", info["Id"])
        networks = self.docker("network", "ls", "--filter", f"label={staging.OWNER_LABEL}={self.run_id}", "--format", "{{.Name}}").splitlines()
        require(not networks or networks == [self.prefix], "cleanup network ownership mismatch")
        if networks:
            self.docker("network", "rm", self.prefix)
        return {"status": "STOPPED", "runId": self.run_id, "canonicalSha": self.manifest["sha"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "prepare", "stop", "self-check"))
    parser.add_argument("run_id", nargs="?")
    args = parser.parse_args()
    if args.action == "self-check":
        suite = subprocess.run([str(ROOT / "deepagents/.venv/bin/python"), "-m", "unittest", "discover",
                                "-s", "tests", "-p", "test_native_mini_preparation.py"], cwd=ROOT)
        return suite.returncode
    require(bool(args.run_id), "owned native run ID required")
    stack = NativeStack(args.run_id)
    if args.action != "start":
        stack.manifest = staging.json_file(stack.private / "stack.json")
    try:
        if args.action == "start":
            report = stack.start_native()
        elif args.action == "stop":
            report = stack.stop_native()
        else:
            require(not (stack.private / "preparation-started").exists(), "second mini activation refused")
            report = run(stack, staging.json_file(stack.private / "access.json"))
    except Exception as error:
        staging.write_json(stack.private / "native-error.json", {"type": type(error).__name__,
                           "traceback": traceback.format_exc()}, private=True)
        try:
            stack.capture_logs()
        except Exception:
            pass
        report = {"status": "FAIL", "runId": stack.run_id, "exceptionType": type(error).__name__,
                  "privateDiagnostics": str(stack.private.relative_to(ROOT))}
    staging.write_json(stack.evidence / f"{args.action}.json", report)
    print(json.dumps(report, indent=2))
    return int(report["status"] == "FAIL")


if __name__ == "__main__":
    raise SystemExit(main())
