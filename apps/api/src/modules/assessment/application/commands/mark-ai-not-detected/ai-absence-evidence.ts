import {
  AI_DISCOVERY_EVIDENCE_STATES,
  AI_DISCOVERY_GATES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
} from "@lcsp/contracts/evidence";

const BLOCKING_AI_EVIDENCE_STATES: ReadonlySet<string> = new Set([
  AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall,
  AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall,
  AI_DISCOVERY_EVIDENCE_STATES.aiProviderReference,
  AI_DISCOVERY_EVIDENCE_STATES.unresolvedDynamic,
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEmptyList(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Re-validates, server side, that an accepted evidence payload proves AI absence.
 *
 * Mirrors docs/architecture/ai-discovery-gate.md: `AI_ABSENT_CONFIRMED` is only legal
 * under READY technical and AI coverage with no positive or unresolved AI signal.
 *
 * @param evidencePayload - Persisted `TechnicalEvidenceReport.evidencePayload`.
 * @returns True only when the payload is a complete, READY absence proof.
 */
export function provesAiAbsence(evidencePayload: unknown): boolean {
  const payload = asRecord(evidencePayload);
  const discovery = asRecord(payload?.ai_discovery ?? payload?.aiDiscovery);
  if (!payload || !discovery) return false;
  if (discovery.gate !== AI_DISCOVERY_GATES.absentConfirmed) return false;

  const ready = ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready;
  const discoveryCoverage = discovery.coverage_state ?? discovery.coverageState;
  if (discoveryCoverage !== ready) return false;
  const graph = asRecord(payload.evidence_graph ?? payload.evidenceGraph);
  const technicalCoverage =
    payload.technicalCoverageState ??
    graph?.coverage_state ??
    graph?.coverageState;
  if (technicalCoverage !== ready) return false;

  if (
    !isEmptyList(
      discovery.material_unresolved_frontiers ??
        discovery.materialUnresolvedFrontiers,
    ) ||
    !isEmptyList(graph?.unresolved_frontiers ?? graph?.unresolvedFrontiers)
  ) {
    return false;
  }
  const findings = discovery.findings;
  if (!isEmptyList(findings) && !Array.isArray(findings)) return false;
  return (Array.isArray(findings) ? findings : []).every((finding) => {
    const state = asRecord(finding)?.state;
    return typeof state === "string" && !BLOCKING_AI_EVIDENCE_STATES.has(state);
  });
}
