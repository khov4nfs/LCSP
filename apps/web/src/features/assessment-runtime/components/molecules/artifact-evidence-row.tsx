import Link from "next/link";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import { ArtifactStatusBadge } from "@/features/artifacts/components/artifact-status-badge";
import { ARTIFACT_OPEN_KINDS, buildArtifactOpenTarget } from "@/features/artifacts/utils/artifact-routes";
import type { NormalizedAssessmentArtifactItem } from "../../../workspace/types/assessment-runtime-adapter.types";

export function ArtifactEvidenceRow({ item }: { item: NormalizedAssessmentArtifactItem }) {
  const target = buildArtifactOpenTarget(item.ref);
  const label = resolveAppMessage(`pages.${item.labelKey}` as MessageKey);
  const content = <><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileTextIcon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{label}</span>{item.customerSafeSummary ? <span className="block truncate text-[0.6875rem] text-muted-foreground">{item.customerSafeSummary}</span> : null}</span><ArtifactStatusBadge status={item.status} />{target.kind !== ARTIFACT_OPEN_KINDS.unsupported ? <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}</>;
  if (target.kind === ARTIFACT_OPEN_KINDS.internal || target.kind === ARTIFACT_OPEN_KINDS.download) return <Link href={target.href} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 transition-colors hover:bg-muted/50" aria-label={`${resolveAppMessage("pages.artifacts.open" as MessageKey)} ${label}`}>{content}</Link>;
  return <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-2.5 opacity-70">{content}</div>;
}
