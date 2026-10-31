"use client";
import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { ASSESSMENT_AUDIT_MODES, RULE_AUDIT_PROGRESS_STATES, RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES, ruleAuditExportMetadataSchema } from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRetryRuleAudit, useRuleAuditCatalogQuery, useRuleAuditRequestQuery, useSubmitRuleAudit } from "@/lib/api/rule-audit-queries";
import { apiValidated } from "@/lib/api/api-request";
import { ruleAuditSelectionSchema, type RuleAuditSelection } from "../../schemas/rule-audit-selection.schema";
import { copy } from "../../utils/conversation-copy";
import { RuleAuditOption } from "../molecules/rule-audit-option";

/**
 * Business purpose: Let the customer explicitly choose a frozen rule scope in the assessment conversation.
 * Business rules: No rule is preselected; zero cannot start; Audit all is a separate deliberate action.
 * Execution flow:
 * 1. Load every pinned catalog page and current request progress.
 * 2. Collect selected IDs through the validated form and submit exact versions/pins.
 * 3. Show durable per-rule progress and navigate to the accepted decision turn.
 * Failure cases: Catalog or submit errors retain the selection without inventing a result.
 * Side effects: Sends one idempotent audit request and scrolls to a persisted result on demand.
 */
export function RuleAuditPicker({ assessmentId }: { assessmentId: string }) {
  const catalog = useRuleAuditCatalogQuery(assessmentId);
  const current = useRuleAuditRequestQuery(assessmentId, catalog.data?.latestRequestId ?? null);
  const submit = useSubmitRuleAudit(assessmentId);
  const retry = useRetryRuleAudit(assessmentId);
  const form = useForm<RuleAuditSelection>({
    resolver: zodResolver(ruleAuditSelectionSchema), defaultValues: { selectedRuleIds: [] },
  });
  const selectedIds = useWatch({ control: form.control, name: "selectedRuleIds" }) ?? [];
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const replay = useRef<{ digest: string; key: string } | null>(null);
  const exportKey = useRef<string | null>(null);
  const retryKey = useRef<string | null>(null);
  const data = catalog.data;
  const latest = current.data;
  const requestRules = useMemo(() => new Map(latest?.rules.map((rule) => [rule.assessmentRuleId, rule]) ?? []), [latest]);
  const rules = useMemo(() => (data?.rules ?? []).map((rule) => {
    const request = requestRules.get(rule.assessmentRuleId);
    return request ? { ...rule, progress: request.progress, decisionId: request.decisionId } : rule;
  }), [data, requestRules]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? rules.filter((rule) => [rule.concept, rule.summary, rule.assessmentRuleId,
      ...rule.legalRequirements.map((requirement) => requirement.title)]
      .some((value) => value.toLocaleLowerCase().includes(term))) : rules;
  }, [rules, search]);
  if (catalog.isPending) return <p role="status">{copy("ruleAudit.loading")}</p>;
  if (catalog.isError || !data || data.auditMode !== ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED) return null;
  const canStart = !data.latestRequestId || data.latestRequestStatus === RULE_AUDIT_STATUSES.COMPLETED;

  /**
   * Business purpose: Freeze a selected or full scope with one stable retry identity.
   * Business rules: The client sends exact current pins and selected versions; the server validates all membership.
   * Execution flow:
   * 1. Build payload from the complete catalog and preserve an idempotency key for identical retries.
   * 2. Submit, then clear the form only after server acceptance.
   * Failure cases: A rejected request leaves the choice visible for correction or retry.
   * Side effects: Sends one audit POST and resets local selection on success.
   */
  async function start(scopeMode: typeof RULE_AUDIT_SCOPE_MODES[keyof typeof RULE_AUDIT_SCOPE_MODES], ids: string[]) {
    const chosen = data!.rules.filter((rule) => ids.includes(rule.assessmentRuleId))
      .map(({ assessmentRuleId, assessmentRuleVersion }) => ({ assessmentRuleId, assessmentRuleVersion }));
    const body = {
      expectedAuditRevision: data!.auditRevision,
      ruleSetVersionId: data!.ruleSetVersionId, ruleSetDigest: data!.ruleSetDigest,
      repositorySnapshotId: data!.repositorySnapshotId, repositoryCommit: data!.repositoryCommit,
      scopeMode, rules: scopeMode === RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET ? [] : chosen,
    };
    const digest = JSON.stringify(body);
    if (replay.current?.digest !== digest) replay.current = { digest, key: crypto.randomUUID() };
    try {
      await submit.mutateAsync({ ...body, idempotencyKey: replay.current!.key });
      replay.current = null;
      form.reset({ selectedRuleIds: [] });
    } catch {
      // The mutation exposes the problem while keeping the same key for a safe retry.
    }
  }

  /**
   * Business purpose: Submit the rule selection validated by the form when the customer starts an audit.
   * Business rules: The form schema rejects an empty selection; the server revalidates rule membership and pins.
   * Execution flow:
   * 1. Receive the validated rule IDs from react-hook-form.
   * 2. Pass them to the canonical selected-scope submission flow.
   * Failure cases: Submission errors retain the customer's selection for a safe retry.
   * Side effects: Starts one idempotent selected-rule audit request.
   */
  async function submitSelected(value: RuleAuditSelection) {
    await start(RULE_AUDIT_SCOPE_MODES.SELECTED_RULES, value.selectedRuleIds);
  }

  /**
   * Business purpose: Route the browser submit event through validated form state.
   * Business rules: Invalid or empty selections cannot reach the audit request command.
   * Execution flow:
   * 1. Receive the native form event after user submission.
   * 2. Ask react-hook-form to validate and deliver the selected rule IDs.
   * Failure cases: Validation errors leave the picker selection available for correction.
   * Side effects: A valid event starts one selected-rule request.
   */
  async function handleSelectionSubmit(event: FormEvent<HTMLFormElement>) {
    await form.handleSubmit(submitSelected)(event);
  }

  /**
   * Business purpose: Give the customer a durable partial export of accepted results available now.
   * Business rules: The server chooses accepted decisions; a retry reuses the same export key.
   * Execution flow:
   * 1. Request an immutable selected-rule snapshot.
   * 2. Navigate to the owner-scoped download for the returned export identity.
   * Failure cases: A rejected or empty export displays an error without claiming a full report.
   * Side effects: Creates one partial export and starts a browser download.
   */
  async function downloadPartial() {
    if (!latest || latest.ready === 0) return;
    setExporting(true);
    setExportFailed(false);
    exportKey.current ??= crypto.randomUUID();
    try {
      const result = await apiValidated(
        `/api/assessments/${encodeURIComponent(assessmentId)}/rule-audits/${encodeURIComponent(latest.requestId)}/exports`,
        ruleAuditExportMetadataSchema,
        { method: "POST", body: JSON.stringify({ idempotencyKey: exportKey.current }) },
      );
      exportKey.current = null;
      window.location.assign(
        `/api/assessments/${encodeURIComponent(assessmentId)}/rule-audits/${encodeURIComponent(latest.requestId)}/exports/${encodeURIComponent(result.exportId)}/download`,
      );
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  /**
   * Business purpose: Restart the same failed frozen request without changing customer scope.
   * Business rules: A stable key identifies network replays; the API owns checkpoint and paid usage recovery.
   * Execution flow:
   * 1. Keep a retry identity until the server accepts the request.
   * 2. Refresh canonical progress after acceptance.
   * Failure cases: A rejected retry leaves earlier accepted results available.
   * Side effects: Sends an owner-scoped retry command for the current request.
   */
  async function retryCurrent() {
    if (!latest) return;
    retryKey.current ??= crypto.randomUUID();
    try {
      await retry.mutateAsync({ requestId: latest.requestId, idempotencyKey: retryKey.current });
      retryKey.current = null;
    } catch {
      // Keep the retry identity until the API acknowledges it.
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card p-4" aria-label={copy("ruleAudit.title")}
      data-slot="rule-audit-picker">
      <h2 className="text-base font-semibold">{copy("ruleAudit.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy("ruleAudit.description")}</p>
      {latest ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
          <span>{copy("ruleAudit.resultsCount", { ready: latest.ready, requested: latest.requested })} · {" "}
            {copy("ruleAudit.notRequested", { count: latest.notRequested })}</span>
          {latest.status === RULE_AUDIT_STATUSES.FAILED ? (
            <Button type="button" variant="outline" size="sm" disabled={retry.isPending}
              onClick={() => void retryCurrent()}>{copy("ruleAudit.retry")}</Button>
          ) : null}
          {retry.isError ? <span role="alert" className="text-destructive">{copy("ruleAudit.retryFailed")}</span> : null}
          {latest.ready > 0 ? <Button type="button" variant="outline" size="sm" disabled={exporting}
            onClick={() => void downloadPartial()}>{copy(exporting ? "ruleAudit.exporting" : "ruleAudit.exportPartial")}</Button> : null}
          {exportFailed ? <span role="alert" className="text-destructive">{copy("ruleAudit.exportFailed")}</span> : null}
        </div>
      ) : null}
      <FormProvider {...form}>
        <form onSubmit={handleSelectionSubmit}
          className="mt-3 space-y-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label={copy("ruleAudit.search")} placeholder={copy("ruleAudit.search")} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{copy("ruleAudit.selectedCount", { selected: selectedIds.length, total: data.total })}</span>
            <Button type="button" variant="outline" size="sm" disabled={!canStart}
              onClick={() => form.setValue("selectedRuleIds", rules
                .filter((rule) => rule.progress !== RULE_AUDIT_PROGRESS_STATES.RESULT_READY)
                .map((rule) => rule.assessmentRuleId))}>{copy("ruleAudit.selectAll")}</Button>
            <Button type="button" variant="outline" size="sm" disabled={!canStart || selectedIds.length === 0}
              onClick={() => form.setValue("selectedRuleIds", [])}>{copy("ruleAudit.clearAll")}</Button>
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label={copy("ruleAudit.title")}>
            {filtered.map((rule) => (
              <RuleAuditOption key={rule.assessmentRuleId} rule={rule} onView={(decisionId) =>
                document.getElementById(`decision-${decisionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
            ))}
          </ul>
          {canStart ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={selectedIds.length === 0 || submit.isPending}>
                {copy("ruleAudit.auditSelected")}
              </Button>
              <Button type="button" variant="outline" disabled={submit.isPending}
                onClick={() => void start(RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET, [])}>
                {copy("ruleAudit.auditAll")}
              </Button>
            </div>
          ) : null}
          {submit.isError ? <p role="alert" className="text-sm text-destructive">{copy("ruleAudit.submitFailed")}</p> : null}
        </form>
      </FormProvider>
    </section>
  );
}
