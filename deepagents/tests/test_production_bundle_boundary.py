"""Unpatched production loader runs in fresh processes, never through pytest bundle injection."""
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
PENDING = ROOT / "instructions/candidates/r1/manifest.pending.json"


@pytest.mark.parametrize("case,expected", [
    ("missing", "BUNDLE_MISSING"),
    ("untrusted", "BUNDLE_APPROVAL_UNTRUSTED"),
    ("pending", "RUNTIME_BUNDLE_NOT_APPROVED"),
    ("revoked", "RUNTIME_BUNDLE_REVOKED"),
    ("corrupt_pin", "BUNDLE_APPROVAL_UNTRUSTED"),
    ("test_approval", "BUNDLE_APPROVAL_UNTRUSTED"),
])
def test_unpatched_production_bundle_rejects_without_authority(tmp_path, case, expected):
    env = {key: value for key, value in os.environ.items() if key not in (
        "LCSP_RUNTIME_INSTRUCTION_MANIFEST", "LCSP_APPROVED_INSTRUCTION_MANIFEST_SHA256",
    )}
    path = PENDING
    if case == "test_approval":
        from approved_bundle_fixture import build_test_bundle
        build_test_bundle(tmp_path)
        path = tmp_path / "test-only-manifest.json"
    if case == "revoked":
        payload = json.loads(PENDING.read_bytes())
        payload["approvalStatus"] = "REVOKED"
        path = tmp_path / "revoked.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
    if case != "missing":
        env["LCSP_RUNTIME_INSTRUCTION_MANIFEST"] = str(path)
    if case not in {"missing", "untrusted"}:
        env["LCSP_APPROVED_INSTRUCTION_MANIFEST_SHA256"] = "0" * 64 if case == "corrupt_pin" else sha256(path.read_bytes()).hexdigest()
    code = """
from runtime_instruction_bundle import production_runtime_bundle, RuntimeInstructionBundleError
try:
    production_runtime_bundle()
except RuntimeInstructionBundleError as error:
    print(str(error))
else:
    raise AssertionError('Unapproved runtime must not become available')
"""
    result = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected
