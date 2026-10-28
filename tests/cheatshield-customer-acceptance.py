#!/usr/bin/env python3
"""Customer API and production hydration acceptance for the independent CheatShield repository.

An existing isolated LCSP API and ACTIVE Rule Set are prerequisites. The state directory
must be outside the checkout and contain private-runtime.json (api, workerKey).
This entrypoint creates no decisions and invokes no LLM. Genuine investigation is a
separate runtime phase; these receipts must not be reported as semantic acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import subprocess
import sys
import tarfile
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "vishal017/cheatshield"
REPOSITORY_URL = "https://github.com/" + REPOSITORY


def archive_manifest(content: bytes) -> dict[str, str]:
    result = {}
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            parts = PurePosixPath(member.name).parts
            if member.name.startswith("/") or ".." in parts or len(parts) < 2 or not member.isfile():
                raise ValueError("Unsupported or unsafe source archive entry")
            path = "/".join(parts[1:])
            if path in result:
                raise ValueError("Duplicate source archive path")
            result[path] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
    if not result:
        raise ValueError("Empty source archive")
    return result


def private_json(path: Path, payload: dict) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(payload, stream, indent=2)
        stream.write("\n")


class CustomerAcceptance:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        if self.directory.is_relative_to(ROOT):
            raise ValueError("Private acceptance state must be outside the checkout")
        self.runtime = json.loads((self.directory / "private-runtime.json").read_text())
        endpoint = urlparse(self.runtime["api"])
        if endpoint.scheme != "http" or endpoint.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("This acceptance entrypoint requires an explicitly isolated loopback API")
        self.private_path = self.directory / "customer-private.json"
        self.customer = json.loads(self.private_path.read_text()) if self.private_path.exists() else {}
        self.transcript = []

    def call(self, path, body=None, *, method="POST", customer=None):
        owner = self.customer if customer is None else customer
        headers = {"content-type": "application/json"}
        if owner.get("session_token"):
            headers["authorization"] = "Bearer " + owner["session_token"]
        request = Request(self.runtime["api"].rstrip("/") + path, method=method,
                          data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urlopen(request, timeout=120) as response:
                status, payload = response.status, json.load(response)
        except HTTPError as response:
            status, payload = response.code, json.load(response)
        self.transcript.append({"method": method, "path": path, "status": status,
                                "ok": payload.get("ok"), "problemCode": payload.get("problem", {}).get("code")})
        return status, payload.get("data", payload)

    def success(self, path, body=None, *, method="POST", customer=None):
        status, payload = self.call(path, body, method=method, customer=customer)
        if status not in (200, 201):
            raise RuntimeError(json.dumps(self.transcript[-1]))
        return payload

    def save(self):
        private_json(self.private_path, self.customer)

    def setup(self):
        if not self.customer:
            fields = {"email": "lcsp360-cheatshield-" + secrets.token_hex(6) + "@acceptance.invalid",
                      "password": "CS!" + secrets.token_hex(24), "display_name": "Independent CheatShield assessment Customer"}
            self.customer = {**fields, **self.success("/auth/sign-up", fields, customer={})}
            self.save()
        if not self.customer.get("signedIn"):
            session = self.success("/auth/sign-in", {key: self.customer[key] for key in ("email", "password")})
            self.customer.update(session_token=session["session_token"], signedIn=True)
            self.save()
        if not self.customer.get("assessmentId"):
            metadata = json.loads(subprocess.check_output(["gh", "api", "repos/" + REPOSITORY]))
            assert metadata["full_name"] == REPOSITORY and metadata["private"] is False
            head = json.loads(subprocess.check_output(["gh", "api", "repos/" + REPOSITORY + "/commits/main"]))
            self.customer.update(pinnedCommit=head["sha"], repositoryId=str(metadata["id"]))
            created = self.success("/assessments", {
                "name": "LCSP-360 CheatShield genuine Customer acceptance",
                "description": "Independent public repository assessment; no claim to upstream ownership, deployment or customer operational facts.",
            })
            self.customer["assessmentId"] = created["assessment_id"]
            self.save()
        # Existing execution receipts may predate this reusable entrypoint; recover the pin from the immutable snapshot.
        if not self.customer.get("pinnedCommit"):
            detail = self.success("/assessments/" + self.customer["assessmentId"], method="GET")
            self.customer["pinnedCommit"] = detail["case"]["repositoryCommit"]
            assert self.customer["pinnedCommit"], "An existing assessment must already expose its pinned commit"
            self.save()
        if not self.customer.get("credentialConfigured"):
            self.success("/auth/re-auth/password", {"password": self.customer["password"]})
            credential = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
            self.success("/provider-credentials", {"provider": "GITHUB", "credential": credential})
            del credential
            self.customer["credentialConfigured"] = True
            self.save()
        prefix = "/assessments/" + self.customer["assessmentId"]
        if not self.customer.get("connectionId"):
            connected = self.success(prefix + "/repository-connection", {"repositoryUrl": REPOSITORY_URL})
            assert connected["repositoryFullName"] == REPOSITORY
            self.customer["connectionId"] = connected["connectionId"]
            self.save()
        if not self.customer.get("snapshotId"):
            snapshot = self.success(prefix + "/snapshots", {"connection_id": self.customer["connectionId"],
                                    "branch": "main", "commit_sha": self.customer["pinnedCommit"]})
            assert snapshot["repository_full_name"] == REPOSITORY
            assert snapshot["commit_sha"] == self.customer["pinnedCommit"]
            self.customer["snapshotId"] = snapshot["snapshot_id"]
            self.save()
        if not self.customer.get("setupCompleted"):
            completion = self.success(prefix + "/repository-setup/complete", {"responseLanguage": "en"})
            assert completion["snapshot_id"] == self.customer["snapshotId"]
            self.customer["setupCompleted"] = True
            self.save()
        detail = self.success(prefix, method="GET")
        case = detail["case"]
        assert detail["owner_id"] == self.customer["user_id"]
        assert case["repositorySnapshotId"] == self.customer["snapshotId"]
        assert case["repositoryCommit"] == self.customer["pinnedCommit"]
        assert case["ruleSetVersionId"] and len(case["coverage"]) == case["ruleSet"]["assessmentRuleCount"]
        self.detail = detail
        return case

    def verify_archive(self):
        case = self.detail["case"]
        request = Request(self.runtime["api"] + "/internal/repository-snapshots/" + case["repositorySnapshotId"]
                          + "/archive?scanJobId=" + case["repositoryScanJobId"],
                          headers={"x-worker-api-key": self.runtime["workerKey"]})
        with urlopen(request, timeout=120) as response:
            content = response.read()
            assert response.headers["x-repository-full-name"] == REPOSITORY
            assert response.headers["x-commit-sha"] == self.customer["pinnedCommit"]
            assert response.headers["x-snapshot-id"] == case["repositorySnapshotId"]
        github_url = "https://codeload.github.com/" + REPOSITORY + "/tar.gz/" + self.customer["pinnedCommit"]
        with urlopen(github_url, timeout=120) as response:
            independent = response.read()
        self.manifest = archive_manifest(content)
        assert self.manifest == archive_manifest(independent), "LCSP archive differs from the GitHub-pinned source"
        return {"files": self.manifest, "lcspArchiveSha256": hashlib.sha256(content).hexdigest(),
                "githubArchiveSha256": hashlib.sha256(independent).hexdigest(), "allFileHashesMatch": True}

    def verify_tenant_isolation(self):
        other_path = self.directory / "other-customer-private.json"
        if other_path.exists():
            other = json.loads(other_path.read_text())
        else:
            fields = {"email": "lcsp360-other-" + secrets.token_hex(6) + "@acceptance.invalid",
                      "password": "CS!" + secrets.token_hex(24), "display_name": "Tenant isolation acceptance Customer"}
            other = {**fields, **self.success("/auth/sign-up", fields, customer={})}
            private_json(other_path, other)
        prefix = "/assessments/" + self.customer["assessmentId"]
        for path in (prefix, prefix + "/repository-setup"):
            status, _ = self.call(path, method="GET", customer=other)
            assert status in (403, 404), "Another Customer accessed the target assessment"
        if not other.get("assessmentId"):
            created = self.success("/assessments", {"name": "Cross-tenant access rejection acceptance"}, customer=other)
            other["assessmentId"] = created["assessment_id"]
            private_json(other_path, other)
        status, _ = self.call("/assessments/" + other["assessmentId"] + "/snapshots", {
            "connection_id": self.customer["connectionId"], "branch": "main", "commit_sha": self.customer["pinnedCommit"],
        }, customer=other)
        assert status in (403, 404), "Another Customer reused the target's repository connection"
        connections = self.success("/github/repositories", method="GET", customer=other)
        assert self.customer["connectionId"] not in json.dumps(connections)
        status, _ = self.call(prefix + "/repository-connection", {"repositoryUrl": "https://github.com/khov4nfs/LCSP"})
        assert status == 409, "An ACTIVE assessment switched away from its pinned Customer repository"
        return {"status": "PASS", "otherCustomerId": other["user_id"], "otherAssessmentId": other["assessmentId"],
                "otherAssessmentPurpose": "Isolation fixture; no model investigation"}

    def hydrate(self):
        sys.path.insert(0, str(ROOT / "deepagents"))
        os.environ.update(NESTJS_API_BASE_URL=self.runtime["api"], WORKER_API_KEY=self.runtime["workerKey"],
                          LCSP_ARTIFACT_STORAGE_PATH=str(self.directory / "runtime-artifacts"),
                          LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR=str(self.directory / "snapshot-cache"))
        from assessment_root.boundary import sandbox_backend_factory

        case = self.detail["case"]
        backend, activation = sandbox_backend_factory({"threadId": self.detail["runtime"]["threadId"]}, {
            "assessmentId": self.customer["assessmentId"], "repositorySnapshotId": case["repositorySnapshotId"],
            "repositoryScanJobId": case["repositoryScanJobId"], "repositoryCommit": case["repositoryCommit"],
        })
        with activation:
            marker_file = backend.download_files(["/.lcsp/repository.json"])[0]
            assert not marker_file.error and marker_file.content is not None
            marker = json.loads(marker_file.content)
            assert marker["assessmentId"] == self.customer["assessmentId"]
            assert marker["snapshotId"] == case["repositorySnapshotId"]
            assert marker["commitSha"] == self.customer["pinnedCommit"]
            view = marker["sourceCoverage"]
            omitted = {entry["path"]: entry for entry in view["skippedEntries"]}
            assert len(omitted) == len(view["skippedEntries"])
            for path, entry in omitted.items():
                assert path in self.manifest and entry["sha256"] == self.manifest[path], path
                assert entry["reason"] == "FILE_SIZE_LIMIT" and entry["sizeBytes"] > entry["limitBytes"], path
            paths = sorted(set(self.manifest) - set(omitted))
            downloaded = backend.download_files(["/" + path for path in paths])
            for item in backend.download_files(["/" + path for path in omitted]):
                assert item.error, "An entry declared omitted was materialized"
        assert len(downloaded) == len(paths)
        assert view["includedFiles"] == len(paths) and view["coverageLimited"] == bool(omitted)
        for path, item in zip(paths, downloaded):
            assert not item.error and item.content is not None, path
            assert hashlib.sha256(item.content).hexdigest() == self.manifest[path], path
        return {"status": "PASS", "backend": type(backend).__name__, "threadId": self.detail["runtime"]["threadId"],
                "verifiedSandboxFiles": len(paths), "pinnedFilesAccountedFor": len(paths) + len(omitted),
                "repositoryView": view, "proof": "Production sandbox factory only; no claim or LLM invocation"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--hydrate", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        def archive(name):
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w:gz") as handle:
                entry = tarfile.TarInfo(name)
                entry.size = 1
                handle.addfile(entry, io.BytesIO(b"x"))
            return output.getvalue()
        assert archive_manifest(archive("root/main.py")) == {"main.py": hashlib.sha256(b"x").hexdigest()}
        for name in ("/absolute/main.py", "root/../outside.py", "unrooted.py"):
            try:
                archive_manifest(archive(name))
            except ValueError:
                continue
            raise AssertionError("Unsafe archive accepted")
        print("PASS: source archive validation; no API, repository or model calls")
        return
    if args.state_dir is None:
        parser.error("--state-dir is required")
    acceptance = CustomerAcceptance(args.state_dir)
    case = acceptance.setup()
    receipt = {"phase": "CUSTOMER_SETUP_AND_PROVENANCE", "repository": REPOSITORY,
               "assessmentId": acceptance.customer["assessmentId"], "commitSha": case["repositoryCommit"],
               "snapshotId": case["repositorySnapshotId"], "ruleSetVersionId": case["ruleSetVersionId"],
               "coverageCount": len(case["coverage"]), "acceptedDecisionsObserved": len(case["decisions"]),
               "archive": acceptance.verify_archive(), "tenantIsolation": acceptance.verify_tenant_isolation()}
    if args.hydrate:
        receipt["hydration"] = acceptance.hydrate()
    receipt["apiTranscript"] = acceptance.transcript
    receipt["genuineModelEvidence"] = "NOT_ESTABLISHED_BY_THIS_ENTRYPOINT"
    (args.state_dir / "customer-setup-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: receipt[key] for key in ("phase", "repository", "assessmentId", "commitSha", "snapshotId", "ruleSetVersionId", "coverageCount", "acceptedDecisionsObserved", "genuineModelEvidence")}))


if __name__ == "__main__":
    main()
