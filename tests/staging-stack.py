#!/usr/bin/env python3
"""User-run disposable RELEASE staging, using the accepted candidate images unchanged."""
from __future__ import annotations

import argparse
import ast
import base64
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tempfile
import time
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
IMAGE_EVIDENCE = ROOT / "reports/release-images/20261012054358_c13bae52f1ac"
OWNER_LABEL = "lcsp.release-staging"
PROVIDER_KEYS = ("APX_API_KEY", "INCEPTION_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY")
HOST_KEYS = ("PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "DOCKER_HOST",
             "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR")
spec = importlib.util.spec_from_file_location("release_release_images", ROOT / "tests/release-images.py")
assert spec is not None and spec.loader is not None
images_gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images_gate)


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise RuntimeError(reason)


def json_file(path: Path) -> dict:
    require(not path.is_symlink(), "symlink refused")
    return json.loads(path.read_text())


def write_json(path: Path, value: dict, *, private: bool = False) -> None:
    require(not path.is_symlink(), "symlink refused")
    path.write_text(json.dumps(value, indent=2) + "\n")
    if private:
        path.chmod(0o600)


def accepted_images() -> dict[str, str]:
    receipt = json_file(IMAGE_EVIDENCE / "report.json")
    require(receipt.get("status") == "PASS" and receipt.get("exitCode") == 0,
            "accepted image gate is required")
    images_gate.check_junit(IMAGE_EVIDENCE / "docker-junit.xml")
    frozen = json_file(IMAGE_EVIDENCE / "candidate-source.json")
    require(images_gate.sources() == frozen["source"], "candidate source changed; revalidate images")
    for name, sha in frozen["buildAndPolicyInputs"].items():
        require(images_gate.digest((ROOT / name).read_bytes()) == sha, "candidate build input changed")
    retired = json_file(ROOT / "tests/fixtures/retired-image-paths.json")["paths"]
    require(all(not (ROOT / name).exists() for name in retired), "retired path returned")
    result = {}
    for role in images_gate.IMAGES:
        item = receipt["images"][role]
        audit = json_file(IMAGE_EVIDENCE / f"{role}-rootfs.json")
        require(item["mergedRootfs"] == audit["status"] == "PASS" and not audit["violations"],
                "merged-rootfs audit must pass")
        require(bool(re.fullmatch(r"sha256:[0-9a-f]{64}", item["imageId"])), "invalid image ID")
        result[role] = item["imageId"]
    return result


def provider_credentials(process: dict, file_values: dict) -> dict[str, str]:
    result = {name: str(process.get(name, file_values.get(name)) or "").strip()
              for name in PROVIDER_KEYS}
    result = {name: value for name, value in result.items() if value}
    require(bool(result.get("APX_API_KEY")), "configured primary requires APX_API_KEY")
    require(all(not any(c in value for c in "\r\n\0") for value in result.values()),
            "provider credential must fit a Docker env-file line")
    return result


def queue_names() -> set[str]:
    tree = ast.parse((ROOT / "deepagents/tools/common/capabilities/agent_runtime/invocation.py").read_text())
    boundaries = next(node.value for node in tree.body if isinstance(node, ast.AnnAssign)
                      and isinstance(node.target, ast.Name) and node.target.id == "AGENT_INVOCATION_BOUNDARIES")
    names = {"lcsp.agent_runtime.boundary." + ast.literal_eval(call.args[0])
             for call in boundaries.elts}
    require(len(names) == 14, "review changed boundary manifest before staging")
    return names


def dropped_tables() -> list[str]:
    migration = ROOT / "apps/api/prisma/migrations/20261008160000_w7_drop_v1_authority/migration.sql"
    names = re.findall(r'DROP TABLE "([A-Za-z0-9_]+)";', migration.read_text())
    require(len(names) == 29 and len(set(names)) == 29, "review changed V1 drop manifest before staging")
    return names


