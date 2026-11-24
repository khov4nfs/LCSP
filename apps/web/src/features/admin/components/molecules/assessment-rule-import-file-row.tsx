import type { AssessmentRuleImportRequest } from "@lcsp/contracts/legal-rule-catalog";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import type { AssessmentRuleImportOutcome } from "../../types/legal-rule-catalog.types";

/**
 * Business purpose: Show the Admin, per chosen file, whether it can be sent and what the server said about it.
 * Business rules:
 * - A file that cannot be sent shows its reason and no server result; a server result shows only counts and the API's safe message.
 * Execution flow:
 * 1. Render the file name with its readiness, issue or counts.
 * 2. Render the dry-run or import outcome beneath it when one exists.
 * Failure cases:
 * - Failures render as an alert line; nothing is hidden or fabricated.
 * Side effects:
 * - Presentation only.
 */
export function AssessmentRuleImportFileRow({
  name,
  issue,
  request,
  outcome,
}: {
  name: string;
  issue: string | null;
  request: AssessmentRuleImportRequest | null;
  outcome: AssessmentRuleImportOutcome | undefined;
}) {
  const replayed =
    outcome?.kind === "RESULT"
      ? outcome.result.imported.filter((entry) => entry.replayed).length
      : 0;
  return (
    <li className="space-y-1 py-3 text-sm">
      <p className="font-medium break-all">{name}</p>
      {issue ? (
        <p role="alert" className="text-destructive">
          {t(issue)}
        </p>
      ) : request && !outcome ? (
        <p className="text-muted-foreground">
          {t("importFileReady")} · {t("importItems")}: {request.items.length} ·{" "}
          {t("importExcluded")}: {request.excludedItems.length}
        </p>
      ) : null}
      {outcome?.kind === "RESULT" ? (
        <p className="text-muted-foreground" role="status">
          {outcome.result.dryRun ? t("importWouldRecord") : t("importRecorded")}
          : {outcome.result.imported.length - replayed} · {t("importReplayed")}:{" "}
          {replayed} · {t("importExcluded")}:{" "}
          {outcome.result.excludedItems.length}
        </p>
      ) : null}
      {outcome?.kind === "ERROR" ? (
        <p role="alert" className="text-destructive">
          {outcome.message}
        </p>
      ) : null}
    </li>
  );
}
