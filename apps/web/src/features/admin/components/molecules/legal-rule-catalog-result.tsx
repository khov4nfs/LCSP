"use client";
import { useRef, useState } from "react";
import { AGENT_EXECUTION_STATES as A } from "@lcsp/contracts/assessment";
import {
  preparationRuleBatchSchema,
  type PreparationRuleHistory,
} from "@lcsp/contracts/legal-rule-catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  useLegalRuleCommand,
  usePreparationRuleHistory,
} from "@/lib/api/legal-rule-catalog-queries";
import { canonicalExecutionLabel } from "@/features/workspace/utils/assessment-runtime-formatter";
import { useRuleSetPreparationActivity } from "../../hooks/use-rule-set-preparation-activity";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { RuleSetPreparationActivity } from "./rule-set-preparation-activity";
import { LEGAL_RULE_COMPARE_NONE } from "../../config/legal-rule-catalog.config";

type ResultRevision = PreparationRuleHistory["results"][number];

export function LegalRuleResultRevision({
  result,
  current,
}: {
  result: ResultRevision;
  current: boolean;
}) {
  return (
    <article className="min-w-0 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap gap-2">
        <h4 className="font-semibold">
          {t("revision")} {result.revision}
        </h4>
        {current ? <Badge>{t("current")}</Badge> : null}
        <Badge variant="outline">
          {canonicalExecutionLabel(result.executionState)}
        </Badge>
      </div>
      <dl className="space-y-2 break-words text-sm">
        <div>
          <dt className="text-muted-foreground">{t("runId")}</dt>
          <dd className="font-mono">{result.preparationRunId}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("initiatedBy")}</dt>
          <dd>{result.requestedBy}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("timestamp")}</dt>
          <dd>
            {result.createdAt}
            <br />
            {result.completedAt}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("sourcePins")}</dt>
          <dd>
            {result.input.catalogVersion} / {result.input.catalogRevision}
            <br />
            {result.input.legalSourceVersionId}
            <br />
            <span className="font-mono">{result.inputFingerprint}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("instruction")}</dt>
          <dd>
            {result.instructionReceipt?.revision}
            <br />
            <span className="font-mono">
              {result.instructionReceipt?.fingerprint}
            </span>
          </dd>
        </div>
      </dl>
      {result.failureCode ? (
        <p role="alert" className="text-destructive">
          {t("failure")}: {result.failureCode}
        </p>
      ) : null}
      <h5 className="font-medium">{t("analysis")}</h5>
      <p className="whitespace-pre-wrap text-sm">
        {result.output?.analysis ?? t("noResult")}
      </p>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("requirements")} ({result.output?.legalRequirements.length ?? 0})
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(result.output?.legalRequirements ?? [], null, 2)}
        </pre>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("assessmentRules")} ({result.output?.assessmentRules.length ?? 0})
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(result.output?.assessmentRules ?? [], null, 2)}
        </pre>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("sourceRead")}
        </summary>
        {result.input.citations.map((ref) => (
          <div className="mt-2 rounded border p-2 text-sm" key={ref.chunkId}>
            <p className="font-mono">
              {ref.documentId} · {ref.locator}
              <br />
              {ref.contentSha256}
            </p>
            <p className="whitespace-pre-wrap">{ref.content}</p>
          </div>
        ))}
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          {t("showInstructions")}
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {result.instructionReceipt?.content}
        </pre>
      </details>
    </article>
  );
}

export function LegalRuleRunActivity({ result }: { result: ResultRevision }) {
  const terminal =
    result.executionState !== A.QUEUED && result.executionState !== A.RUNNING;
  const activity = useRuleSetPreparationActivity(
    result.preparationRunId,
    terminal,
  );
  return (
    <RuleSetPreparationActivity
      preparationRunId={result.preparationRunId}
      executionState={result.executionState}
      terminal={terminal}
      events={activity.events}
      connected={activity.connected}
      hasOlder={activity.history.hasNextPage}
      loadingOlder={activity.history.isFetchingNextPage}
      historyError={activity.history.isError}
      historyLoading={activity.history.isPending}
      onLoadOlder={() => void activity.history.fetchNextPage()}
    />
  );
}

/**
 * Business purpose: Inspect stored results and regenerate exactly one rule inside the Preparation workflow.
 * Business rules:
 * - History reads never start work; regeneration uses a stable request key and preserves prior source pins unless explicitly changed.
 * Execution flow:
 * 1. Load rule history
 * 2. Select revisions for comparison
 * 3. Confirm a single-rule regeneration and show its batch.
 * Failure cases:
 * - Request failures remain visible; active attempts cannot be submitted again.
 * Side effects:
 * - Read subscriptions and an explicitly confirmed regeneration through the canonical API.
 */
