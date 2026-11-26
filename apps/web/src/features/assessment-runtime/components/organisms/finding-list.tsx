"use client";

import { useState } from "react";
import { RULE_DECISION_APPLICABILITIES } from "@lcsp/contracts/assessment";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { DecisionTurn } from "../../types/conversation.types";
import { LegalRuleOutput } from "./legal-rule-output";

/**
 * Business purpose: Render a single selected finding's outcome, rationale, legal citation, and evidence via M07/M09 `LegalRuleOutput`.
 * Business rules:
 * - Preserves authentic legal citations, outcome rationale, and missing-evidence indicators without inventing content.
 * Execution flow:
 * 1. Render `LegalRuleOutput` for the active `DecisionTurn`.
 * Failure cases:
 * - Missing `turn` renders the localized selection hint.
 * Side effects:
 * - Pure composition around `LegalRuleOutput`.
 */
export function RuleOutputMessage({
  turn,
}: {
  turn: DecisionTurn | null | undefined;
}) {
  if (!turn) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {resolveAppMessage("pages.assessmentWorkspace.findings.selectFindingHint")}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <LegalRuleOutput turn={turn} />
    </div>
  );
}

/**
 * Business purpose: Render the master-detail Findings view matching Figma `LCSP Data / Finding list row` (`1691:4079`) and Frame 21/40.
 * Business rules:
 * - Filters to `APPLICABLE` decision turns so non-applicable internal decisions are excluded from customer findings.
 * - Shows missing evidence distinctly on each row when `evidenceItems.length === 0`.
 * Execution flow:
 * 1. Filter `turns` to `APPLICABLE` rules.
 * 2. Track active finding selection and render the left list + right `RuleOutputMessage`.
 * Failure cases:
 * - Empty applicable findings renders a clean `Empty` state.
 * Side effects:
 * - Local selection state only.
 */
export function FindingList({
  turns,
}: {
  turns: readonly DecisionTurn[];
}) {
  const applicableTurns = turns.filter(
    (turn) =>
      turn.record.decision.applicability ===
      RULE_DECISION_APPLICABILITIES.APPLICABLE,
  );
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  if (applicableTurns.length === 0) {
    return (
      <Empty className="rounded-xl border border-border bg-card p-8">
        <EmptyHeader>
          <EmptyTitle>
            {resolveAppMessage("pages.assessmentWorkspace.findings.emptyTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {resolveAppMessage("pages.assessmentWorkspace.findings.emptyBody")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const activeTurn =
    applicableTurns.find(
      (turn) => turn.record.assessmentRuleId === selectedRuleId,
    ) ?? applicableTurns[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section
        aria-label={resolveAppMessage(
          "pages.assessmentWorkspace.findings.listTitle",
        )}
        className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {resolveAppMessage("pages.assessmentWorkspace.findings.listTitle")} (
            {applicableTurns.length})
          </h2>
        </div>

        <ul className="divide-y divide-border">
          {applicableTurns.map((turn) => {
            const isSelected =
              turn.record.assessmentRuleId ===
              activeTurn.record.assessmentRuleId;
            const evidenceCount = turn.record.decision.references.filter(
              (ref) => ref.type.toLowerCase().includes("evidence"),
            ).length;
            const isMissingEvidence = evidenceCount === 0;
            const label = turn.record.assessmentRuleId;
            const reference = turn.record.decision.rationale;

            return (
              <li key={turn.record.assessmentRuleId}>
                <button
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() =>
                    setSelectedRuleId(turn.record.assessmentRuleId)
                  }
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    isSelected
                      ? "bg-brand-mint/45"
                      : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-foreground">
                      {label}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[11px]",
                        isMissingEvidence
                          ? "border-status-warning-border bg-status-warning-bg text-status-warning"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {isMissingEvidence
                        ? resolveAppMessage(
                            "pages.assessmentWorkspace.findings.missingEvidence",
                          )
                        : resolveAppMessage(
                            "pages.assessmentWorkspace.findings.evidenceCount",
                          ).replace("{count}", String(evidenceCount))}
                    </Badge>
                  </div>
                  {reference ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {reference}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <RuleOutputMessage turn={activeTurn} />
    </div>
  );
}
