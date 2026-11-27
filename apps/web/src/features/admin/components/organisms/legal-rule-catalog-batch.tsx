"use client";
import { useRef } from "react";
import { AGENT_EXECUTION_STATES as A } from "@lcsp/contracts/assessment";
import {
  preparationRuleBatchSchema,
  preparationRuleClaimSchema,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  COLLECTION_METRIC_TONES,
  COLLECTION_METRIC_VARIANTS,
  CollectionMetricCard,
} from "@/components/molecules/collection-metric-card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useLegalRuleCommand,
  usePreparationRuleBatch,
} from "@/lib/api/legal-rule-catalog-queries";
import { canonicalExecutionLabel } from "@/features/workspace/utils/assessment-runtime-formatter";
import { getRuleDisplayTitle } from "../../utils/legal-rule-formatter";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

/**
 * Business purpose: Present the selected Preparation Rule Set as one build with independent per-rule progress and partial results.
 * Business rules:
 * - Server counts and membership are authoritative; retry touches failed/interrupted items and reuses successful results.
 * Execution flow:
 * 1. Poll the batch
 * 2. Render status/output counts and per-rule actions
 * 3. Explicitly retry only failed members.
 * Failure cases:
 * - Loading/request failures remain visible; no missing output is represented as successful preparation.
 * Side effects:
 * - Read polling and explicitly invoked retry/cancellation commands through the existing runtime.
 */
export function LegalRuleCatalogBatch({
  batchId,
  onInspect,
  onBatch,
}: {
  batchId: string;
  onInspect: (id: string) => void;
  onBatch: (id: string) => void;
}) {
  const query = usePreparationRuleBatch(batchId);
  const retry = useLegalRuleCommand(
    `/preparations/${batchId}/retries`,
    preparationRuleBatchSchema,
  );
  const retryKey = useRef(crypto.randomUUID());
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  if (query.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("error")}</AlertDescription>
      </Alert>
    );
  const batch = query.data;
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-label={t("batch")}
    >
      <h3 className="text-lg font-semibold">{t("batch")}</h3>
      <p role="status">{batch.complete ? t("complete") : t("partial")}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.primary}
          label={t("selectedCount")}
          value={batch.selected}
          context={t("batch")}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.success}
          label={t("preparedCount")}
          value={batch.prepared}
          context={t("batch")}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={
            batch.failed > 0
              ? COLLECTION_METRIC_TONES.danger
              : COLLECTION_METRIC_TONES.muted
          }
          label={t("failedCount")}
          value={batch.failed}
          context={t("batch")}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.muted}
          label={t("skippedCount")}
          value={batch.skipped}
          context={t("batch")}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t("outcomeNotice")}</p>
      <ul className="divide-y">
        {batch.items.map((item) => (
          <li
            className="flex flex-wrap items-center gap-3 py-3"
            key={item.ruleId}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {getRuleDisplayTitle(item)}
              </p>
              <p className="text-sm">
                {canonicalExecutionLabel(item.executionState)}
              </p>
              {item.failureCode ? (
                <p className="text-sm text-destructive">{item.failureCode}</p>
              ) : null}
            </div>
            <Button variant="outline" onClick={() => onInspect(item.ruleId)}>
              {t("viewResult")}
            </Button>
            {item.executionState === A.RUNNING ||
            item.executionState === A.QUEUED ? (
              <CancelRuleButton runId={item.preparationRunId} />
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          {t("requirements")}: {batch.ruleSet.legalRequirements.length}
        </span>
        <span>
          {t("assessmentRules")}: {batch.ruleSet.assessmentRules.length}
        </span>
      </div>
      {retry.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        variant="outline"
        disabled={!batch.failed || retry.isPending}
        onClick={async () => {
          const result = await retry
            .mutateAsync({ idempotencyKey: retryKey.current })
            .catch(() => null);
          if (result) onBatch(result.id);
        }}
      >
        {retry.isPending ? t("loading") : t("retryFailed")}
      </Button>
    </section>
  );
}

function CancelRuleButton({ runId }: { runId: string }) {
  const cancel = useLegalRuleCommand(
    `/runs/${runId}/cancel`,
    preparationRuleClaimSchema,
  );
  return (
    <div>
      <Button
        variant="outline"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate({})}
      >
        {t("stop")}
      </Button>
      {cancel.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error")}
        </p>
      ) : null}
    </div>
  );
}
