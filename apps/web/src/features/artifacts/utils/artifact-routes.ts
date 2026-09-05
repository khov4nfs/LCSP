import { ARTIFACT_TYPES, type ArtifactRef } from "../types/artifact.types";

export const ARTIFACT_OPEN_KINDS = {
  internal: "INTERNAL",
  download: "DOWNLOAD",
  unsupported: "UNSUPPORTED",
} as const;

export type ArtifactOpenTarget =
  | { kind: typeof ARTIFACT_OPEN_KINDS.internal; href: string }
  | { kind: typeof ARTIFACT_OPEN_KINDS.download; href: string }
  | { kind: typeof ARTIFACT_OPEN_KINDS.unsupported };

export type ArtifactOpenAction = (ref: ArtifactRef) => ArtifactOpenTarget;

export function buildArtifactOpenTarget(ref: ArtifactRef): ArtifactOpenTarget {
  const assessment = `/assessments/${encodeURIComponent(ref.assessmentId)}`;
  switch (ref.type) {
    case ARTIFACT_TYPES.finalReport:
    case ARTIFACT_TYPES.gapAnalysis:
    case ARTIFACT_TYPES.readinessExport:
      return ref.resourceId
        ? { kind: ARTIFACT_OPEN_KINDS.download, href: `${assessment}/documents/${encodeURIComponent(ref.resourceId)}/download` }
        : { kind: ARTIFACT_OPEN_KINDS.unsupported };
    case ARTIFACT_TYPES.businessContext:
    case ARTIFACT_TYPES.programEvidenceGraph:
    case ARTIFACT_TYPES.evidenceGraph:
    case ARTIFACT_TYPES.findingsReport:
    case ARTIFACT_TYPES.technicalEvidence:
    case ARTIFACT_TYPES.repositorySnapshot:
    case ARTIFACT_TYPES.scanJob:
    case ARTIFACT_TYPES.investigationNotes:
      return { kind: ARTIFACT_OPEN_KINDS.internal, href: assessment };
    default:
      return { kind: ARTIFACT_OPEN_KINDS.unsupported };
  }
}
