"""Build privacy-safe technical profiles from accepted Program Evidence Graph reports."""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any
from lcsp_workers.platform.redaction import redact_string
from lcsp_workers.scanner.dependencies.dependency_fact import is_ai_package
from .evidence_quality_evaluator import EvidenceQualityEvaluator

SCHEMA_VERSION = "2.0.0"
DEFAULT_PROVIDER_VERSION = "lcsp.technical-profile-worker.v2"
BUSINESS_NODE_TYPES = {"BUSINESS_ACTION", "STATUS_CHANGE", "APPROVAL", "REJECTION", "RANKING", "RECOMMENDATION", "NOTIFICATION"}
HUMAN_NODE_TYPES = {"HUMAN_REVIEW", "HUMAN_OVERRIDE"}
EXTERNAL_NODE_TYPES = {"EXTERNAL_SERVICE", "EXTERNAL_API", "AI_PROVIDER"}

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
    program_graph_ref: dict[str, Any] = field(default_factory=dict)
    data_categories: list[str] = field(default_factory=list)
    external_integrations: list[dict[str, Any]] = field(default_factory=list)
    business_actions: list[dict[str, Any]] = field(default_factory=list)
    human_control_evidence: dict[str, Any] = field(default_factory=dict)
    dependency_licenses: list[dict[str, Any]] = field(default_factory=list)
    unresolved_frontiers: list[str] = field(default_factory=list)

    def to_profile_data(self) -> dict[str, Any]:
        """Return the business payload persisted as technical profile data."""
        return asdict(self)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

