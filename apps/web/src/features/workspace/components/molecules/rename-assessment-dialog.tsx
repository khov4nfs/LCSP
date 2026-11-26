"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ASSESSMENT_NAME_MAX_LENGTH } from "@lcsp/contracts/assessment";

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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRenameAssessmentMutation } from "@/lib/api/workspace-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  renameAssessmentFormSchema,
  type RenameAssessmentFormValues,
} from "../../schemas/rename-assessment.schema";

type RenameAssessmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  currentName: string;
};

/**
 * Business purpose:
 * Provide a single validated dialog for renaming an assessment from either the
 * sidebar recents menu or the assessments list row actions (Frames 58–61).
 *
 * Business rules:
 * - Empty or whitespace-only names fail validation with an inline error (Frame 60).
 * - Submitting an unchanged name is prevented; backend errors render safely.
 *
 * Execution flow:
 * 1. Reset form values and mutation state whenever the dialog opens.
 * 2. Validate with Zod via `react-hook-form` on submit.
 * 3. Invoke `useRenameAssessmentMutation` and close dialog on success.
 *
 * Failure cases:
 * - Validation error renders `nameRequired` or `nameTooLong` inline under Input.
 * - API failure renders `renameError` while keeping the dialog open for retry.
 *
 * Side effects:
 * - Persists assessment rename via PATCH BFF mutation and invalidates queries.
 */
export function RenameAssessmentDialog({
  open,
  onOpenChange,
  assessmentId,
  currentName,
}: RenameAssessmentDialogProps) {
  const renameMutation = useRenameAssessmentMutation();
  const form = useForm<RenameAssessmentFormValues>({
    resolver: zodResolver(renameAssessmentFormSchema),
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (open) {
      renameMutation.reset();
      form.reset({ name: currentName });
    }
    // Reset only when dialog opens or target assessment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assessmentId, currentName]);

  const watchedName = form.watch("name")?.trim() ?? "";
  const isUnchanged = watchedName === currentName.trim();

  async function onSubmit(values: RenameAssessmentFormValues) {
    if (values.name === currentName.trim() || renameMutation.isPending) return;
    try {
      await renameMutation.mutateAsync({
        assessmentId,
        name: values.name,
      });
      onOpenChange(false);
    } catch {
      // Mutation error is surfaced below via renameMutation.isError.
    }
  }

  const nameErrorKey =
    form.formState.errors.name?.message === "nameTooLong"
      ? "pages.appShell.assessmentActions.nameTooLong"
      : "pages.appShell.assessmentActions.nameRequired";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0"
        closeLabel={resolveAppMessage("pages.appShell.assessmentActions.close")}
        data-component="RenameAssessmentDialog"
      >
        <DialogHeader>
          <div>
            <DialogTitle className="text-lg leading-6">
              {resolveAppMessage("pages.appShell.assessmentActions.renameTitle")}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {resolveAppMessage(
                "pages.appShell.assessmentActions.renameDescription",
              )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <DialogBody>
            <Field data-invalid={Boolean(form.formState.errors.name)}>
              <FieldLabel htmlFor={`rename-assessment-${assessmentId}`}>
                {resolveAppMessage("pages.appShell.assessmentActions.nameLabel")}
              </FieldLabel>
              <Input
                id={`rename-assessment-${assessmentId}`}
                autoFocus
                maxLength={ASSESSMENT_NAME_MAX_LENGTH}
                aria-invalid={Boolean(form.formState.errors.name)}
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <FieldError>{resolveAppMessage(nameErrorKey)}</FieldError>
              ) : null}
            </Field>
            {renameMutation.isError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {resolveAppMessage(
                  "pages.appShell.assessmentActions.renameError",
                )}
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
              disabled={isUnchanged || renameMutation.isPending}
              type="submit"
            >
              {resolveAppMessage(
                renameMutation.isPending
                  ? "pages.appShell.assessmentActions.saving"
                  : "pages.appShell.assessmentActions.save",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
