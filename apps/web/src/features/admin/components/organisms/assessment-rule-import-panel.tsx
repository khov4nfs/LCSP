"use client";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssessmentRuleImport } from "@/lib/api/legal-rule-catalog-queries";
import { ASSESSMENT_RULE_IMPORT_STAGES as STAGES } from "../../config/legal-rule-catalog.config";
import {
  assessmentRuleImportFormSchema,
  parseAssessmentRuleImportDocument,
} from "../../schemas/assessment-rule-import-form.schema";
import type {
  AssessmentRuleImportFormValues,
  AssessmentRuleImportOutcome,
} from "../../types/legal-rule-catalog.types";
import { assessmentRuleImportErrorMessage } from "../../utils/assessment-rule-import-error";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { AssessmentRuleImportFileRow } from "../molecules/assessment-rule-import-file-row";

/**
 * Business purpose: Let an Admin load externally authored Assessment Rules into the selected catalog from the web, safely: check first, import only after a clean check. This panel owns the file selection, the dry run and the import; the dialog only frames it.
 * Business rules:
 * - Documents must target the selected catalog at its current revision; others are never sent.
 * - Import is enabled only after every document passed a dry run for the exact files now chosen, and it stops at the first failure; re-running is safe because identical results are acknowledged as unchanged.
 * - Importing only prepares results; activation stays the existing separate, confirmed step.
 * Execution flow:
 * 1. Read the chosen JSON files into the form and parse each against the shared v1 contract.
 * 2. Check: send every valid document with dryRun and show per-file previews.
 * 3. Import: send the same documents for real, one at a time, and show per-file results.
 * Failure cases:
 * - Unreadable or invalid files, stale revisions, active runs and API errors are shown per file; any failure returns the dialog to a state where the Admin must check again.
 * Side effects:
 * - A real import records prepared result revisions through the API; a check writes nothing.
 */
