"""Provider-free regression checks for operator intent and historical ledger scope."""
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ledger = load("historical_ledger", ROOT / "scripts/generate-ledger.py")
retry = load("selected_audit_retry", ROOT / "deepagents/scripts/run_resume_turn.py")


def test_real_three_row_source_is_never_described_as_a_complete_49_answer_audit():
    rows = json.loads((ROOT / "reports/t31-history/hitl_ledger_raw.json").read_text())
    assert len(rows) == 3
    result = ledger.render_ledger(rows, "fixture-digest")
    assert "Supplied request count: 3" in result
    assert "49 / 49" not in result and "100% resolved" not in result
    assert "completeness of the full assessment is not established" in result
    for row in rows:
        assert ledger.markdown_text(row["question"]) in result
        assert ledger.markdown_text(row["answer"]) in result


def test_ledger_output_is_create_only_and_source_bytes_are_preserved(tmp_path):
    source = tmp_path / "input.json"
    source.write_text(json.dumps([{"requestId": "one", "ruleId": "rule", "question": "Question|<x>",
                                  "answer": None, "status": "OPEN"}]))
    original = source.read_bytes()
    output = tmp_path / "ledger.md"
    assert ledger.main(["--input", str(source), "--output", str(output)]) == 0
    assert "Observed RESOLVED rows: 0" in output.read_text()
    assert "Question&#124;&lt;x&gt;" in output.read_text()
    with pytest.raises(FileExistsError):
        ledger.main(["--input", str(source), "--output", str(output)])
    assert source.read_bytes() == original


@pytest.mark.parametrize("rows", [{}, [{"requestId": "missing"}],
    [{"requestId": "same", "ruleId": "r", "question": "q", "answer": None, "status": "OPEN"}] * 2])
def test_malformed_or_duplicate_ledger_rows_are_rejected(rows):
    with pytest.raises(ValueError):
        ledger.render_ledger(rows, "digest")


def audit_fixture():
    return {"assessmentId": str(uuid4()), "requestId": str(uuid4()), "requestRevision": 1,
            "scopeMode": "SELECTED_RULES", "status": "FAILED",
            "ruleSetVersionId": str(uuid4()), "ruleSetDigest": "d" * 64,
            "repositorySnapshotId": str(uuid4()), "repositoryCommit": "c" * 40,
            "rules": [{"assessmentRuleId": "only-selected", "assessmentRuleVersion": "v1"}]}


@pytest.mark.parametrize("base", ["https://external.invalid:4000", "http://127.0.0.1:4000/path",
                                  "http://user:secret@127.0.0.1:4000", "http://127.0.0.1:80"])
def test_retry_target_rejects_ambient_or_remote_authority(base):
    with pytest.raises(ValueError):
        retry.validate_target(base, str(uuid4()), str(uuid4()))


@pytest.mark.parametrize("mode", ["preview", "wrong-digest", "submit"])
def test_retry_requires_reviewed_intent_and_only_uses_owner_api(monkeypatch, capsys, mode):
    audit = audit_fixture()
    calls = []
    def transport(request):
        calls.append(request)
        return httpx.Response(200, json={"ok": True, "data": {**audit, "status": "QUEUED" if request.method == "POST" else "FAILED"}})
    original_client = httpx.Client
    monkeypatch.setattr(retry.httpx, "Client",
                        lambda **kwargs: original_client(transport=httpx.MockTransport(transport), **kwargs))
    monkeypatch.setenv("LCSP_OPERATOR_TEST_SESSION", "fixture-session-never-print")
    args = ["--api-base", "http://127.0.0.1:4000", "--assessment-id", audit["assessmentId"],
            "--audit-request-id", audit["requestId"], "--session-env", "LCSP_OPERATOR_TEST_SESSION"]
    key = str(uuid4())
    if mode != "preview":
        digest = retry.request_fingerprint(audit, audit["assessmentId"], audit["requestId"])
        args += ["--submit", "--expected-request-sha256", "changed" if mode == "wrong-digest" else digest,
                 "--idempotency-key", key]
    if mode == "wrong-digest":
        with pytest.raises(ValueError):
            retry.main(args)
    else:
        assert retry.main(args) == 0
    assert [call.method for call in calls] == (["GET", "POST"] if mode == "submit" else ["GET"])
    assert "fixture-session-never-print" not in capsys.readouterr().out
    if mode == "submit":
        assert calls[-1].url.path.endswith("/rule-audits/" + audit["requestId"] + "/retry")
        assert json.loads(calls[-1].content) == {"idempotencyKey": key}
