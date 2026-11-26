"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteAssessmentMutation } from "@/lib/api/workspace-queries";
import { resolveAppMessage } from "@/lib/i18n";

type DeleteAssessmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  assessmentName: string;
  onDeleted?: () => void;
};

/**
 * Business purpose:
 * Confirm permanent assessment deletion across both sidebar recents and the
 * assessments list table (Frames 62–66).
 *
 * Business rules:
 * - Cancelling or dismissing never fires a delete mutation.
 * - Backend failure keeps the dialog open and surfaces `deleteError` (Frame 65).
 *
 * Execution flow:
 * 1. Reset previous mutation error state when opened.
 * 2. Execute `useDeleteAssessmentMutation` on confirmation.
 * 3. Close dialog and invoke `onDeleted` callback on success.
 *
 * Failure cases:
 * - Mutation failure renders destructive alert text without removing the item.
 *
 * Side effects:
 * - Deletes the assessment via BFF mutation and invalidates workspace/tracking queries.
 */
export function DeleteAssessmentDialog({
  open,
  onOpenChange,
  assessmentId,
  assessmentName,
  onDeleted,
}: DeleteAssessmentDialogProps) {
  const deleteMutation = useDeleteAssessmentMutation();

  useEffect(() => {
    if (open) {
      deleteMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assessmentId]);

  async function handleDelete() {
    if (deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync(assessmentId);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // Mutation error is surfaced below via deleteMutation.isError.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0"
        closeLabel={resolveAppMessage("pages.appShell.assessmentActions.close")}
        data-component="DeleteAssessmentDialog"
      >
        <DialogHeader>
          <div>
            <DialogTitle className="text-lg leading-6">
              {resolveAppMessage("pages.appShell.assessmentActions.deleteTitle")}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {resolveAppMessage(
                "pages.appShell.assessmentActions.deleteDescription",
              )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <div className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm font-medium">
            {assessmentName}
          </div>
          {deleteMutation.isError ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {resolveAppMessage("pages.appShell.assessmentActions.deleteError")}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {resolveAppMessage("pages.appShell.assessmentActions.cancel")}
          </Button>
          <Button
            disabled={deleteMutation.isPending}
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            {resolveAppMessage(
              deleteMutation.isPending
                ? "pages.appShell.assessmentActions.deleting"
                : "pages.appShell.assessmentActions.deleteConfirm",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
