"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { AssessmentRuleImportPanel } from "./assessment-rule-import-panel";

/**
 * Business purpose: Present the Assessment Rule import workflow as a dialog inside the catalog page.
 * Business rules:
 * - The dialog cannot be dismissed while a check or import is running, so the Admin never loses sight of a half-finished import.
 * Execution flow:
 * 1. Render the title and description.
 * 2. Host the import panel and track whether it is busy.
 * Failure cases:
 * - None of its own; failures are shown by the panel.
 * Side effects:
 * - Presentation only; the panel owns every request.
 */
export function AssessmentRuleImportDialog({
  open,
  onOpenChange,
  catalogId,
  catalogRevision,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogId: string;
  catalogRevision: number;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
          <DialogTitle>{t("importDialogTitle")}</DialogTitle>
          <DialogDescription>{t("importDialogDescription")}</DialogDescription>
        </DialogHeader>
        <AssessmentRuleImportPanel
          catalogId={catalogId}
          catalogRevision={catalogRevision}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}
