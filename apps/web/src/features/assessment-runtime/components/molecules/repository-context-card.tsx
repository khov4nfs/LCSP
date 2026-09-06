import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import type { NormalizedAssessmentRepository } from "../../../workspace/types/assessment-runtime-adapter.types";

export function RepositoryContextCard({ repository }: { repository: NormalizedAssessmentRepository }) {
  const fields = [
    ["pages.appShell.runtimePanelProvider", repository.provider],
    ["pages.appShell.runtimePanelRepository", repository.repositoryFullName],
    ["pages.appShell.runtimePanelBranch", repository.branch],
    ["pages.appShell.runtimePanelPinnedCommit", repository.pinnedCommit],
  ] as const;
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5 shadow-xs" aria-label={resolveAppMessage("pages.appShell.runtimePanelRepository" as MessageKey)}>
      <p className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">{resolveAppMessage("pages.appShell.runtimePanelRepository" as MessageKey)}</p>
      <dl className="mt-3 space-y-2">
        {fields.map(([label, value]) => value ? (
          <div className="flex items-start justify-between gap-3 text-xs" key={label}>
            <dt className="text-muted-foreground">{resolveAppMessage(label as MessageKey)}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-foreground">{value}</dd>
          </div>
        ) : null)}
      </dl>
    </section>
  );
}
