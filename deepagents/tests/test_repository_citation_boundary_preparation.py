from __future__ import annotations

import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from orchestration.context import LCSPRunContext
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
)
from tools.common.capabilities.assessment.rule_assessment.evidence_refs import (
    cite_verified_source,
    parse_canonical_ref,
    parse_verified_evidence_ref,
)
from tools.common.capabilities.assessment.rule_assessment.validation import (
    RuleAssessmentValidationError,
    validate_rule_assessment,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)


_COMMIT = "a" * 40
_RULE_ID = "rule-alpha"
_CRITERION_ID = "criterion-alpha"


def _write_repository(root: Path) -> tuple[str, Path]:
    source = root / "src" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "def serve():\n"
        "    return 'ok'\n"
        "\n"
        "# production behavior\n"
        "marker = 'source'\n",
        encoding="utf-8",
    )
    return source.relative_to(root).as_posix(), source


def _context(root: Path, **changes: object) -> LCSPRunContext:
    values: dict[str, object] = {
        "assessment_id": "assessment-alpha",
        "engineering_rule_ids": (_RULE_ID,),
        "engineering_rule_version": "rule-version-1",
        "criterion_ids": (_CRITERION_ID,),
        "rule_execution_id": "execution-alpha",
        "commit_sha": _COMMIT,
        "repository_path": str(root),
        "context_revision": 1,
    }
    values.update(changes)
    return LCSPRunContext(**values)


def _tamper(ref: str, field: str) -> str:
    canonical, mac = ref.rsplit("~", 1)
    entry = parse_canonical_ref(canonical)
    assert entry is not None
    if field == "mac":
        mac = mac[:-1] + ("0" if mac[-1] != "0" else "1")
    else:
        if field == "commit":
            value = "b" * 40
            canonical = canonical.replace(
                f"source:{entry['commitSha']}:", f"source:{value}:", 1
            )
        elif field == "path":
            value = "src/other.py"
            canonical = canonical.replace(
                f":{entry['path']}#", f":{value}#", 1
            )
        else:
            value = entry["endLine"] + 1
            canonical = canonical.replace(
                f"#L{entry['startLine']}-L{entry['endLine']}",
                f"#L{entry['startLine']}-L{value}",
                1,
            )
    mutated = parse_canonical_ref(canonical)
    assert mutated is not None
    if field == "mac":
        assert mutated == entry
    else:
        changed_key, changed_value = {
            "commit": ("commitSha", value),
            "path": ("path", value),
            "range": ("endLine", value),
        }[field]
        assert mutated == {**entry, "ref": canonical, changed_key: changed_value}
    return f"{canonical}~{mac}"


def _submission(ref: str) -> dict[str, object]:
    return {
        "engineeringRuleId": _RULE_ID,
        "engineeringRuleVersion": "rule-version-1",
        "repositoryVersion": _COMMIT,
        "criteria": [
            {
                "criterionId": _CRITERION_ID,
                "status": RULE_CRITERION_STATUSES["evidenceFound"],
                "evidenceKind": RULE_EVIDENCE_KINDS["supportsRequirement"],
                "evidenceRefs": [ref],
            }
        ],
    }


def test_valid_citation_is_minted_and_parsed_from_live_temp_source(tmp_path: Path) -> None:
    path, _ = _write_repository(tmp_path)
    context = _context(tmp_path)

    citation = cite_verified_source(context, path, 2, 4, tmp_path)

    assert citation["path"] == path
    assert citation["startLine"] == 2
    assert citation["endLine"] == 4
    assert parse_verified_evidence_ref(citation["evidenceRef"], context) == {
        "ref": citation["evidenceRef"].rsplit("~", 1)[0],
        "commitSha": _COMMIT,
        "path": path,
        "startLine": 2,
        "endLine": 4,
    }


@pytest.mark.parametrize("field", ("mac", "commit", "path", "range"))
def test_verified_ref_rejects_tampered_mac_commit_path_or_range(
    tmp_path: Path, field: str
) -> None:
    path, _ = _write_repository(tmp_path)
    context = _context(tmp_path)
    ref = cite_verified_source(context, path, 2, 4, tmp_path)["evidenceRef"]

    assert parse_verified_evidence_ref(_tamper(ref, field), context) is None


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("assessment_id", "assessment-beta"),
        ("engineering_rule_ids", ("rule-beta",)),
        ("rule_execution_id", "execution-beta"),
    ),
)
def test_verified_ref_cannot_replay_across_assessment_rule_or_execution(
    tmp_path: Path, field: str, value: object
) -> None:
    path, _ = _write_repository(tmp_path)
    context = _context(tmp_path)
    ref = cite_verified_source(context, path, 2, 4, tmp_path)["evidenceRef"]

    replay_context = replace(context, **{field: value})
    assert parse_verified_evidence_ref(ref, replay_context) is None


@pytest.mark.parametrize(
    ("path", "start", "end", "message"),
    (
        ("src/service.py", 0, 1, "line range is invalid"),
        ("src/service.py", 4, 3, "line range is invalid"),
        ("../src/service.py", 1, 1, "inside customer repository"),
        (".git/config", 1, 1, "inside customer repository"),
        ("src/missing.py", 1, 1, "does not exist"),
        ("src/service.py", 1, 99, "exceeds repository file bounds"),
    ),
)
def test_citation_fails_closed_for_invalid_range_traversal_or_missing_source(
    tmp_path: Path, path: str, start: int, end: int, message: str
) -> None:
    _write_repository(tmp_path)

    with pytest.raises(EvidenceClaimValidationError, match=message):
        cite_verified_source(_context(tmp_path), path, start, end, tmp_path)


def test_citation_requires_one_live_rule_execution(tmp_path: Path) -> None:
    path, _ = _write_repository(tmp_path)
    context = _context(tmp_path, rule_execution_id=None)

    with pytest.raises(EvidenceClaimValidationError, match="no rule execution context"):
        cite_verified_source(context, path, 2, 4, tmp_path)


def test_rule_validation_rechecks_the_live_source_after_minting(tmp_path: Path) -> None:
    path, source = _write_repository(tmp_path)
    context = _context(tmp_path)
    ref = cite_verified_source(context, path, 2, 4, tmp_path)["evidenceRef"]

    accepted = validate_rule_assessment(_submission(ref), context, str(tmp_path)).to_payload()
    assert accepted["criteria"][0]["evidence"][0]["ref"] == ref.rsplit("~", 1)[0]
    assert accepted["criteria"][0]["evidence"][0]["provenance"]["repositoryVersion"] == _COMMIT

    source.unlink()
    with pytest.raises(RuleAssessmentValidationError, match="does not exist"):
        validate_rule_assessment(_submission(ref), context, str(tmp_path))


def test_process_secret_does_not_survive_interpreter_restart(tmp_path: Path) -> None:
    path, _ = _write_repository(tmp_path)
    context = _context(tmp_path)
    ref = cite_verified_source(context, path, 2, 4, tmp_path)["evidenceRef"]
    script = """
import sys
from orchestration.context import LCSPRunContext
from tools.common.capabilities.assessment.rule_assessment.evidence_refs import parse_verified_evidence_ref

context = LCSPRunContext(
    assessment_id="assessment-alpha",
    engineering_rule_ids=("rule-alpha",),
    rule_execution_id="execution-alpha",
    commit_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
)
print(parse_verified_evidence_ref(sys.argv[1], context))
"""

    restarted = subprocess.run(
        [sys.executable, "-c", script, ref],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )

    assert restarted.stdout.strip() == "None"
