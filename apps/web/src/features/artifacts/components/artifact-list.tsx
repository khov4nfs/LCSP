import { DocumentGalleryCard } from "@/components/molecules/document-gallery-card";
import {
  DOCUMENT_VIEW_MODES,
  type DocumentViewMode,
} from "@/components/molecules/gallery-list-toggle";
import { resolveAppMessage } from "@/lib/i18n";

import type { ArtifactGroup } from "../types/artifact.types";
import {
  ARTIFACT_OPEN_KINDS,
  buildArtifactOpenTarget,
} from "../utils/artifact-routes";
import { ArtifactListItem } from "./artifact-list-item";
import { ArtifactStatusBadge } from "./artifact-status-badge";

/**
 * Business purpose: Render grouped artifacts in either shared `DocumentGalleryCard` gallery mode or `ArtifactListItem` list mode.
 * Business rules:
 * - Only `internal` or `download` artifact targets render an active open link; unavailable items omit the link.
 * Execution flow:
 * 1. Render each assessment group header.
 * 2. Render `DocumentGalleryCard` grid in `gallery` mode or `ArtifactListItem` grid in `list` mode.
 * Failure cases:
 * - Empty `groups` renders an empty container.
 * Side effects:
 * - Pure presentational component.
 */
export function ArtifactList({
  groups,
  mode = DOCUMENT_VIEW_MODES.list,
}: {
  groups: ArtifactGroup[];
  mode?: DocumentViewMode;
}) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section
          key={group.assessmentId}
          aria-labelledby={`artifact-group-${group.assessmentId}`}
        >
          <div className="mb-3">
            <h2
              id={`artifact-group-${group.assessmentId}`}
              className="text-base font-semibold text-foreground"
            >
              {group.title}
            </h2>
            {group.context ? (
              <p className="text-sm text-muted-foreground">
                {group.context}
                {group.updatedAt ? ` · ${group.updatedAt}` : ""}
              </p>
            ) : null}
          </div>

          {mode === DOCUMENT_VIEW_MODES.gallery ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.artifacts.map((item) => {
                const target = buildArtifactOpenTarget(item.ref);
                const canOpen =
                  target.kind === ARTIFACT_OPEN_KINDS.internal ||
                  target.kind === ARTIFACT_OPEN_KINDS.download;

                return (
                  <DocumentGalleryCard
                    key={`${item.ref.type}-${item.ref.resourceId ?? "synthetic"}`}
                    title={item.title}
                    status={<ArtifactStatusBadge status={item.status} />}
                    source={group.title}
                    date={group.updatedAt ?? "—"}
                    actionLabel={
                      canOpen
                        ? resolveAppMessage("pages.artifacts.open")
                        : undefined
                    }
                    actionHref={canOpen ? target.href : undefined}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {group.artifacts.map((item) => (
                <ArtifactListItem
                  key={`${item.ref.type}-${item.ref.resourceId ?? "synthetic"}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
