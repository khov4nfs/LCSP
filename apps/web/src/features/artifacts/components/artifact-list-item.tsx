import Link from "next/link";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { resolveAppMessage } from "@/lib/i18n";
import { ArtifactStatusBadge } from "./artifact-status-badge";
import { ARTIFACT_OPEN_KINDS, buildArtifactOpenTarget } from "../utils/artifact-routes";
import type { ArtifactListItemModel } from "../types/artifact.types";

export function ArtifactListItem({ item }: { item: ArtifactListItemModel }) {
  const target = buildArtifactOpenTarget(item.ref);
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileTextIcon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        {item.context ? <span className="block truncate text-xs text-muted-foreground">{item.context}</span> : null}
      </span>
      <ArtifactStatusBadge status={item.status} />
      <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
  if (target.kind === ARTIFACT_OPEN_KINDS.internal || target.kind === ARTIFACT_OPEN_KINDS.download) {
    return <Link href={target.href} className="flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50" aria-label={`${resolveAppMessage("pages.artifacts.open")} ${item.title}`}>{content}</Link>;
  }
  return <div className="flex min-w-0 items-center gap-3 rounded-xl border p-3 opacity-70">{content}</div>;
}
