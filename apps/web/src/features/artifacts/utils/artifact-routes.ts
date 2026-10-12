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

type ArtifactOpenAction = (ref: ArtifactRef) => ArtifactOpenTarget;

export function buildArtifactOpenTarget(ref: ArtifactRef): ArtifactOpenTarget {
  return ref.type === ARTIFACT_TYPES.finalReport && ref.resourceId
    ? {
        kind: ARTIFACT_OPEN_KINDS.download,
        href: `/api/assessments/${encodeURIComponent(ref.assessmentId)}/artifacts/${encodeURIComponent(ref.resourceId)}/download`,
      }
    : { kind: ARTIFACT_OPEN_KINDS.unsupported };
}
