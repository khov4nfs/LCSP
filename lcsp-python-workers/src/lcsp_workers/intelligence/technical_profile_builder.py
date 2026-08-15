"""Build privacy-safe technical profiles from accepted evidence reports."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from lcsp_workers.platform.redaction import redact_string
from lcsp_workers.scanner.dependencies.dependency_fact import is_ai_package

from .evidence_quality_evaluator import EvidenceQualityEvaluator


SCHEMA_VERSION = "1.0.0"
DEFAULT_PROVIDER_VERSION = "lcsp.technical-profile-worker.v1"


class PrivacyAssertionError(RuntimeError):
    """Raised when evidence or profile payload violates privacy guardrails."""


@dataclass(frozen=True)
class TechnicalProfile:
    """Normalized technical-evidence artifact consumed by later intelligence flows."""

    schema_version: str
    provider_version: str
    evidence_report_id: str
    assessment_id: str
    organization_id: str
    evidence_quality: str
    coverage_notes: list[str]
    tool_coverage: dict[str, bool]
    ai_usage_signal_count: int
    signal_types_detected: list[str]
    dependency_ai_packages: list[str]
    privacy_flags: dict[str, bool]
    ai_detected: str
    confidence: float
    evidence_refs: list[str]

    def to_profile_data(self) -> dict[str, Any]:
        """Return the business payload persisted as technical profile data."""
        return {
            "schema_version": self.schema_version,
            "provider_version": self.provider_version,
            "evidence_report_id": self.evidence_report_id,
            "assessment_id": self.assessment_id,
            "organization_id": self.organization_id,
            "evidence_quality": self.evidence_quality,
            "coverage_notes": list(self.coverage_notes),
            "tool_coverage": dict(self.tool_coverage),
            "ai_usage_signal_count": self.ai_usage_signal_count,
            "signal_types_detected": list(self.signal_types_detected),
            "dependency_ai_packages": list(self.dependency_ai_packages),
            "privacy_flags": dict(self.privacy_flags),
            "ai_detected": self.ai_detected,
            "confidence": self.confidence,
            "evidence_refs": list(self.evidence_refs),
        }

    def to_dict(self) -> dict[str, Any]:
        """Serialize the complete dataclass including envelope metadata."""
        return asdict(self)


class TechnicalProfileBuilder:
    """Aggregate accepted scan evidence into a privacy-safe technical profile."""

    def __init__(
        self,
        *,
        provider_version: str = DEFAULT_PROVIDER_VERSION,
        quality_evaluator: EvidenceQualityEvaluator | None = None,
    ) -> None:
        """Create a profile builder.

        Args:
            provider_version: Worker/version identifier embedded in produced profiles.
            quality_evaluator: Optional deterministic evidence-quality evaluator.
        """
        self._provider_version = provider_version
        self._quality_evaluator = quality_evaluator or EvidenceQualityEvaluator()

    def build(self, evidence_report: dict[str, Any]) -> TechnicalProfile:
        """Build a technical profile from one accepted evidence report.

        The builder validates upstream status/privacy flags, derives tool/evidence
        quality and AI signal summaries, then performs a final recursive secret
        assertion before returning the artifact.

        Args:
            evidence_report: Persisted TechnicalEvidenceReport payload.

        Returns:
            Normalized ``TechnicalProfile``.

        Raises:
            ValueError: If the report is not accepted or required identifiers are missing.
            PrivacyAssertionError: If source code or unredacted secrets are detected.
        """
        self._assert_accepted(evidence_report)
        evidence_payload = self._read_dict(evidence_report, "evidence_payload")
        privacy_flags = self._privacy_flags(evidence_report)
        self._assert_privacy(privacy_flags)

        ai_usage_signals = self._read_list(evidence_payload, "ai_usage_signals")
        tool_failures = self._read_list(evidence_payload, "tool_failures")
        coverage_notes = [
            str(note) for note in self._read_list(evidence_payload, "coverage_notes")
        ]
        tools_version = self._read_dict(evidence_report, "tools_version")

        quality = self._quality_evaluator.evaluate(
            tools_version={str(k): str(v) for k, v in tools_version.items()},
            tool_failures=[
                item for item in tool_failures if isinstance(item, dict)
            ],
            ai_usage_signals=[
                item for item in ai_usage_signals if isinstance(item, dict)
            ],
            coverage_notes=coverage_notes,
        )

        profile = TechnicalProfile(
            schema_version=SCHEMA_VERSION,
            provider_version=self._provider_version,
            evidence_report_id=self._read_required_id(evidence_report, "id"),
            assessment_id=self._read_required_id(evidence_report, "assessment_id"),
            organization_id=self._read_required_id(evidence_report, "organization_id"),
            evidence_quality=quality.evidence_quality,
            coverage_notes=quality.coverage_notes,
            tool_coverage=quality.tool_coverage,
            ai_usage_signal_count=len(ai_usage_signals),
            signal_types_detected=self._signal_types(ai_usage_signals),
            dependency_ai_packages=self._dependency_ai_packages(evidence_payload),
            privacy_flags=privacy_flags,
            ai_detected="confirmed" if ai_usage_signals else "not_detected",
            confidence=self._confidence(
                ai_usage_signal_count=len(ai_usage_signals),
                failed_tool_count=sum(
                    1 for value in quality.tool_coverage.values() if value is False
                ),
            ),
            evidence_refs=self._evidence_refs(ai_usage_signals),
        )
        self._assert_profile_has_no_secret_strings(profile.to_profile_data())
        return profile

    def _assert_accepted(self, evidence_report: dict[str, Any]) -> None:
        """Reject reports explicitly marked with any status other than accepted."""
        status = str(evidence_report.get("status", "")).strip().lower()
        if status and status != "accepted":
            raise ValueError("TechnicalProfile requires accepted TechnicalEvidenceReport")

    def _privacy_flags(self, evidence_report: dict[str, Any]) -> dict[str, bool]:
        """Normalize source-code and secret-redaction privacy flags."""
        raw_flags = self._read_dict(evidence_report, "privacy_flags")
        return {
            "containsSourceCode": bool(raw_flags.get("containsSourceCode", False)),
            "secretsRedacted": bool(raw_flags.get("secretsRedacted", True)),
        }

    def _assert_privacy(self, privacy_flags: dict[str, bool]) -> None:
        """Fail closed when upstream privacy assertions are unsafe."""
        if privacy_flags["containsSourceCode"]:
            raise PrivacyAssertionError("technical profile input contains source code")
        if not privacy_flags["secretsRedacted"]:
            raise PrivacyAssertionError("technical profile input contains secrets")

    def _signal_types(self, ai_usage_signals: list[Any]) -> list[str]:
        """Return sorted unique signal types from structured AI usage evidence."""
        signal_types = {
            str(signal.get("signal_type", "")).strip()
            for signal in ai_usage_signals
            if isinstance(signal, dict) and signal.get("signal_type")
        }
        return sorted(signal_types)

    def _dependency_ai_packages(self, evidence_payload: dict[str, Any]) -> list[str]:
        """Extract unique SBOM package names recognized as AI dependencies."""
        names = {
            str(entry.get("name", "")).strip()
            for entry in self._read_list(evidence_payload, "sbom_entries")
            if isinstance(entry, dict)
            and entry.get("name")
            and is_ai_package(str(entry.get("name")))
        }
        return sorted(names)

    def _evidence_refs(self, ai_usage_signals: list[Any]) -> list[str]:
        """Collect stable evidence identifiers from AI usage signals."""
        refs: set[str] = set()
        for signal in ai_usage_signals:
            if not isinstance(signal, dict):
                continue
            for key in ("evidence_ref", "evidence_ref_id", "id", "rule_id"):
                value = signal.get(key)
                if value:
                    refs.add(str(value))
                    break
        return sorted(refs)

    def _confidence(
        self,
        *,
        ai_usage_signal_count: int,
        failed_tool_count: int,
    ) -> float:
        """Calculate a bounded profile confidence from signal and coverage counts."""
        base = 0.55 if ai_usage_signal_count == 0 else 0.75
        signal_bonus = min(ai_usage_signal_count * 0.05, 0.15)
        coverage_penalty = min(failed_tool_count * 0.15, 0.30)
        return round(max(0.0, min(1.0, base + signal_bonus - coverage_penalty)), 2)

    def _assert_profile_has_no_secret_strings(self, value: Any) -> None:
        """Recursively assert that no produced profile string triggers redaction."""
        if isinstance(value, dict):
            for nested_value in value.values():
                self._assert_profile_has_no_secret_strings(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value:
                self._assert_profile_has_no_secret_strings(nested_value)
            return
        if isinstance(value, str) and redact_string(value) != value:
            raise PrivacyAssertionError("technical profile contains unredacted secrets")

    def _read_required_id(self, payload: dict[str, Any], key: str) -> str:
        """Read a required identifier from snake_case or camelCase payloads."""
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        if not value:
            raise ValueError(f"missing required field: {key}")
        return str(value)

    def _read_dict(self, payload: dict[str, Any], key: str) -> dict[str, Any]:
        """Read a mapping field from snake_case or camelCase payloads."""
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        return value if isinstance(value, dict) else {}

    def _read_list(self, payload: dict[str, Any], key: str) -> list[Any]:
        """Read a list field from snake_case or camelCase payloads."""
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        return value if isinstance(value, list) else []

    def _to_camel_case(self, key: str) -> str:
        """Convert an internal snake_case field name to its API camelCase alias."""
        parts = key.split("_")
        return parts[0] + "".join(part.title() for part in parts[1:])
