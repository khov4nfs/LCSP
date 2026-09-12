import type { MessageKey } from "@lcsp/i18n";
import type { AdminCorpusStatusSummary } from "@lcsp/contracts/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminCorpusStatusCardProps = {
  corpusStatus?: AdminCorpusStatusSummary | null;
  isLoading?: boolean;
  className?: string;
};

export function AdminCorpusStatusCard({
  corpusStatus,
  isLoading = false,
  className,
}: AdminCorpusStatusCardProps) {
  const title = resolveAppMessage(
    "pages.admin.overview.corpusStatus.title" as MessageKey,
  );
  const subtitle = resolveAppMessage(
    "pages.admin.overview.corpusStatus.subtitle" as MessageKey,
  );
  const currentLabel = resolveAppMessage(
    "pages.admin.overview.corpusStatus.currentLabel" as MessageKey,
  );
  const draftLabel = resolveAppMessage(
    "pages.admin.overview.corpusStatus.draftLabel" as MessageKey,
  );
  const noPublishedText = resolveAppMessage(
    "pages.admin.overview.corpusStatus.noPublished" as MessageKey,
  );
  const noDraftText = resolveAppMessage(
    "pages.admin.overview.corpusStatus.noDraft" as MessageKey,
  );
  const subtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.corpusSubtitle" as MessageKey,
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
          className,
        )}
      >
        <div className="space-y-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-48" />
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </div>
    );
  }

  const current = corpusStatus?.current;
  const draft = corpusStatus?.draft;

  const currentRuleCount =
    current?.ruleCount === null || current?.ruleCount === undefined
      ? "—"
      : String(current.ruleCount);

  const draftRuleCount =
    draft?.ruleCount === null || draft?.ruleCount === undefined
      ? "—"
      : String(draft.ruleCount);

  const hasCorpusStatus = corpusStatus !== undefined && corpusStatus !== null;

  const currentDetails = current
    ? subtitleTemplate
        .replace("{sources}", String(current.sourceCount))
        .replace("{rules}", currentRuleCount)
    : hasCorpusStatus
      ? noPublishedText
      : "—";

  const draftDetails = draft
    ? subtitleTemplate
        .replace("{sources}", String(draft.sourceCount))
        .replace("{rules}", draftRuleCount)
    : "—";

  return (
    <div
      className={cn(
        "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
        className,
      )}
    >
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {/* Corpus Version Boxes */}
      <div className="space-y-3">
        {/* CURRENT */}
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {currentLabel}
          </span>
          <p className="mt-0.5 text-base font-semibold text-foreground truncate">
            {current?.version ?? "—"}
          </p>
          <p className="text-[10.5px] text-muted-foreground truncate">
            {currentDetails}
          </p>
        </div>

        {/* DRAFT */}
        <div className="rounded-lg border border-border bg-background/50 p-3">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {draftLabel}
          </span>
          <p className="mt-0.5 text-sm font-semibold text-foreground truncate">
            {draft?.version ?? (hasCorpusStatus ? noDraftText : "—")}
          </p>
          <p className="text-[10.5px] text-muted-foreground truncate">
            {draftDetails}
          </p>
        </div>
      </div>
    </div>
  );
}