class TechnicalProfileBuilder:
    """Aggregate accepted scan evidence into a privacy-safe technical profile."""
    def __init__(self, *, provider_version: str = DEFAULT_PROVIDER_VERSION, quality_evaluator: EvidenceQualityEvaluator | None = None) -> None:
        self._provider_version = provider_version
        self._quality_evaluator = quality_evaluator or EvidenceQualityEvaluator()

    def build(self, evidence_report: dict[str, Any]) -> TechnicalProfile:
        self._assert_accepted(evidence_report)
        evidence_payload = self._read_dict(evidence_report, "evidence_payload")
        privacy_flags = self._privacy_flags(evidence_report)
        self._assert_privacy(privacy_flags)
        ai_usage_signals = self._read_list(evidence_payload, "ai_usage_signals")
        tool_failures = self._read_list(evidence_payload, "tool_failures")
        coverage_notes = [str(note) for note in self._read_list(evidence_payload, "coverage_notes")]
        tools_version = self._read_dict(evidence_report, "tools_version")
        quality = self._quality_evaluator.evaluate(
            tools_version={str(k): str(v) for k, v in tools_version.items()},
            tool_failures=[item for item in tool_failures if isinstance(item, dict)],
            ai_usage_signals=[item for item in ai_usage_signals if isinstance(item, dict)],
            coverage_notes=coverage_notes,
        )
        graph = self._program_graph(evidence_payload)
        graph_summary = self._graph_summary(graph)
        profile = TechnicalProfile(
            schema_version=SCHEMA_VERSION,
            provider_version=self._provider_version,
            evidence_report_id=self._read_required_id(evidence_report, "id"),
            assessment_id=self._read_required_id(evidence_report, "assessment_id"),
            organization_id=self._read_required_id(evidence_report, "organization_id"),
            evidence_quality=quality.evidence_quality,
            coverage_notes=sorted(set([*quality.coverage_notes, *graph_summary["coverage_notes"]])),
            tool_coverage=quality.tool_coverage,
            ai_usage_signal_count=len(ai_usage_signals),
            signal_types_detected=self._signal_types(ai_usage_signals),
            dependency_ai_packages=self._dependency_ai_packages(evidence_payload),
            privacy_flags=privacy_flags,
            ai_detected="confirmed" if ai_usage_signals or graph_summary["ai_invocation_count"] else "not_detected",
            confidence=self._confidence(ai_usage_signal_count=max(len(ai_usage_signals), graph_summary["ai_invocation_count"]), failed_tool_count=sum(1 for value in quality.tool_coverage.values() if value is False)),
            evidence_refs=sorted(set([*self._evidence_refs(ai_usage_signals), *graph_summary["evidence_refs"]])),
            program_graph_ref=graph_summary["program_graph_ref"],
            data_categories=graph_summary["data_categories"],
            external_integrations=graph_summary["external_integrations"],
            business_actions=graph_summary["business_actions"],
            human_control_evidence=graph_summary["human_control_evidence"],
            dependency_licenses=graph_summary["dependency_licenses"],
            unresolved_frontiers=graph_summary["unresolved_frontiers"],
        )
        self._assert_profile_has_no_secret_strings(profile.to_profile_data())
        return profile

    def _program_graph(self, evidence_payload: dict[str, Any]) -> dict[str, Any]:
        value = evidence_payload.get("evidence_graph") or evidence_payload.get("program_evidence_graph") or evidence_payload.get("programEvidenceGraph")
        if isinstance(value, dict):
            import json
            import os
            ref = value.get("evidence_graph_ref") or value.get("evidenceGraphRef")
            if ref and isinstance(ref, str) and os.path.exists(ref):
                try:
                    with open(ref, "r") as f:
                        file_payload = json.load(f)
                        if isinstance(file_payload, dict):
                            return {**file_payload, **value}
                except Exception:
                    pass
            return value
        return {}

    def _graph_summary(self, graph: dict[str, Any]) -> dict[str, Any]:
        nodes = [node for node in graph.get("nodes") or [] if isinstance(node, dict)]
        data_categories = sorted({str(value) for node in nodes for value in node.get("semantic_types") or node.get("semanticTypes") or [] if str(value).startswith(("PII.", "SENSITIVE.")) or str(value) == "SECRET"})
        external_integrations = []
        business_actions = []
        dependency_licenses = []
        ai_invocation_count = 0
        human_counts = {"reviewNodes": 0, "overrideNodes": 0}
        for node in nodes:
            node_type = str(node.get("node_type") or node.get("nodeType") or "")
            attrs = node.get("attributes") if isinstance(node.get("attributes"), dict) else {}
            source = node.get("source") if isinstance(node.get("source"), dict) else {}
            evidence_refs = [str(ref) for ref in node.get("evidence_refs") or node.get("evidenceRefs") or [] if str(ref)]
            base = {"nodeId": str(node.get("node_id") or node.get("nodeId") or ""), "type": node_type, "label": str(node.get("label") or ""), "filePath": str(source.get("file_path") or source.get("filePath") or ""), "symbolRef": str(source.get("symbol_ref") or source.get("symbolRef") or ""), "evidenceRefs": evidence_refs}
            if node_type == "AI_MODEL_INVOCATION": ai_invocation_count += 1
            if node_type in EXTERNAL_NODE_TYPES:
                external_integrations.append({**base, "host": str(attrs.get("host") or ""), "provider": str(attrs.get("provider") or ""), "integrationType": str(attrs.get("integrationType") or node_type)})
            if node_type in BUSINESS_NODE_TYPES:
                business_actions.append({**base, "actionCategory": str(attrs.get("actionCategory") or node_type)})
            if node_type == "HUMAN_REVIEW": human_counts["reviewNodes"] += 1
            if node_type == "HUMAN_OVERRIDE": human_counts["overrideNodes"] += 1
            if node_type == "PACKAGE_DEPENDENCY" and attrs.get("licenseExpression"):
                dependency_licenses.append({"package": str(node.get("label") or ""), "version": str(attrs.get("version") or ""), "licenseExpression": str(attrs.get("licenseExpression")), "usageStates": list(attrs.get("usageStates") or []), "nodeId": base["nodeId"]})
        graph_refs = [str(ref) for ref in graph.get("evidence_refs") or graph.get("evidenceRefs") or [] if str(ref)]
        graph_ref = {}
        graph_id = graph.get("graph_id") or graph.get("graphId")
        if graph_id:
            graph_ref = {"graphId": str(graph_id), "schemaVersion": str(graph.get("schema_version") or graph.get("schemaVersion") or ""), "graphHash": str(graph.get("graph_hash") or graph.get("graphHash") or ""), "nodeCount": int(graph.get("node_count") or graph.get("nodeCount") or len(nodes)), "edgeCount": int(graph.get("edge_count") or graph.get("edgeCount") or len(graph.get("edges") or [])), "coverageState": str(graph.get("coverage_state") or graph.get("coverageState") or "UNKNOWN")}
        return {
            "program_graph_ref": graph_ref,
            "data_categories": data_categories,
            "external_integrations": sorted(external_integrations, key=lambda item: (item["type"], item["label"], item["nodeId"])),
            "business_actions": sorted(business_actions, key=lambda item: (item["actionCategory"], item["nodeId"])),
            "human_control_evidence": {**human_counts, "state": "PRESENT" if sum(human_counts.values()) else "NOT_EVIDENCED"},
            "dependency_licenses": sorted(dependency_licenses, key=lambda item: item["package"]),
            "unresolved_frontiers": sorted(str(value) for value in graph.get("unresolved_frontiers") or graph.get("unresolvedFrontiers") or []),
            "coverage_notes": [str(value) for value in graph.get("coverage_notes") or graph.get("coverageNotes") or []],
            "evidence_refs": graph_refs,
            "ai_invocation_count": ai_invocation_count,
        }

    def _assert_accepted(self, evidence_report: dict[str, Any]) -> None:
        status = str(evidence_report.get("status", "")).strip().lower()
        if status and status != "accepted": raise ValueError("TechnicalProfile requires accepted TechnicalEvidenceReport")

    def _privacy_flags(self, evidence_report: dict[str, Any]) -> dict[str, bool]:
        raw_flags = self._read_dict(evidence_report, "privacy_flags")
        return {"containsSourceCode": bool(raw_flags.get("containsSourceCode", False)), "secretsRedacted": bool(raw_flags.get("secretsRedacted", True))}

    def _assert_privacy(self, privacy_flags: dict[str, bool]) -> None:
        if privacy_flags["containsSourceCode"]: raise PrivacyAssertionError("technical profile input contains source code")
        if not privacy_flags["secretsRedacted"]: raise PrivacyAssertionError("technical profile input contains secrets")

    def _signal_types(self, ai_usage_signals: list[Any]) -> list[str]:
        return sorted({str(signal.get("signal_type", "")).strip() for signal in ai_usage_signals if isinstance(signal, dict) and signal.get("signal_type")})

    def _dependency_ai_packages(self, evidence_payload: dict[str, Any]) -> list[str]:
        return sorted({str(entry.get("name", "")).strip() for entry in self._read_list(evidence_payload, "sbom_entries") if isinstance(entry, dict) and entry.get("name") and is_ai_package(str(entry.get("name")))})

    def _evidence_refs(self, ai_usage_signals: list[Any]) -> list[str]:
        refs: set[str] = set()
        for signal in ai_usage_signals:
            if not isinstance(signal, dict): continue
            for key in ("evidence_ref", "evidence_ref_id", "id", "rule_id"):
                value = signal.get(key)
                if value:
                    refs.add(str(value)); break
        return sorted(refs)

    def _confidence(self, *, ai_usage_signal_count: int, failed_tool_count: int) -> float:
        base = 0.55 if ai_usage_signal_count == 0 else 0.75
        return round(max(0.0, min(1.0, base + min(ai_usage_signal_count * 0.05, 0.15) - min(failed_tool_count * 0.15, 0.30))), 2)

    def _assert_profile_has_no_secret_strings(self, value: Any) -> None:
        if isinstance(value, dict):
            for nested_value in value.values(): self._assert_profile_has_no_secret_strings(nested_value)
            return
        if isinstance(value, list):
            for nested_value in value: self._assert_profile_has_no_secret_strings(nested_value)
            return
        if isinstance(value, str) and redact_string(value) != value: raise PrivacyAssertionError("technical profile contains unredacted secrets")

    def _read_required_id(self, payload: dict[str, Any], key: str) -> str:
        value = payload.get(key) or payload.get(self._to_camel_case(key))
        if not value: raise ValueError(f"missing required field: {key}")
        return str(value)

    def _read_dict(self, payload: dict[str, Any], key: str) -> dict[str, Any]:
        value = payload.get(key) or payload.get(self._to_camel_case(key)); return value if isinstance(value, dict) else {}

    def _read_list(self, payload: dict[str, Any], key: str) -> list[Any]:
        value = payload.get(key) or payload.get(self._to_camel_case(key)); return value if isinstance(value, list) else []

    @staticmethod
    def _to_camel_case(key: str) -> str:
        parts = key.split("_"); return parts[0] + "".join(part.title() for part in parts[1:])