def environment(run_id: str, image_ids: dict, provider: dict) -> dict[str, dict[str, str]]:
    prefix = f"lcsp-release-staging-{run_id}"
    db_password, broker_password, worker_key = (secrets.token_hex(32) for _ in range(3))
    database = f"postgresql://postgres:{db_password}@{prefix}-postgres:5432/lcsp_staging?schema=public"
    broker = f"amqp://release:{broker_password}@{prefix}-rabbitmq:5672/"
    common = {
        "NODE_ENV": "production", "PYTHON_DOTENV_DISABLED": "1",
        "DATABASE_URL": database, "RABBITMQ_URL": broker, "RABBITMQ_EXCHANGE": "lcsp.events",
        "NESTJS_API_BASE_URL": f"http://{prefix}-api:8080", "WORKER_API_KEY": worker_key,
        "LCSP_AGENT_SERVER_URL": f"http://{prefix}-server:8000",
        "LCSP_AGENT_RUNTIME_MODE": "production", "LCSP_REPOSITORY_SANDBOX_IMAGE": image_ids["worker"],
        "LANGGRAPH_CHECKPOINT_DATABASE_URL": database.replace("/lcsp_staging?schema=public", "/lcsp_langgraph"),
        "LEGAL_SOURCE_STORAGE_ROOT": "/app/.legal-source", "LEGAL_CHROMA_PATH": "/app/.chroma",
        "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false",
        "LCSP_ENABLE_REMOTE_MCP": "false", "LCSP_REPOSITORY_SANDBOX_CLEANUP_ON_START": "false",
        "LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH": "2",
    }
    return {
        "postgres": {"POSTGRES_USER": "postgres", "POSTGRES_PASSWORD": db_password, "POSTGRES_DB": "lcsp_staging"},
        "rabbitmq": {"RABBITMQ_DEFAULT_USER": "release", "RABBITMQ_DEFAULT_PASS": broker_password,
                     "RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS": "-rabbit consumer_timeout undefined"},
        "api": {
            **common, "PORT": "8080", "LCSP_ARTIFACT_STORAGE_PATH": "/app/.artifacts",
            "LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR": "/app/.snapshot-cache",
            "GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION": "release-disposable",
            "GITHUB_CLI_CREDENTIAL_KEK_KEYRING": json.dumps({"release-disposable": base64.b64encode(secrets.token_bytes(32)).decode()}),
            "MFA_SECRET_ENCRYPTION_KEY": secrets.token_hex(32), "SEPAY_WEBHOOK_SECRET": secrets.token_hex(32),
            "BILLING_SEPAY_BANK_NAME": "RELEASE-DISPOSABLE", "BILLING_SEPAY_BANK_ACCOUNT_NUMBER": "RELEASE-0000",
            "BILLING_SEPAY_ACCOUNT_HOLDER": "RELEASE DISPOSABLE FIXTURE",
            "BILLING_SEPAY_QR_URL_TEMPLATE": "https://example.invalid/release?amount={amountVnd}&code={paymentCode}",
        },
        "server": {**common, **provider, "PORT": "8000", "USAGE_RECOVERY_STORE_PATH": "/app/tmp/server-usage.sqlite3"},
        "bridge": {**common, **provider, "LCSP_AGENT_RUNTIME_ROLE": "bridge",
                   "USAGE_RECOVERY_STORE_PATH": "/app/tmp/bridge-usage.sqlite3"},
        "web": {"NODE_ENV": "production", "LCSP_API_BASE_URL": f"http://{prefix}-api:8080",
                "NEXT_TELEMETRY_DISABLED": "1"},
    }


def owned_container(info: dict, run_id: str, role: str, image_id: str) -> bool:
    return (info.get("Name") == f"/lcsp-release-staging-{run_id}-{role}"
            and (info.get("Config", {}).get("Labels") or {}).get(OWNER_LABEL) == run_id
            and info.get("Image") == image_id)


def owned_sandbox(info: dict, thread: str, image_id: str, baseline: set[str]) -> bool:
    sha = hashlib.sha256(thread.encode()).hexdigest()
    labels = info.get("Config", {}).get("Labels") or {}
    return (info.get("Id") not in baseline and info.get("Name") == f"/lcsp-repository-sandbox-{sha[:24]}"
            and labels.get("lcsp.repository-sandbox") == "true" and labels.get("lcsp.thread-id") == sha
            and labels.get("lcsp.sandbox-image") == image_id and info.get("Image") == image_id
            and not info.get("Mounts"))


