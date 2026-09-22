"""Best-effort PR-review shadow triage entrypoint for LCSP-336."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .gateway import DecisionGateway
from .shadow import (
    InMemoryDecisionIdempotencyStore,
    PrReviewTriagePacket,
    ShadowDecisionObserver,
    WorkerApiDecisionIdempotencyStore,
    shadow_record_payload,
    worker_api_decision_event_sink,
)


JIRA_ID_PATTERN = re.compile(r"\bLCSP-\d+\b")


class JsonlTelemetrySink:
    """Append privacy-safe semantic decision events to a JSONL file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.events: list[dict[str, Any]] = []

    def __call__(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, sort_keys=True) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run LCSP PR-review Jev shadow triage with bounded metadata."
    )
    parser.add_argument("--pr-number", type=int, default=None)
    parser.add_argument("--base-sha", default=None)
    parser.add_argument("--head-sha", default=None)
    parser.add_argument(
        "--output",
        default=os.getenv(
            "LCSP_DECISION_PR_TRIAGE_OUTPUT",
            "artifacts/decision/pr-review-triage.json",
        ),
    )
    parser.add_argument("--packet-only", action="store_true")
    parser.add_argument("--record-packet", default=None)
    parser.add_argument("--require-durable", action="store_true")
    parser.add_argument("--expected-pr-number", type=int, default=None)
    parser.add_argument("--expected-head-sha", default=None)
    parser.add_argument("--expected-base-sha", default=None)
    parser.add_argument("--trusted-authoritative-domain", default=None)
    parser.add_argument("--trusted-compare-json", default=None)
    parser.add_argument("--trusted-pr-title", default=None)
    parser.add_argument("--trusted-head-ref", default=None)
    parser.add_argument("--trusted-review-run-id", default=None)
    parser.add_argument("--trusted-ci-state-code", action="append", default=[])
    parser.add_argument("--require-trusted-metadata", action="store_true")
    args = parser.parse_args(argv)

    output_path = Path(args.output)
    try:
        if args.record_packet:
            record = record_pr_review_shadow_triage_packet(
                packet_path=Path(args.record_packet),
                output_path=output_path,
                require_durable=args.require_durable,
                expected_pr_number=args.expected_pr_number,
                expected_head_sha=args.expected_head_sha,
                expected_base_sha=args.expected_base_sha,
                trusted_authoritative_domain=args.trusted_authoritative_domain,
                trusted_compare_path=Path(args.trusted_compare_json)
                if args.trusted_compare_json
                else None,
                trusted_pr_title=args.trusted_pr_title,
                trusted_head_ref=args.trusted_head_ref,
                trusted_review_run_id=args.trusted_review_run_id,
                trusted_ci_state_codes=tuple(args.trusted_ci_state_code),
                require_trusted_metadata=args.require_trusted_metadata,
            )
        elif args.packet_only:
            record = write_pr_review_shadow_triage_packet(
                pr_number=args.pr_number,
                base_sha=args.base_sha,
                head_sha=args.head_sha,
                output_path=output_path,
            )
        else:
            record = run_pr_review_shadow_triage(
                pr_number=args.pr_number,
                base_sha=args.base_sha,
                head_sha=args.head_sha,
                output_path=output_path,
            )
        print(
            "LCSP PR-review shadow triage recorded "
            f"status={record.get('recordingStatus')} "
            f"decision_id={record.get('decisionId')}"
        )
    except Exception as exc:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(
                {
                    "skipped": True,
                    "fallbackReason": "PR_REVIEW_TRIAGE_OBSERVATION_FAILED",
                    "errorType": type(exc).__name__,
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        print(
            "LCSP PR-review shadow triage skipped "
            f"fallback=PR_REVIEW_TRIAGE_OBSERVATION_FAILED error={type(exc).__name__}"
        )
    return 0


def run_pr_review_shadow_triage(
    *,
    pr_number: int | None = None,
    base_sha: str | None = None,
    head_sha: str | None = None,
    output_path: Path,
    observer_factory: Callable[[JsonlTelemetrySink], ShadowDecisionObserver] | None = None,
) -> dict[str, Any]:
    event = _github_event()
    packet = build_packet_from_environment(
        event=event,
        pr_number=pr_number,
        base_sha=base_sha,
        head_sha=head_sha,
    )
    sink = JsonlTelemetrySink(output_path.with_suffix(".events.jsonl"))
    observer = observer_factory(sink) if observer_factory else _default_observer(sink)
    authoritative_domain = infer_authoritative_domain(packet.changed_filenames)
    return _record_packet(
        packet,
        authoritative_domain=authoritative_domain,
        output_path=output_path,
        sink=sink,
        observer=observer,
    )


def write_pr_review_shadow_triage_packet(
    *,
    pr_number: int | None = None,
    base_sha: str | None = None,
    head_sha: str | None = None,
    output_path: Path,
) -> dict[str, Any]:
    event = _github_event()
    packet = build_packet_from_environment(
        event=event,
        pr_number=pr_number,
        base_sha=base_sha,
        head_sha=head_sha,
    )
    payload = {
        "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
        "recordingStatus": "PACKET_READY_UNTRUSTED_PR_STAGE",
        "typedResultRecorded": False,
        "trustedRecorderRequired": True,
        "authoritativeReviewDomain": infer_authoritative_domain(packet.changed_filenames),
        "packet": _packet_payload(packet),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return payload


def record_pr_review_shadow_triage_packet(
    *,
    packet_path: Path,
    output_path: Path,
    require_durable: bool = False,
    expected_pr_number: int | None = None,
    expected_head_sha: str | None = None,
    expected_base_sha: str | None = None,
    trusted_authoritative_domain: str | None = None,
    trusted_compare_path: Path | None = None,
    trusted_pr_title: str | None = None,
    trusted_head_ref: str | None = None,
    trusted_review_run_id: str | None = None,
    trusted_ci_state_codes: tuple[str, ...] = (),
    require_trusted_metadata: bool = False,
    observer_factory: Callable[[JsonlTelemetrySink], ShadowDecisionObserver] | None = None,
) -> dict[str, Any]:
    packet_payload = json.loads(packet_path.read_text(encoding="utf-8"))
    packet = _packet_from_payload(packet_payload.get("packet"))
    authoritative_domain = _text(trusted_authoritative_domain)
    correlation_mismatches = _trusted_correlation_mismatches(
        packet,
        expected_pr_number=expected_pr_number,
        expected_head_sha=expected_head_sha,
        expected_base_sha=expected_base_sha,
    )
    if correlation_mismatches:
        payload = {
            **_packet_correlation(packet),
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
            "recordingStatus": "TYPED_RESULT_NOT_RECORDED_CORRELATION_MISMATCH",
            "typedResultRecorded": False,
            "authoritativeReviewDomain": authoritative_domain,
            "correlationMismatches": correlation_mismatches,
            "trustedCorrelation": _trusted_correlation_payload(
                expected_pr_number=expected_pr_number,
                expected_head_sha=expected_head_sha,
                expected_base_sha=expected_base_sha,
            ),
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        return payload
    trusted_metadata_error: str | None = None
    if trusted_compare_path is not None:
        try:
            packet = _trusted_packet_from_compare(
                source_packet=packet,
                compare_payload=json.loads(trusted_compare_path.read_text(encoding="utf-8")),
                expected_pr_number=expected_pr_number,
                expected_head_sha=expected_head_sha,
                expected_base_sha=expected_base_sha,
                trusted_pr_title=trusted_pr_title,
                trusted_head_ref=trusted_head_ref,
                trusted_review_run_id=trusted_review_run_id,
                trusted_ci_state_codes=trusted_ci_state_codes,
            )
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            trusted_metadata_error = type(exc).__name__
    elif require_trusted_metadata:
        trusted_metadata_error = "TRUSTED_COMPARE_JSON_MISSING"
    if trusted_metadata_error is not None:
        payload = {
            **_packet_correlation(packet),
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
            "recordingStatus": "TYPED_RESULT_NOT_RECORDED_TRUSTED_METADATA_INVALID",
            "typedResultRecorded": False,
            "authoritativeReviewDomain": authoritative_domain
            or infer_authoritative_domain(packet.changed_filenames),
            "trustedMetadataError": trusted_metadata_error,
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        return payload
    authoritative_domain = authoritative_domain or infer_authoritative_domain(
        packet.changed_filenames
    )
    if require_durable and _api_client_from_environment() is None and observer_factory is None:
        payload = {
            **_packet_correlation(packet),
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
            "recordingStatus": "TYPED_RESULT_NOT_RECORDED_DURABLE_CREDENTIALS_MISSING",
            "typedResultRecorded": False,
            "authoritativeReviewDomain": authoritative_domain,
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        return payload
    sink = JsonlTelemetrySink(output_path.with_suffix(".events.jsonl"))
    observer = (
        observer_factory(sink)
        if observer_factory
        else _default_observer(sink, require_durable=require_durable)
    )
    return _record_packet(
        packet,
        authoritative_domain=authoritative_domain,
        output_path=output_path,
        sink=sink,
        observer=observer,
    )


def _record_packet(
    packet: PrReviewTriagePacket,
    *,
    authoritative_domain: str,
    output_path: Path,
    sink: JsonlTelemetrySink,
    observer: ShadowDecisionObserver,
) -> dict[str, Any]:
    record = observer.observe_pr_review_triage(
        packet,
        authoritative_domain=authoritative_domain,
    )
    typed_result_recorded = (
        record.gateway_outcome is not None
        and record.gateway_outcome.provider_result is not None
        and not record.skipped
    )
    payload = {
        **shadow_record_payload(record),
        "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
        "recordingStatus": (
            "TYPED_RESULT_RECORDED"
            if typed_result_recorded
            else "TYPED_RESULT_NOT_RECORDED_FALLBACK"
        ),
        "typedResultRecorded": typed_result_recorded,
        "prNumber": packet.pr_number,
        "baseSha": packet.base_sha,
        "headSha": packet.head_sha,
        "authoritativeReviewDomain": authoritative_domain,
        "changedFileCount": len(packet.changed_filenames),
        "changeCategories": list(packet.change_categories),
        "ciStateCodes": list(packet.ci_state_codes),
        "eventCount": len(sink.events),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    return payload


def _trusted_correlation_mismatches(
    packet: PrReviewTriagePacket,
    *,
    expected_pr_number: int | None,
    expected_head_sha: str | None,
    expected_base_sha: str | None,
) -> list[str]:
    mismatches: list[str] = []
    if expected_pr_number is not None and packet.pr_number != expected_pr_number:
        mismatches.append("PR_NUMBER_MISMATCH")
    expected_head = _text(expected_head_sha)
    if expected_head and packet.head_sha != expected_head:
        mismatches.append("HEAD_SHA_MISMATCH")
    expected_base = _text(expected_base_sha)
    if expected_base and packet.base_sha != expected_base:
        mismatches.append("BASE_SHA_MISMATCH")
    return mismatches


def _trusted_correlation_payload(
    *,
    expected_pr_number: int | None,
    expected_head_sha: str | None,
    expected_base_sha: str | None,
) -> dict[str, Any]:
    return {
        "prNumber": expected_pr_number,
        "headSha": _text(expected_head_sha),
        "baseSha": _text(expected_base_sha),
    }


def _trusted_packet_from_compare(
    *,
    source_packet: PrReviewTriagePacket,
    compare_payload: Any,
    expected_pr_number: int | None,
    expected_head_sha: str | None,
    expected_base_sha: str | None,
    trusted_pr_title: str | None,
    trusted_head_ref: str | None,
    trusted_review_run_id: str | None,
    trusted_ci_state_codes: tuple[str, ...],
) -> PrReviewTriagePacket:
    files = compare_payload.get("files") if isinstance(compare_payload, dict) else None
    if not isinstance(files, list):
        raise ValueError("trusted GitHub compare payload is invalid")
    changed_filenames: list[str] = []
    additions = 0
    deletions = 0
    for entry in files:
        if not isinstance(entry, dict):
            raise ValueError("trusted GitHub compare file entry is invalid")
        filename = _text(entry.get("filename"))
        if not filename:
            continue
        changed_filenames.append(filename)
        additions += _int_or_none(entry.get("additions")) or 0
        deletions += _int_or_none(entry.get("deletions")) or 0
    if not changed_filenames:
        raise ValueError("trusted GitHub compare payload has no files")
    trusted_paths = tuple(dict.fromkeys(changed_filenames))
    categories = tuple(dict.fromkeys(_category_for_path(path) for path in trusted_paths))
    title = _text(trusted_pr_title)
    head_ref = _text(trusted_head_ref)
    jira_ids = tuple(
        dict.fromkeys(
            JIRA_ID_PATTERN.findall(" ".join(item for item in (title, head_ref) if item))
        )
    )
    return PrReviewTriagePacket(
        pr_number=expected_pr_number or source_packet.pr_number,
        head_sha=_text(expected_head_sha) or source_packet.head_sha,
        base_sha=_text(expected_base_sha) or source_packet.base_sha,
        review_run_id=_text(trusted_review_run_id) or source_packet.review_run_id,
        changed_filenames=trusted_paths,
        change_categories=categories,
        jira_issue_ids=jira_ids,
        acceptance_criteria_ids=(),
        bounded_summary=_bounded_summary(title=title, categories=categories),
        ci_state_codes=tuple(value for value in trusted_ci_state_codes if value),
        scanner_change_metadata=_scanner_metadata(trusted_paths),
        diff_stat_keys=_diff_stat_keys(trusted_paths),
        addition_count=additions,
        deletion_count=deletions,
        pge_artifact_version=_text(os.getenv("LCSP_PGE_ARTIFACT_VERSION")),
    )


def build_packet_from_environment(
    *,
    event: dict[str, Any],
    pr_number: int | None,
    base_sha: str | None,
    head_sha: str | None,
) -> PrReviewTriagePacket:
    pull_request = event.get("pull_request") if isinstance(event, dict) else None
    pull_request = pull_request if isinstance(pull_request, dict) else {}
    head = pull_request.get("head") if isinstance(pull_request.get("head"), dict) else {}
    base = pull_request.get("base") if isinstance(pull_request.get("base"), dict) else {}
    resolved_pr_number = pr_number or _int_or_none(pull_request.get("number")) or _int_or_none(event.get("number")) or 1
    resolved_head_sha = head_sha or _text(head.get("sha")) or _text(os.getenv("GITHUB_SHA")) or "unknown-head"
    resolved_base_sha = base_sha or _text(base.get("sha"))
    changed_filenames = tuple(_git_lines("diff", "--name-only", _diff_range(resolved_base_sha, resolved_head_sha)))
    numstat = tuple(_git_lines("diff", "--numstat", _diff_range(resolved_base_sha, resolved_head_sha)))
    addition_count, deletion_count = _numstat_totals(numstat)
    title = _text(pull_request.get("title"))
    branch = _text(head.get("ref"))
    jira_ids = tuple(dict.fromkeys(JIRA_ID_PATTERN.findall(" ".join(item for item in (title, branch) if item))))
    categories = tuple(dict.fromkeys(_category_for_path(path) for path in changed_filenames))
    return PrReviewTriagePacket(
        pr_number=resolved_pr_number,
        head_sha=resolved_head_sha,
        base_sha=resolved_base_sha,
        review_run_id=_text(os.getenv("GITHUB_RUN_ID")),
        changed_filenames=changed_filenames,
        change_categories=categories,
        jira_issue_ids=jira_ids,
        acceptance_criteria_ids=(),
        bounded_summary=_bounded_summary(title=title, categories=categories),
        ci_state_codes=_ci_state_codes(),
        scanner_change_metadata=_scanner_metadata(changed_filenames),
        diff_stat_keys=_diff_stat_keys(changed_filenames),
        addition_count=addition_count,
        deletion_count=deletion_count,
        pge_artifact_version=_text(os.getenv("LCSP_PGE_ARTIFACT_VERSION")),
    )


def infer_authoritative_domain(paths: tuple[str, ...]) -> str:
    domains = [_domain_for_path(path) for path in paths]
    for preferred in (
        "AUTH",
        "BILLING",
        "SCANNER",
        "AGENT_RUNTIME",
        "LEGAL_RULES",
        "CI_RELEASE",
        "WEB",
        "DATA",
    ):
        if preferred in domains:
            return preferred
    return "OTHER"


def _default_observer(
    sink: JsonlTelemetrySink,
    *,
    require_durable: bool = False,
) -> ShadowDecisionObserver:
    api_client = _api_client_from_environment()
    telemetry_sink: Callable[[dict[str, Any]], None] = sink
    idempotency_store: Any = InMemoryDecisionIdempotencyStore()
    if require_durable and api_client is None:
        raise RuntimeError("durable decision idempotency is required")
    if api_client is not None:
        api_sink = worker_api_decision_event_sink(api_client)

        def telemetry_sink(event: dict[str, Any]) -> None:
            sink(event)
            api_sink(event)

        idempotency_store = WorkerApiDecisionIdempotencyStore(api_client)
    return ShadowDecisionObserver(
        gateway=DecisionGateway(),
        telemetry_sink=telemetry_sink,
        idempotency_store=idempotency_store,
    )


def _packet_payload(packet: PrReviewTriagePacket) -> dict[str, Any]:
    return {key: value for key, value in asdict(packet).items() if value is not None}


def _packet_from_payload(payload: Any) -> PrReviewTriagePacket:
    if not isinstance(payload, dict):
        raise ValueError("PR-review triage packet payload is invalid")
    tuple_keys = {
        "changed_filenames",
        "change_categories",
        "jira_issue_ids",
        "acceptance_criteria_ids",
        "ci_state_codes",
        "scanner_change_metadata",
        "diff_stat_keys",
    }
    values = {
        key: tuple(value) if key in tuple_keys and isinstance(value, list) else value
        for key, value in payload.items()
    }
    return PrReviewTriagePacket(**values)


def _packet_correlation(packet: PrReviewTriagePacket) -> dict[str, Any]:
    return {
        "decisionId": f"review-triage-v1:{packet.pr_number}:{packet.head_sha}",
        "decisionType": "PR_REVIEW_TRIAGE",
        "prNumber": packet.pr_number,
        "baseSha": packet.base_sha,
        "headSha": packet.head_sha,
    }


def _api_client_from_environment() -> Any | None:
    base_url = _text(os.getenv("LCSP_API_BASE_URL"))
    api_key = _text(os.getenv("WORKER_API_KEY"))
    if not base_url or not api_key:
        return None
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    return WorkerApiClient(base_url, api_key)


def _github_event() -> dict[str, Any]:
    path = _text(os.getenv("GITHUB_EVENT_PATH"))
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _git_lines(*args: str) -> list[str]:
    try:
        result = subprocess.run(
            ("git", *args),
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _diff_range(base_sha: str | None, head_sha: str) -> str:
    return f"{base_sha}...{head_sha}" if base_sha else head_sha


def _numstat_totals(lines: tuple[str, ...]) -> tuple[int | None, int | None]:
    additions = 0
    deletions = 0
    saw_line = False
    for line in lines:
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        if parts[0].isdigit():
            additions += int(parts[0])
        if parts[1].isdigit():
            deletions += int(parts[1])
        saw_line = True
    return (additions, deletions) if saw_line else (None, None)


def _category_for_path(path: str) -> str:
    if path.startswith(".github/") or path.startswith("scripts/"):
        return "ci_release"
    if path.startswith("apps/web/"):
        return "web"
    if path.startswith("apps/api/"):
        return "api"
    if path.startswith("deepagents/"):
        return "python_worker"
    if "prisma/" in path or path.startswith("packages/contracts/"):
        return "data_contract"
    if path.startswith("docs/"):
        return "docs"
    if "/tests/" in path or path.endswith(".spec.ts") or path.endswith("_test.py"):
        return "tests"
    return "other"


def _domain_for_path(path: str) -> str:
    lowered = path.lower()
    if "auth" in lowered:
        return "AUTH"
    if "billing" in lowered:
        return "BILLING"
    if "scanner" in lowered or "program_graph" in lowered:
        return "SCANNER"
    if path.startswith("deepagents/decision/") or path.startswith("deepagents/orchestration/"):
        return "AGENT_RUNTIME"
    if "legal" in lowered or "engineering_rule" in lowered:
        return "LEGAL_RULES"
    if path.startswith(".github/") or path.startswith("scripts/"):
        return "CI_RELEASE"
    if path.startswith("apps/web/"):
        return "WEB"
    if "prisma/" in path or path.startswith("packages/contracts/"):
        return "DATA"
    return "OTHER"


def _bounded_summary(*, title: str | None, categories: tuple[str, ...]) -> str:
    parts = []
    if title:
        parts.append(title.strip()[:240])
    if categories:
        parts.append("categories=" + ",".join(categories[:12]))
    return " | ".join(parts)[:500] or "Bounded PR metadata only."


def _ci_state_codes() -> tuple[str, ...]:
    values = (
        "GITHUB_ACTIONS" if os.getenv("GITHUB_ACTIONS") == "true" else None,
        f"workflow:{_text(os.getenv('GITHUB_WORKFLOW'))}" if os.getenv("GITHUB_WORKFLOW") else None,
        f"job:{_text(os.getenv('GITHUB_JOB'))}" if os.getenv("GITHUB_JOB") else None,
        f"attempt:{_text(os.getenv('GITHUB_RUN_ATTEMPT'))}" if os.getenv("GITHUB_RUN_ATTEMPT") else None,
    )
    return tuple(value for value in values if value)


def _scanner_metadata(paths: tuple[str, ...]) -> tuple[str, ...]:
    values: list[str] = []
    if any(path.startswith("deepagents/tools/common/capabilities/evidence/") for path in paths):
        values.append("SCANNER_SURFACE_CHANGED")
    if any("program_graph" in path for path in paths):
        values.append("PGE_SURFACE_CHANGED")
    return tuple(values)


def _diff_stat_keys(paths: tuple[str, ...]) -> tuple[str, ...]:
    keys = {f"{_category_for_path(path)}_files_changed" for path in paths}
    return tuple(sorted(keys))


def _text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
