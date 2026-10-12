#!/usr/bin/env python3
"""User-run RELEASE candidate builds, stopped merged-rootfs audit and Docker fixtures."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from uuid import uuid4
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
IMAGES = {
    "api": ("apps/api/Dockerfile", "apps/api/dist/src/main.js"),
    "web": ("apps/web/Dockerfile", "apps/web/.next/BUILD_ID"),
    "worker": ("deepagents/Dockerfile.dev", "deepagents/entrypoint.py"),
    "server": (
        "deepagents-langgraph/Dockerfile",
        "deepagents/tools/common/capabilities/agent_runtime/local_server.py",
    ),
}
INTEGRATIONS = [
    "test_codebase_memory_runtime_e2e.py",
    "test_docker_sandbox_e2e.py",
    "test_local_agent_runtime_e2e.py",
    "test_production_agent_server_image_e2e.py",
]
INTEGRATION_NAMES = {
    "test_codebase_memory_indexes_searches_and_reports_coverage_for_repository",
    "test_docker_sandbox_executes_repository_tools_without_host_secrets",
    "test_docker_sandbox_hydrates_repository_snapshot_without_removing_mountpoint",
    "test_local_deep_agent_runtime_uses_docker_repository_sandbox",
    "test_agent_server_dispatch_hydrates_docker_repository_sandbox[langgraph-dev]",
    "test_agent_server_dispatch_hydrates_docker_repository_sandbox[lcsp-local]",
    "test_production_agent_server_image_runs_without_license_and_persists_state",
}
EXCLUDED_SOURCE = re.compile(
    r"(^|/)(tests?|decision|node_modules|dist|\.venv|\.next|__pycache__|tmp)/"
    r"|\.(spec|test)\.[cm]?[jt]sx?$"
)
PRIVATE_PATH = re.compile(
    r"(^|/)(\.git|\.github|\.env(?:\.[^/]+)?|\.legal-source|\.corpus|\.chroma|\.billing|"
    r"\.mda|\.langgraph_api|\.local|\.mcp\.json|\.aws|\.codex|\.claude|\.agent|\.agents|\.ruler|"
    r"\.cache|\.uv-cache|\.pnpm-store|\.prisma|\.vscode|\.husky|\.rtk|"
    r"\.gemini|\.bmad|_bmad|\.ua|\.code-review-graph|\.codebase-memory|"
    r"\.understand-anything|\.understand|\.playwright[^/]*|__pycache__|tests?)(/|$)"
    r"|^(?:deepagents/)?(?:frozen|graft|graphify-out|artifacts|output|tmp|docs|docs-vn)(/|$)"
    r"|^(?:AGENTS|CLAUDE|CHANGELOG|DESIGN|RTK|deep-research-report)\.md$"
    # Private local agent session/handoff transcripts must never be part of an image.
    r"|^(?:codex|claude)-session-[^/]*\.md$"
)
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".toml", ".sh", ".prisma", ".map", ".html", ".rsc"}


def run(args: list[str], *, capture: bool = False, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(args, cwd=ROOT, env=env, check=True,
                            stdout=subprocess.PIPE if capture else None,
                            text=True)
    return result.stdout if capture else ""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def policy() -> dict:
    return json.loads(run(["node", "scripts/check-legal-v1-authority-retired.mjs", "--policy-json"], capture=True))


def sources() -> dict[str, str]:
    paths = run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
                 "apps/api/src", "apps/web/src", "packages", "deepagents"], capture=True).split("\0")
    result = {}
    for name in paths:
        if not name or EXCLUDED_SOURCE.search(name):
            continue
        if name.startswith("packages/") and "/src/" not in name and not name.endswith("/package.json"):
            continue
        path = ROOT / name
        if path.is_symlink():
            raise AssertionError("symlink in candidate source manifest")
        if path.is_file():
            result[name] = digest(path.read_bytes())
    assert len(result) > 100, "incomplete source manifest"
    return result


def owned_path(name: str) -> str | None:
    parts = PurePosixPath(name).parts
    if name.startswith("/") or ".." in parts:
        raise AssertionError("unsafe rootfs member path")
    path = PurePosixPath(*parts).as_posix()
    if path == "workspace" or path.startswith("workspace/"):
        return path
    if not path.startswith("app/"):
        return None
    path = path[4:]
    # Third-party libraries are outside this retirement proof; installed LCSP tools are included.
    if "/site-packages/tools/" in path:
        return "deepagents/tools/" + path.split("/site-packages/tools/", 1)[1]
    if any(part in ("node_modules", ".venv") for part in PurePosixPath(path).parts):
        return None
    return path


def source_variants(path: str) -> set[str]:
    path = path.replace("apps/api/dist/src/", "apps/api/src/")
    path = path.replace("apps/web/.next/server/app/", "apps/web/src/app/")
    path = re.sub(r"^(packages/[^/]+)/dist/", r"\1/src/", path)
    path = re.sub(r"/__pycache__/([^/]+)\.cpython-[^.]+(?:\.opt-\d+)?\.pyc$", r"/\1.py", path)
    path = path.removesuffix(".nft.json")
    base = re.sub(r"(?:\.d)?\.[cm]?js(?:\.map)?$|\.d\.ts(?:\.map)?$", "", path)
    variants = {path, base + ".ts", base + ".tsx"}
    if path.startswith("apps/web/src/app/") and Path(path).suffix in {".html", ".rsc", ".meta"}:
        route = path.rsplit(".", 1)[0]
        variants.update({route + "/page.ts", route + "/page.tsx"})
    return variants


def audit(archive: tarfile.TarFile, expected: dict[str, str], marker: str,
          rules: dict, retired: set[str]) -> dict:
    found: dict[str, str] = {}
    manifest = []
    violations = []
    seen = set()
    patterns = [(re.compile(item["pattern"]), item["label"]) for item in rules["retired"]]
    paths = [re.compile(pattern) for pattern in rules["forbiddenPaths"]]
    for member in archive:
        path = owned_path(member.name)
        if path is None:
            continue
        raw_path = PurePosixPath(member.name).as_posix()
        assert raw_path not in seen, "duplicate application rootfs member"
        seen.add(raw_path)
        if path == "workspace" or path.startswith("workspace/"):
            if not (member.isdir() and path in {"workspace", "workspace/repository", "workspace/runtime"}):
                violations.append({"pathSha256": digest(path.encode()), "reason": "nonempty or unexpected application workspace"})
            continue
        private_path = Path(path).parent.as_posix() if Path(path).name == ".env.example" else path
        private = PRIVATE_PATH.search(private_path)
        if path.startswith("reports/") and not (
            path.startswith("reports/legal-corpus-ocr/") or path in {
                "reports/Luat_134_2025_QH15.pdf", "reports/Luat-71-2025-qh15_0710195033.pdf"}
        ):
            private = True
        if private:
            violations.append({"pathSha256": digest(path.encode()), "reason": "excluded private/fixture/archive path"})
            continue
        variants = source_variants(path)
        if variants & retired or any(pattern.search(v) or pattern.search(v + "/") for pattern in paths for v in variants):
            violations.append({"path": path, "reason": "retired application path"})
        if member.isdir():
            continue
        if not member.isfile():
            violations.append({"path": path, "reason": "non-regular application member"})
            continue
        assert member.size <= 64 * 1024 * 1024, "application member exceeds audit bound"
        stream = archive.extractfile(member)
        assert stream is not None
        data = stream.read()
        assert len(data) == member.size, "incomplete application member"
        sha = digest(data)
        found[path] = sha
        manifest.append({"path": raw_path, "size": len(data), "sha256": sha})
        if path in expected and sha != expected[path]:
            violations.append({"path": path, "reason": "source differs from frozen candidate manifest"})
        if path == marker and not data:
            violations.append({"path": path, "reason": "empty built runtime marker"})
        # This fence only rejects obsolete outbox keys; it has no legacy handler or selector.
        if path == "scripts/check-legal-v1-authority-retired.mjs" or "apps/api/src/platform/outbox/retired-event-policy.ts" in variants:
            continue
        if "/migrations/" in path or "/.next/cache/" in path or path.startswith("reports/"):
            continue
        if Path(path).suffix in TEXT_SUFFIXES or "Dockerfile" in path:
            text = data.decode("utf-8", errors="strict")
            for pattern, label in patterns:
                if pattern.search(text):
                    violations.append({"path": path, "reason": label})
    for path in sorted(expected.keys() - found.keys()):
        violations.append({"path": path, "reason": "expected canonical source missing"})
    if marker not in found:
        violations.append({"path": marker, "reason": "required built runtime marker missing"})
    return {"status": "FAIL" if violations else "PASS", "files": manifest,
            "sourceFilesVerified": len(expected), "retiredPathsChecked": len(retired),
            "retiredPatternsChecked": len(patterns), "violations": violations}


def check_junit(path: Path) -> dict:
    cases = ET.parse(path).findall(".//testcase")
    counts = {kind: sum(case.find(kind) is not None for case in cases)
              for kind in ("failure", "error", "skipped")}
    assert len(cases) == 7 and {case.attrib["name"] for case in cases} == INTEGRATION_NAMES and not any(counts.values()), "all seven named Docker integrations must execute and pass"
    return {"passed": len(cases), **counts, "tests": [case.attrib["name"] for case in cases]}


def self_check(rules: dict) -> None:
    assert "apps/api/src/retired.ts" in source_variants("apps/api/dist/src/retired.js.map")
    assert "apps/web/src/app/old/page.tsx" in source_variants("apps/web/.next/server/app/old.html")
    assert "deepagents/tools/retired.py" in source_variants("deepagents/tools/__pycache__/retired.cpython-311.pyc")
    def fixture(entries: list[tuple[str, bytes | None]]) -> dict:
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            for name, data in entries:
                member = tarfile.TarInfo(name)
                if name.endswith("/"):
                    member.type = tarfile.DIRTYPE
                elif data is None:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "/outside"
                else:
                    member.size = len(data)
                archive.addfile(member, None if data is None else io.BytesIO(data))
        output.seek(0)
        with tarfile.open(fileobj=output, mode="r:") as archive:
            return audit(archive, {"deepagents/agent.py": digest(b"canonical")},
                         "deepagents/agent.py", rules, {"apps/api/src/retired.ts"})

    good = [("app/deepagents/agent.py", b"canonical"),
            ("app/apps/web/src/app/(workspace)/artifacts/page.tsx", b"canonical"),
            ("app/.env.example", b"example"),
            ("app/deepagents/.env.example", b"example")]
    assert fixture(good)["status"] == "PASS"
    for mutation in [
        [], [("app/deepagents/agent.py", b"changed")],
        good + [("app/apps/api/dist/src/retired.js", b"old")],
        good + [("app/deepagents/skills/lcsp/SKILL.md", b"old")],
        good + [("app/apps/api/dist/src/hidden.js", b"EngineeringRuleEvaluator")],
        good + [("app/deepagents/.env", b"private")],
        good + [("app/deepagents/.langgraph_api/checkpoint.pckl", b"private")],
        good + [("app/apps/api/src/.claude/logs/pending-prompts.jsonl", b"private")],
        good + [("app/apps/api/.cache/prisma-nodejs/last-generate", b"private")],
        good + [("app/apps/api/.local/state/gh/device-id", b"private")],
        good + [("app/.mcp.json", b"private")],
        good + [("app/.claude/.env.example", b"private")],
        good + [("app/apps/api/src/modules/scan/", b"")],
        good + [("app/artifacts/customer.bin", b"private")],
        good + [("app/.uv-cache/build.bin", b"private")],
        good + [("app/CHANGELOG.md", b"history")],
        good + [("app/codex-session-01a11a63-53ee-7d42-9062-2b575da11ab6.md", b"private transcript")],
        good + [("app/claude-session-local.md", b"private transcript")],
        good + [("workspace/repository/private.py", b"private")],
        good + [("app/deepagents/link.py", None)],
    ]:
        assert fixture(mutation)["status"] == "FAIL"
    try:
        fixture(good + [("app/../../escape", b"bad")])
    except AssertionError:
        pass
    else:
        raise AssertionError("traversal mutation was accepted")
    with tempfile.TemporaryDirectory(prefix="lcsp-release-image-selfcheck-") as tmp:
        path = Path(tmp) / "junit.xml"
        path.write_text('<testsuites><testsuite>' + ''.join(f'<testcase name="{name}"/>' for name in INTEGRATION_NAMES) + '</testsuite></testsuites>')
        assert check_junit(path)["passed"] == 7
        path.write_text('<testsuites><testsuite><testcase name="synthetic"><skipped/></testcase></testsuite></testsuites>')
        try:
            check_junit(path)
        except AssertionError:
            pass
        else:
            raise AssertionError("skip mutation was accepted")
    print("PASS — rootfs/source/compiled-path/content/private/symlink/traversal/skip mutations; no Docker operation")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    rules = policy()
    if args.self_check:
        self_check(rules)
        return 0
    unique = datetime.now(UTC).strftime("%Y%m%d%H%M%S") + "_" + uuid4().hex[:12]
    evidence = ROOT / "reports/release-images" / unique
    evidence.mkdir(parents=True)
    report = {"scope": "RELEASE_CANDIDATE_BUILDS_MERGED_ROOTFS_AND_SEVEN_DOCKER_INTEGRATIONS",
              "status": "FAIL", "productionDeployment": False, "images": {}}
    stage = "source preflight"
    try:
        run(["node", "scripts/check-legal-v1-authority-retired.mjs"])
        run(["node", "scripts/check-canonical-terminology.mjs"])
        frozen = sources()
        inputs = {path: digest((ROOT / path).read_bytes()) for path in [
            ".dockerignore", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json",
            *[item[0] for item in IMAGES.values()],
            "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261008160000_w7_drop_v1_authority/migration.sql",
            "apps/api/prisma/migrations/20261011120000_compliance_rule_set_terminology/migration.sql",
            "apps/api/prisma/migrations/20261012090000_canonical_physical_terminology/migration.sql",
            "deepagents/pyproject.toml", "deepagents/uv.lock",
            "apps/api/package.json", "apps/web/package.json", "tests/release-images.py",
            "deepagents/tests/conftest.py", *["deepagents/tests/integration/" + name for name in INTEGRATIONS],
            "tests/fixtures/retired-image-paths.json", "scripts/check-legal-v1-authority-retired.mjs",
            "scripts/check-canonical-terminology.mjs",
        ]}
        (evidence / "candidate-source.json").write_text(json.dumps({"source": frozen, "buildAndPolicyInputs": inputs}, indent=2) + "\n")
        retired = set(json.loads((ROOT / "tests/fixtures/retired-image-paths.json").read_text())["paths"])
        for role, (dockerfile, marker) in IMAGES.items():
            stage = f"{role} build"
            print(f"RELEASE — {stage}", flush=True)
            iidfile = evidence / f"{role}.iid"
            run(["docker", "build", "-f", dockerfile, "--iidfile", str(iidfile),
                 "--label", f"lcsp.release-candidate={unique}", "-t", f"lcsp-release-{role}:{unique}", "."])
            image_id = iidfile.read_text().strip()
            assert re.fullmatch(r"sha256:[0-9a-f]{64}", image_id)
            stage = f"{role} merged-rootfs audit"
            container = f"lcsp-release-rootfs-{role}-{unique}"
            owned = False
            try:
                run(["docker", "create", "--pull=never", "--network=none", "--read-only",
                     "--name", container, "--label", f"lcsp.release-rootfs={unique}",
                     "--entrypoint", "/bin/true", image_id], capture=True)
                owned = True
                info = json.loads(run(["docker", "inspect", container], capture=True))[0]
                assert info["Image"] == image_id and not info["State"]["Running"]
                assert not info["Mounts"] and not info["HostConfig"]["PortBindings"]
                assert info["HostConfig"]["ReadonlyRootfs"] and info["HostConfig"]["NetworkMode"] == "none"
                expected = {p: sha for p, sha in frozen.items() if role in ("api", "web") or p.startswith("deepagents/")}
                with tempfile.TemporaryDirectory(prefix="lcsp-release-rootfs-") as tmp:
                    export = Path(tmp) / "rootfs.tar"
                    run(["docker", "container", "export", "--output", str(export), container])
                    with tarfile.open(export, mode="r|") as archive:
                        result = audit(archive, expected, marker, rules, retired)
                (evidence / f"{role}-rootfs.json").write_text(json.dumps(result, indent=2) + "\n")
                report["images"][role] = {"imageId": image_id, "dockerfile": dockerfile,
                                          "mergedRootfs": result["status"], "files": len(result["files"])}
                if result["violations"]:
                    reasons = {v["reason"] for v in result["violations"]}
                    counts = {reason: sum(v["reason"] == reason for v in result["violations"]) for reason in sorted(reasons)}
                    print("Rootfs violations: " + json.dumps(counts), flush=True)
                assert result["status"] == "PASS", "see sanitized rootfs violations"
                print(f"PASS — {role} merged rootfs, {len(result['files'])} application files", flush=True)
            finally:
                if owned:
                    run(["docker", "rm", container], capture=True)
        stage = "candidate source stability"
        assert sources() == frozen, "source changed during candidate build"
        assert all(digest((ROOT / p).read_bytes()) == sha for p, sha in inputs.items()), "build/policy input changed"
        stage = "seven Docker integrations"
        # Do not inherit application DB/broker/provider settings or load the user's dotenv.
        env = {key: value for key, value in os.environ.items() if key in {
            "PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR"}}
        env.update(PYTHONPATH="deepagents", PYTHON_DOTENV_DISABLED="1",
                   LCSP_DOCKER_SANDBOX_E2E="1", LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E="1",
                   LCSP_REPOSITORY_SANDBOX_IMAGE=report["images"]["worker"]["imageId"],
                   LCSP_PRODUCTION_AGENT_SERVER_IMAGE=report["images"]["server"]["imageId"])
        junit = evidence / "docker-junit.xml"
        run([sys.executable, "-m", "pytest", "-q", *["deepagents/tests/integration/" + name for name in INTEGRATIONS],
             "--junitxml", str(junit)], env=env)
        report["integrations"] = check_junit(junit)
        assert sources() == frozen and all(digest((ROOT / p).read_bytes()) == sha for p, sha in inputs.items()), "candidate inputs changed during integrations"
        report["status"] = "PASS"
        report["exitCode"] = 0
    except (Exception, KeyboardInterrupt) as error:
        report.update(failedStage=stage, errorType=type(error).__name__, exitCode=1)
        print(f"FAIL — {stage} ({type(error).__name__}); see evidence and returned command output", file=sys.stderr)
    finally:
        (evidence / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Evidence directory: {evidence}", flush=True)
    return report["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
