import { resolveAppMessage } from "@/lib/i18n";
import { ARTIFACT_STATUSES, type ArtifactStatus } from "../types/artifact.types";

export function ArtifactStatusBadge({ status }: { status: ArtifactStatus }) {
  const labels: Record<ArtifactStatus, string> = {
    [ARTIFACT_STATUSES.ready]: resolveAppMessage("pages.artifacts.status.ready"),
    [ARTIFACT_STATUSES.waiting]: resolveAppMessage("pages.artifacts.status.waiting"),
    [ARTIFACT_STATUSES.updating]: resolveAppMessage("pages.artifacts.status.updating"),
    [ARTIFACT_STATUSES.paused]: resolveAppMessage("pages.artifacts.status.paused"),
    [ARTIFACT_STATUSES.unavailable]: resolveAppMessage("pages.artifacts.status.unavailable"),
  };
  const ready = status === ARTIFACT_STATUSES.ready;
  return (
    <span className={ready ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300" : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"}>
      {labels[status]}
    </span>
  );
}
