import Link from "next/link";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import { ArtifactStatusBadge } from "@/features/artifacts/components/artifact-status-badge";
import { ARTIFACT_TYPES } from "@/features/artifacts/types/artifact.types";
import {
  ARTIFACT_OPEN_KINDS,
  buildArtifactOpenTarget,
} from "@/features/artifacts/utils/artifact-routes";
import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  type NormalizedAssessmentArtifactItem,
} from "../../../workspace/types/assessment-runtime-adapter.types";

export function ArtifactEvidenceRow({
  item,
  onOpenArtifact,
}: {
  item: NormalizedAssessmentArtifactItem;
  onOpenArtifact?: (
    ref: NormalizedAssessmentArtifactItem["ref"],
    trigger?: HTMLElement | null,
  ) => void;
}) {
  const target = buildArtifactOpenTarget(item.ref);
  const label = resolveAppMessage(`pages.${item.labelKey}` as MessageKey);
  const isTextArtifact =
    item.ref.type === ARTIFACT_TYPES.businessContext ||
    item.ref.type === ARTIFACT_TYPES.investigationNotes;
  const canOpenWithViewer = Boolean(
    onOpenArtifact &&
      (item.ref.type === ARTIFACT_TYPES.programEvidenceGraph ||
        (isTextArtifact &&
          item.availability === ASSESSMENT_ARTIFACT_AVAILABILITIES.ready)),
  );
  const showOpenIndicator =
    canOpenWithViewer ||
    (!isTextArtifact && target.kind !== ARTIFACT_OPEN_KINDS.unsupported);
  const content = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <FileTextIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        {item.customerSafeSummary ? (
          <span className="block truncate text-[0.6875rem] text-muted-foreground">
            {item.customerSafeSummary}
          </span>
        ) : null}
      </span>
      <ArtifactStatusBadge status={item.status} />
      {showOpenIndicator ? (
        <ArrowUpRightIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
  if (canOpenWithViewer && onOpenArtifact)
    return (
      <button
        type="button"
        onClick={(event) => onOpenArtifact(item.ref, event.currentTarget)}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/50"
        aria-label={`${resolveAppMessage("pages.artifacts.open" as MessageKey)} ${label}`}
      >
        {content}
      </button>
    );
  if (isTextArtifact) {
    return (
      <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 opacity-70">
        {content}
      </div>
    );
  }
  if (
    target.kind === ARTIFACT_OPEN_KINDS.internal ||
    target.kind === ARTIFACT_OPEN_KINDS.download
  )
    return (
      <Link
        href={target.href}
        className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 transition-colors hover:bg-muted/50"
        aria-label={`${resolveAppMessage("pages.artifacts.open" as MessageKey)} ${label}`}
      >
        {content}
      </Link>
    );
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 opacity-70">
      {content}
    </div>
  );
}