export function AssessmentRuleImportPanel({
  catalogId,
  catalogRevision,
  onClose,
  onBusyChange,
}: {
  catalogId: string;
  catalogRevision: number;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const form = useForm<AssessmentRuleImportFormValues>({
    resolver: zodResolver(assessmentRuleImportFormSchema),
    defaultValues: { documents: [] },
  });
  const documents = useWatch({ control: form.control, name: "documents" });
  const importer = useAssessmentRuleImport(catalogId);
  const [stage, setStage] = useState<(typeof STAGES)[keyof typeof STAGES]>(
    STAGES.IDLE,
  );
  const [outcomes, setOutcomes] = useState<
    Record<number, AssessmentRuleImportOutcome>
  >({});
  const parsed = useMemo(
    () =>
      (documents ?? []).map((document) =>
        parseAssessmentRuleImportDocument(document, {
          catalogId,
          catalogRevision,
        }),
      ),
    [documents, catalogId, catalogRevision],
  );
  const allReady = parsed.length > 0 && parsed.every((item) => item.ok);
  const busy = stage === STAGES.CHECKING || stage === STAGES.IMPORTING;
  // Tell the surrounding dialog so it cannot be dismissed while requests are in flight.
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  /**
   * Business purpose: Load the chosen files as the form's documents and discard results that no longer describe them.
   * Business rules:
   * - A new selection always invalidates earlier checks, so an import can never run on files that were not checked.
   * Execution flow:
   * 1. Read each file's text.
   * 2. Replace the form documents and reset stage and outcomes.
   * Failure cases:
   * - An unreadable file leaves the selection empty and the form reports the missing-files error.
   * Side effects:
   * - Reads local files in the browser only; nothing is uploaded here.
   */
  async function chooseFiles(files: FileList | null) {
    const chosen = files
      ? await Promise.all(
          Array.from(files).map(async (file) => ({
            name: file.name,
            text: await file.text(),
          })),
        ).catch(() => [])
      : [];
    setStage(STAGES.IDLE);
    setOutcomes({});
    form.setValue("documents", chosen, { shouldValidate: true });
  }

  /**
   * Business purpose: Run every ready document through the import API, either as a preview or for real.
   * Business rules:
   * - A preview reports every document so all problems surface at once; a real import stops at the first failure to avoid a half-explained state.
   * - The document is sent unchanged except for the dryRun choice.
   * Execution flow:
   * 1. Send each ready document in order with the chosen dryRun value.
   * 2. Record each outcome as it arrives.
   * 3. Move to CHECKED or DONE when all succeed, otherwise back to IDLE.
   * Failure cases:
   * - Any API failure is recorded for its file and the stage returns to IDLE.
   * Side effects:
   * - A real import records prepared revisions server-side; a preview writes nothing.
   */
  async function run(dryRun: boolean) {
    setStage(dryRun ? STAGES.CHECKING : STAGES.IMPORTING);
    const next: Record<number, AssessmentRuleImportOutcome> = {};
    setOutcomes({});
    let failed = false;
    for (const [index, item] of parsed.entries()) {
      if (!item.ok) continue;
      try {
        const result = await importer.mutateAsync({
          ...item.request,
          dryRun,
        });
        next[index] = { kind: "RESULT", result };
      } catch (error: unknown) {
        failed = true;
        next[index] = {
          kind: "ERROR",
          message: assessmentRuleImportErrorMessage(error),
        };
        if (!dryRun) {
          setOutcomes({ ...next });
          break;
        }
      }
      setOutcomes({ ...next });
    }
    setStage(failed ? STAGES.IDLE : dryRun ? STAGES.CHECKED : STAGES.DONE);
  }

  return (
    <FormProvider {...form}>
      <form
        className="space-y-4 p-6"
        onSubmit={form.handleSubmit(() => run(true))}
      >
        <div className="grid gap-2">
          <Label htmlFor="assessment-rule-import-files">
            {t("importFiles")}
          </Label>
          <Input
            id="assessment-rule-import-files"
            type="file"
            multiple
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void chooseFiles(event.target.files)}
          />
          {form.formState.errors.documents?.message ? (
            <p role="alert" className="text-sm text-destructive">
              {t(form.formState.errors.documents.message)}
            </p>
          ) : null}
        </div>
        {parsed.length ? (
          <ul className="divide-y rounded-lg border px-3">
            {parsed.map((item, index) => (
              <AssessmentRuleImportFileRow
                key={`${item.name}-${index}`}
                name={item.name}
                issue={item.ok ? null : item.issue}
                request={item.ok ? item.request : null}
                outcome={outcomes[index]}
              />
            ))}
          </ul>
        ) : null}
        {stage === STAGES.CHECKED ? (
          <Alert>
            <AlertDescription>{t("importCheckPassed")}</AlertDescription>
          </Alert>
        ) : null}
        {stage === STAGES.DONE ? (
          <Alert>
            <AlertDescription>{t("importDone")}</AlertDescription>
          </Alert>
        ) : null}
        {stage === STAGES.IDLE &&
        Object.values(outcomes).some((item) => item.kind === "ERROR") ? (
          <Alert variant="destructive">
            <AlertDescription>{t("importCheckFailed")}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            {t("importClose")}
          </Button>
          {stage === STAGES.DONE ? null : (
            <Button
              type="submit"
              variant="outline"
              disabled={!allReady || busy}
            >
              {stage === STAGES.CHECKING
                ? t("importChecking")
                : t("importCheck")}
            </Button>
          )}
          {stage === STAGES.DONE ? null : (
            <Button
              type="button"
              disabled={stage !== STAGES.CHECKED}
              onClick={() => void run(false)}
            >
              {stage === STAGES.IMPORTING ? t("importRunning") : t("importConfirm")}
            </Button>
          )}
        </DialogFooter>
      </form>
    </FormProvider>
  );
}