export function LegalRuleResultDialog({
  ruleId,
  onClose,
  onBatch,
}: {
  ruleId: string;
  onClose: () => void;
  onBatch: (id: string) => void;
}) {
  const history = usePreparationRuleHistory(ruleId);
  const regenerate = useLegalRuleCommand(
    `/rules/${ruleId}/regenerate`,
    preparationRuleBatchSchema,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [latestInputs, setLatestInputs] = useState(false);
  const requestKey = useRef("");
  const results = history.data?.results ?? [];
  const selected = results.find((row) => row.id === selectedId) ?? results[0];
  const previous = results.find((row) => row.id === compareId);
  const current = results.find(
    (row) => row.id === history.data?.currentResultId,
  );
  const active =
    results[0]?.executionState === A.QUEUED ||
    results[0]?.executionState === A.RUNNING;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("viewResult")}</DialogTitle>
          <DialogDescription>{t("outcomeNotice")}</DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : history.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{t("error")}</AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="break-words text-sm">
              {t("current")}:{" "}
              {current
                ? `${t("revision")} ${current.revision} · ${current.instructionReceipt?.revision ?? ""}`
                : (history.data?.currentResultId ?? t("noResult"))}
            </p>
            <p className="text-sm">
              {t("latestAttempt")}:{" "}
              {results[0]
                ? `${t("revision")} ${results[0].revision} · ${canonicalExecutionLabel(results[0].executionState)}`
                : t("noResult")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t("chooseRevision")}</Label>
                <Select value={selected?.id} onValueChange={setSelectedId}>
                  <SelectTrigger aria-label={t("chooseRevision")}>
                    <SelectValue>
                      {selected
                        ? `${t("revision")} ${selected.revision}`
                        : t("chooseRevision")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {results.map((result) => (
                      <SelectItem key={result.id} value={result.id}>
                        {t("revision")} {result.revision} ·{" "}
                        {canonicalExecutionLabel(result.executionState)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t("compare")}</Label>
                <Select
                  value={compareId ?? LEGAL_RULE_COMPARE_NONE}
                  onValueChange={(value) =>
                    setCompareId(
                      value === LEGAL_RULE_COMPARE_NONE ? null : value,
                    )
                  }
                >
                  <SelectTrigger aria-label={t("compare")}>
                    <SelectValue>
                      {previous
                        ? `${t("revision")} ${previous.revision}`
                        : t("chooseRevision")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LEGAL_RULE_COMPARE_NONE}>
                      {t("chooseRevision")}
                    </SelectItem>
                    {results.map((result) => (
                      <SelectItem key={result.id} value={result.id}>
                        {t("revision")} {result.revision}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {history.hasNextPage ? (
              <Button
                variant="outline"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t("loadOlder")}
              </Button>
            ) : null}
            <div
              className={previous ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}
            >
              {selected ? (
                <LegalRuleResultRevision
                  result={selected}
                  current={selected.id === history.data?.currentResultId}
                />
              ) : null}
              {previous ? (
                <LegalRuleResultRevision
                  result={previous}
                  current={previous.id === history.data?.currentResultId}
                />
              ) : null}
            </div>
            <Button
              disabled={active || !results.length || regenerate.isPending}
              onClick={() => {
                requestKey.current = crypto.randomUUID();
                setLatestInputs(false);
                setConfirming(true);
              }}
            >
              {t("regenerate")}
            </Button>
            {selected ? (
              <details>
                <summary className="cursor-pointer font-medium">
                  {t("activity")}
                </summary>
                <LegalRuleRunActivity result={selected} />
              </details>
            ) : null}
          </>
        )}
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("regenerate")}</DialogTitle>
              <DialogDescription>
                {t("regenerateDescription")}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">{t("samePins")}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="latest-rule-inputs"
                checked={latestInputs}
                onCheckedChange={(value) => setLatestInputs(value === true)}
              />
              <Label htmlFor="latest-rule-inputs">{t("latestPins")}</Label>
            </div>
            {regenerate.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t("error")}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </Button>
              <Button
                disabled={regenerate.isPending || !history.data?.latestResultId}
                onClick={async () => {
                  const result = await regenerate
                    .mutateAsync({
                      idempotencyKey: requestKey.current,
                      expectedResultId: history.data!.latestResultId,
                      useLatestInputs: latestInputs,
                    })
                    .catch(() => null);
                  if (result) {
                    onBatch(result.id);
                    setConfirming(false);
                    setSelectedId(null);
                  }
                }}
              >
                {regenerate.isPending ? t("loading") : t("regenerate")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