class Stack:
    def __init__(self, run_id: str):
        require(bool(re.fullmatch(r"[0-9a-f]{16}", run_id)), "invalid owned run ID")
        self.run_id = run_id
        self.prefix = f"lcsp-release-staging-{run_id}"
        self.private = ROOT / "tmp/staging" / run_id
        self.evidence = ROOT / "reports/staging" / run_id
        for path in (self.private, self.evidence):
            require(not any(parent.is_symlink() for parent in [path, *path.parents]), "symlink refused")
        self.host_env = {name: os.environ[name] for name in HOST_KEYS if name in os.environ}
        self.manifest = {}

    def command(self, args: list[str], *, input: str | None = None, timeout: int = 60) -> str:
        result = subprocess.run(args, cwd=ROOT, env=self.host_env, input=input, text=True,
                                capture_output=True, timeout=timeout)
        # Private diagnostics can contain DB URLs or customer content; never copy them to evidence/stdout.
        with (self.private / "commands.log").open("a") as log:
            log.write(result.stdout + result.stderr)
        require(result.returncode == 0, "command failed; see private diagnostics")
        return result.stdout.strip()

    def docker(self, *args: str, **kwargs) -> str:
        return self.command(["docker", *args], **kwargs)

    def save(self) -> None:
        write_json(self.private / "stack.json", self.manifest, private=True)

    def inspect(self, name: str) -> dict | None:
        ids = self.docker("ps", "-aq", "--filter", f"name=^/{name}$").split()
        return json.loads(self.docker("inspect", ids[0]))[0] if ids else None

    def create(self, role: str, env: dict, *, port: int | None = None, mounts: tuple | list = ()) -> None:
        env_file = self.private / f"{role}.env"
        require(all(not any(c in value for c in "\r\n\0") for value in env.values()), "invalid env-file value")
        env_file.write_text("".join(f"{name}={value}\n" for name, value in env.items()))
        env_file.chmod(0o600)
        name = f"{self.prefix}-{role}"
        args = ["create", "--pull=never", "--name", name, "--network", self.prefix,
                "--label", f"{OWNER_LABEL}={self.run_id}", "--env-file", str(env_file)]
        if port is not None:
            args.extend(["--publish", f"127.0.0.1::{port}"])
        for source, target in mounts:
            args.extend(["--mount", f"type=bind,src={source},dst={target}"])
        image_id = self.manifest["images"][role]
        args.append(image_id)
        # Record planned names before creation so an interrupted launch is recoverable by --stop.
        self.manifest["resources"][role] = image_id
        self.save()
        self.docker(*args)
        info = self.inspect(name)
        require(info is not None and owned_container(info, self.run_id, role, image_id), "container ownership mismatch")
        bindings = info["HostConfig"]["PortBindings"] or {}
        require(all(binding["HostIp"] == "127.0.0.1" for values in bindings.values() for binding in values),
                "non-loopback port binding refused")
        self.docker("start", name)

    def wait(self, role: str, check, *, seconds: int = 180) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            info = self.inspect(f"{self.prefix}-{role}")
            require(info is not None and info["State"]["Running"], f"{role} exited before readiness")
            try:
                if check():
                    return
            except (RuntimeError, URLError, ConnectionError, TimeoutError):
                pass
            time.sleep(1)
        raise RuntimeError(f"{role} readiness timed out")

    def url(self, role: str, port: int) -> str:
        bindings = json.loads(self.docker("inspect", f"{self.prefix}-{role}"))[0]["NetworkSettings"]["Ports"][f"{port}/tcp"]
        require(len(bindings) == 1 and bindings[0]["HostIp"] == "127.0.0.1", "unexpected published address")
        return f"http://localhost:{int(bindings[0]['HostPort'])}"

    def sql(self, sql: str, database: str = "lcsp_staging") -> str:
        return self.docker("exec", "-i", f"{self.prefix}-postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                           "-U", "postgres", "-d", database, "-At", input=sql)

    def capture_logs(self) -> None:
        for role, image_id in self.manifest.get("resources", {}).items():
            info = self.inspect(f"{self.prefix}-{role}")
            if info and owned_container(info, self.run_id, role, image_id):
                self.docker("logs", "--tail", "2000", "--timestamps", info["Id"])

    def start(self, image_ids: dict, provider: dict) -> dict:
        self.private.mkdir(parents=True, mode=0o700, exist_ok=False)
        self.private.chmod(0o700)
        self.evidence.mkdir(parents=True, exist_ok=False)
        (self.private / "commands.log").touch(mode=0o600)
        daemon = self.docker("info", "--format", "{{.ID}}")
        endpoint = (self.host_env.get("DOCKER_HOST") if not self.host_env.get("DOCKER_CONTEXT") else None)
        endpoint = endpoint or self.docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}")
        require(endpoint.startswith("unix://") and stat.S_ISSOCK(Path(endpoint[7:]).stat().st_mode),
                "staging requires a local Unix Docker socket")
        for image_id in image_ids.values():
            require(json.loads(self.docker("image", "inspect", image_id))[0]["Id"] == image_id, "candidate image missing")
        infrastructure = {}
        for role, tag in (("postgres", "postgres:16"), ("rabbitmq", "rabbitmq:3.13-management")):
            if not self.docker("image", "ls", "-q", tag):
                self.docker("pull", tag, timeout=180)
            infrastructure[role] = json.loads(self.docker("image", "inspect", tag))[0]["Id"]
        self.manifest = {"runId": self.run_id, "daemonId": daemon, "network": self.prefix,
                         "images": {**image_ids, **infrastructure, "bridge": image_ids["worker"]},
                         "baselineContainers": self.docker("ps", "-aq", "--no-trunc").split(), "resources": {}}
        self.save()
        self.docker("network", "create", "--label", f"{OWNER_LABEL}={self.run_id}", self.prefix)
        envs = environment(self.run_id, image_ids, provider)
        self.create("postgres", envs["postgres"], port=5432)
        self.wait("postgres", lambda: self.docker("exec", f"{self.prefix}-postgres", "sh", "-c",
                  'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -h 127.0.0.1 -U postgres -d lcsp_staging -Atc "SELECT 1"') == "1")
        require(self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") == "0", "fresh DB is not empty")
        self.docker("exec", f"{self.prefix}-postgres", "createdb", "-U", "postgres", "lcsp_langgraph")
        self.create("rabbitmq", envs["rabbitmq"])
        self.wait("rabbitmq", lambda: self.docker("exec", "--user", "rabbitmq", f"{self.prefix}-rabbitmq", "rabbitmq-diagnostics", "-q", "ping") is not None)
        mount_map = {}
        for directory, target in (("legal_source", "/app/.legal-source"), ("chroma", "/app/.chroma"),
                                  ("runtime", "/app/tmp"), ("artifacts", "/app/.artifacts"),
                                  ("snapshot-cache", "/app/.snapshot-cache")):
            path = self.private / directory
            path.mkdir(mode=0o700)
            mount_map[directory] = (str(path), target)
        self.create("server", envs["server"], port=8000,
                    mounts=[mount_map[name] for name in ("legal_source", "chroma", "runtime")]
                    + [(endpoint[7:], "/var/run/docker.sock")])
        server_url = self.url("server", 8000)
        self.wait("server", lambda: http_ok(server_url + "/health"))
        require(self.docker("exec", f"{self.prefix}-server", "docker", "info", "--format", "{{.ID}}") == daemon,
                "Agent Server Docker daemon differs from owned staging daemon")
        self.create("api", envs["api"], port=8080, mounts=list(mount_map.values()))
        api_url = self.url("api", 8080)
        self.wait("api", lambda: http_ok(api_url + "/health"), seconds=240)
        # Fresh historical migrations must leave only V2 authority before any account/assessment is written.
        require(self.sql('SELECT count(*) FROM "Assessment";') == "0", "fresh assessment table is not empty")
        retired_names = ",".join("'" + name + "'" for name in dropped_tables())
        require(self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                         f"AND table_name IN ({retired_names});") == "0", "V1 tables survived staging migration")
        require(self.sql('SELECT count(*) FROM "_prisma_migrations" WHERE migration_name='
                         "'20261008160000_w7_drop_v1_authority' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;") == "1",
                "RELEASE migration was not applied by the API image")
        self.create("bridge", envs["bridge"], mounts=[mount_map[name] for name in ("legal_source", "chroma", "runtime")]
                    + [(mount_map["runtime"][0], "/app/deepagents/tmp")])
        def consumers_ready() -> bool:
            output = self.docker("exec", "--user", "rabbitmq", f"{self.prefix}-rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "consumers")
            queues = {parts[0]: int(parts[1]) for line in output.splitlines()
                      if len(parts := line.split()) == 2 and parts[1].isdigit()}
            return all(queues.get(name, 0) == 1 for name in queue_names())
        self.wait("bridge", consumers_ready)
        self.create("web", envs["web"], port=8080)
        web_url = self.url("web", 8080)
        self.wait("web", lambda: http_ok(web_url + "/sign-in"))
        accounts = {}
        for role in ("owner", "other", "admin"):
            password = "RELEASE!" + secrets.token_hex(20)
            email = f"release-{role}-{self.run_id}@staging.invalid"
            request = Request(api_url + "/auth/sign-up", data=json.dumps({"email": email,
                              "password": password, "display_name": f"RELEASE {role}"}).encode(),
                              headers={"content-type": "application/json"}, method="POST")
            with urlopen(request, timeout=30) as response:
                body = json.load(response)
            require(body.get("ok") is True, "fixture account registration failed")
            user_id = body["data"]["user_id"]
            require(str(UUID(user_id)) == user_id, "invalid fixture user identity")
            if role == "admin":
                require(self.sql(f'UPDATE "User" SET role=\'ADMIN\', "updatedAt"=now() WHERE id=\'{user_id}\' AND role=\'CUSTOMER\' RETURNING id;').splitlines()[0] == user_id,
                        "fixture admin promotion failed")
            accounts[role] = {"email": email, "password": password, "userId": user_id}
        pg_port = self.url("postgres", 5432).rsplit(":", 1)[1]
        access = {"runId": self.run_id, "api": api_url, "web": web_url, "agentServer": server_url,
                  "databaseUrl": envs["api"]["DATABASE_URL"].replace(f"{self.prefix}-postgres:5432", f"127.0.0.1:{pg_port}"),
                  "workerKey": "[REDACTED]", "accounts": accounts}
        write_json(self.private / "access.json", access, private=True)
        require(accepted_images() == image_ids, "candidate inputs changed during staging launch")
        return {"scope": "RELEASE_ISOLATED_VERIFIED_IMAGE_STAGING_READINESS", "status": "READY_FOR_ACCEPTANCE",
                "runId": self.run_id, "imageReceipt": str(IMAGE_EVIDENCE.relative_to(ROOT) / "report.json"),
                "images": self.manifest["images"], "api": api_url, "web": web_url, "agentServer": server_url,
                "readyBoundaryConsumers": 14, "retiredTablesAbsent": 29, "fixtureAccounts": 3,
                "liveModelAcceptance": "NOT_RUN",
                "stagingAcceptance": "NOT_PROVEN", "browserAcceptance": "NOT_PROVEN",
                "productionDeployment": False, "releaseEligible": False}

    def stop(self) -> dict:
        self.manifest = json_file(self.private / "stack.json")
        require(self.manifest["runId"] == self.run_id and self.manifest["network"] == self.prefix, "manifest identity mismatch")
        require(self.docker("info", "--format", "{{.ID}}") == self.manifest["daemonId"], "Docker daemon differs from launch")
        networks = self.docker("network", "ls", "--filter", f"label={OWNER_LABEL}={self.run_id}", "--format", "{{.Name}}").splitlines()
        require(not networks or networks == [self.prefix], "ambiguous labelled network; cleanup blocked")
        network_info = json.loads(self.docker("network", "inspect", self.prefix))[0] if networks else None
        if network_info:
            require(network_info["Name"] == self.prefix and network_info["Labels"].get(OWNER_LABEL) == self.run_id,
                    "network ownership mismatch")
        owned = {}
        for role, image_id in self.manifest["resources"].items():
            info = self.inspect(f"{self.prefix}-{role}")
            if info:
                require(owned_container(info, self.run_id, role, image_id), "cleanup container ownership mismatch")
                owned[role] = info
        require(not network_info or set(network_info["Containers"]) <= {info["Id"] for info in owned.values()},
                "foreign container on staging network; cleanup blocked")
        for role in ("bridge", "api", "server", "web"):
            if role in owned:
                self.docker("stop", "--time", "30", owned[role]["Id"])
        self.capture_logs()
        threads = set()
        if "postgres" in owned:
            if not owned["postgres"]["State"]["Running"]:
                self.docker("start", owned["postgres"]["Id"])
                self.wait("postgres", lambda: self.docker("exec", f"{self.prefix}-postgres", "pg_isready", "-U", "postgres") is not None)
            checkpoint_db_exists = self.sql("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='lcsp_langgraph');") == "t"
            if checkpoint_db_exists and self.sql("SELECT to_regclass('public.checkpoints') IS NOT NULL;", "lcsp_langgraph") == "t":
                threads.update(self.sql("SELECT DISTINCT thread_id FROM checkpoints;", "lcsp_langgraph").splitlines())
            if self.sql("SELECT to_regclass('public.\"AssessmentRuntime\"') IS NOT NULL;") == "t":
                threads.update(self.sql('SELECT "threadId" FROM "AssessmentRuntime";').splitlines())
        sandboxes = []
        for thread in threads:
            sha = hashlib.sha256(thread.encode()).hexdigest()
            info = self.inspect(f"lcsp-repository-sandbox-{sha[:24]}")
            if info:
                require(owned_sandbox(info, thread, self.manifest["images"]["worker"], set(self.manifest["baselineContainers"])),
                        "sandbox ownership mismatch; cleanup blocked")
                sandboxes.append(info["Id"])
        for container_id in sandboxes:
            self.docker("rm", "-f", container_id)
        for role in reversed(list(owned)):
            self.docker("rm", "-f", "-v", owned[role]["Id"])
        if network_info:
            self.docker("network", "rm", self.prefix)
        return {"scope": "RELEASE_OWNED_STAGING_TEARDOWN", "status": "STOPPED",
                "runId": self.run_id, "ownedContainersRemoved": len(owned), "ownedSandboxesRemoved": len(sandboxes),
                "sandboxScope": "OWNED_DATABASE_THREADS_EXCLUDING_PRELAUNCH_CONTAINERS",
                "privateEvidenceRetained": True, "productionDeployment": False}


def http_ok(url: str) -> bool:
    with urlopen(url, timeout=3) as response:
        return response.status == 200


def self_check() -> None:
    image_ids = accepted_images()
    provider = provider_credentials({"APX_API_KEY": "self-check-only", "DATABASE_URL": "must-not-inherit"},
                                    {"GOOGLE_API_KEY": "fallback", "WORKER_API_KEY": "must-not-inherit"})
    require(set(provider) == {"APX_API_KEY", "GOOGLE_API_KEY"}, "credential allowlist failed")
    envs = environment("0" * 16, image_ids, provider)
    require(envs["bridge"]["LCSP_AGENT_RUNTIME_ROLE"] == "bridge"
            and envs["bridge"]["LCSP_REPOSITORY_SANDBOX_CLEANUP_ON_START"] == "false", "unsafe bridge configuration")
    require("APX_API_KEY" not in envs["api"] and "DATABASE_URL" not in envs["web"], "credential leakage")
    require("lcsp-release-staging-" in envs["api"]["DATABASE_URL"] and len(queue_names()) == 14, "isolation failed")
    require(len(dropped_tables()) == 29, "retired table manifest failed")
    # Root CLI probes can create a root-only Erlang cookie before broker startup.
    broker_calls = [node for node in ast.walk(ast.parse(Path(__file__).read_text()))
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "docker" and any(isinstance(arg, ast.Constant)
                    and arg.value in ("rabbitmq-diagnostics", "rabbitmqctl") for arg in node.args)]
    require(len(broker_calls) == 2 and all([arg.value if isinstance(arg, ast.Constant) else None
            for arg in call.args[:3]] == ["exec", "--user", "rabbitmq"] for call in broker_calls),
            "broker CLI must run as rabbitmq to preserve cookie ownership")
    validation = subprocess.run(["node", "-e", """
const fs = require('node:fs');
const {createConfigValidationSchema} = require('./apps/api/dist/src/config/config.js');
const {signUpSchema} = require('@lcsp/contracts/auth');
const env = JSON.parse(fs.readFileSync(0, 'utf8'));
if (createConfigValidationSchema().validate(env).error) process.exit(1);
signUpSchema.parse({email: 'release-owner@staging.invalid', display_name: 'RELEASE owner', password: 'RELEASE!01234567890123456789'});
"""], cwd=ROOT, input=json.dumps(envs["api"]), text=True, capture_output=True, timeout=30)
    require(validation.returncode == 0, "production API configuration/account schema self-check failed")
    info = {"Id": "new", "Name": "/lcsp-release-staging-" + "0" * 16 + "-api",
            "Config": {"Labels": {OWNER_LABEL: "0" * 16}}, "Image": image_ids["api"]}
    require(owned_container(info, "0" * 16, "api", image_ids["api"]), "owned container rejected")
    for field in ("Name", "Image", "Config"):
        bad = deepcopy(info)
        bad[field] = {} if field == "Config" else "foreign"
        require(not owned_container(bad, "0" * 16, "api", image_ids["api"]), "foreign cleanup accepted")
    with tempfile.TemporaryDirectory(prefix="lcsp-release-staging-selfcheck-") as temporary:
        stack = Stack("0" * 16)
        stack.private = Path(temporary)
        stack.manifest = {"images": image_ids, "resources": {}}
        info["HostConfig"] = {"PortBindings": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": ""}]}}
        commands = []
        with patch.object(stack, "docker", side_effect=lambda *args: commands.append(args) or "owned"), patch.object(stack, "inspect", return_value=info):
            stack.create("api", envs["api"], port=8080)
            require("127.0.0.1::8080" in commands[0] and commands[0][-1] == image_ids["api"], "image/loopback planner failed")
            require(stat.S_IMODE((stack.private / "api.env").stat().st_mode) == 0o600, "env file is not private")
            info["HostConfig"]["PortBindings"]["8080/tcp"][0]["HostIp"] = "0.0.0.0"
            commands.clear()
            try:
                stack.create("api", envs["api"], port=8080)
            except RuntimeError:
                pass
            else:
                raise RuntimeError("public binding accepted")
            require(len(commands) == 1 and commands[0][0] == "create", "unsafe container started")
        with patch.object(stack, "inspect", return_value={"State": {"Running": True}}), \
                patch.object(time, "sleep"), patch.object(time, "monotonic", side_effect=[0, 0, 1]), \
                patch(__name__ + ".http_ok", side_effect=[ConnectionResetError("starting"), True]) as probe:
            stack.wait("server", lambda: http_ok("http://localhost/health"), seconds=2)
            require(probe.call_count == 2, "startup connection reset was not retried")
        with patch.object(stack, "inspect", return_value={"State": {"Running": True}}), \
                patch.object(time, "sleep"), patch.object(time, "monotonic", side_effect=[0, 0, 1, 2]), \
                patch(__name__ + ".http_ok", side_effect=ConnectionResetError("starting")):
            try:
                stack.wait("server", lambda: http_ok("http://localhost/health"), seconds=2)
            except RuntimeError as error:
                require(str(error) == "server readiness timed out", "unexpected readiness failure")
            else:
                raise RuntimeError("startup errors extended the readiness deadline")
        with patch.object(stack, "inspect", return_value={"State": {"Running": False}}), \
                patch(__name__ + ".http_ok") as probe:
            try:
                stack.wait("server", lambda: http_ok("http://localhost/health"))
            except RuntimeError as error:
                require(str(error) == "server exited before readiness", "unexpected container exit failure")
            else:
                raise RuntimeError("exited service accepted")
            require(probe.call_count == 0, "exited service was probed")
    with patch.object(images_gate, "sources", return_value={}):
        try:
            accepted_images()
        except RuntimeError:
            pass
        else:
            raise RuntimeError("stale candidate accepted")
    sha = hashlib.sha256(b"thread-self-check").hexdigest()
    sandbox = {"Id": "new", "Name": f"/lcsp-repository-sandbox-{sha[:24]}", "Image": image_ids["worker"],
               "Mounts": [], "Config": {"Labels": {"lcsp.repository-sandbox": "true", "lcsp.thread-id": sha,
                                                      "lcsp.sandbox-image": image_ids["worker"]}}}
    require(owned_sandbox(sandbox, "thread-self-check", image_ids["worker"], set()), "owned sandbox rejected")
    require(not owned_sandbox(sandbox, "thread-self-check", image_ids["worker"], {"new"}), "baseline sandbox cleanup accepted")
    sandbox["Mounts"] = [{"Type": "bind"}]
    require(not owned_sandbox(sandbox, "thread-self-check", image_ids["worker"], set()), "persistent sandbox cleanup accepted")
    for bad in ({}, {"APX_API_KEY": "line\nsecret"}):
        try:
            provider_credentials(bad, {})
        except RuntimeError:
            pass
        else:
            raise RuntimeError("invalid provider credential accepted")
    try:
        Stack("../outside")
    except RuntimeError:
        pass
    else:
        raise RuntimeError("unowned path accepted")
    print("PASS — accepted hashes/JUnit/rootfs, stale-candidate rejection, isolated env, credential allowlist, production API/account schemas, boundary/drop manifests, broker CLI user, readiness reset/recovery/deadline/exit, loopback/image planner, private files, cleanup ownership mutations; no Docker/model operation")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--self-check", action="store_true")
    mode.add_argument("--stop", metavar="RUN_ID")
    args = parser.parse_args()
    if args.self_check:
        self_check()
        return 0
    stack = Stack(args.stop or uuid4().hex[:16])
    stage = "preflight"
    try:
        if args.stop:
            stage = "owned teardown"
            report = stack.stop()
        else:
            image_ids = accepted_images()
            provider = provider_credentials(dict(os.environ), dotenv_values(ROOT / ".env", interpolate=False))
            stage = "isolated launch and readiness"
            report = stack.start(image_ids, provider)
        write_json(stack.evidence / ("teardown.json" if args.stop else "report.json"), report)
        print(json.dumps(report, indent=2))
        if not args.stop:
            print(f"Private access file: {stack.private / 'access.json'}")
            print(f"Stop command: rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop {stack.run_id}")
        print(f"Evidence directory: {stack.evidence}")
        return 0
    except (Exception, KeyboardInterrupt) as error:
        if stack.manifest:
            try:
                stack.capture_logs()
            except Exception:
                pass
        report = {"scope": "RELEASE_ISOLATED_STAGING", "status": "FAIL", "runId": stack.run_id,
                  "failedStage": stage, "errorType": type(error).__name__, "productionDeployment": False}
        if isinstance(error, RuntimeError):
            report["reason"] = str(error)
        if stack.evidence.is_dir():
            write_json(stack.evidence / ("teardown.json" if args.stop else "report.json"), report)
        print(f"FAIL — {stage} ({type(error).__name__}); private diagnostics: {stack.private}")
        if "reason" in report:
            print(report["reason"])
        if stack.manifest:
            print(f"Owned cleanup: rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop {stack.run_id}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
