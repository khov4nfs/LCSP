"use client";

import { useState } from "react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteAssessmentDialog } from "@/features/workspace/components/molecules/delete-assessment-dialog";
import { RenameAssessmentDialog } from "@/features/workspace/components/molecules/rename-assessment-dialog";
import { resolveAppMessage } from "@/lib/i18n";

type AssessmentRowActionsProps = {
  assessmentId: string;
  assessmentName: string;
};

/**
 * Business purpose:
 * Expose Rename and Delete actions for each row in the Assessments list (Frame 18, 58–66),
 * reusing the exact same RenameAssessmentDialog and DeleteAssessmentDialog as the sidebar.
 *
 * Business rules:
 * - Menu trigger includes the assessment name in its accessible label.
 * - Dialog state resets cleanly on open; cancelled actions perform zero mutations.
 *
 * Execution flow:
 * 1. Render `···` DropdownMenu trigger button.
 * 2. Open RenameAssessmentDialog or DeleteAssessmentDialog on item selection.
 *
 * Failure cases:
 * - Mutation failures are handled inside the shared dialogs without closing them.
 *
 * Side effects:
 * - Mutations invalidate tracking and workspace queries on success.
 */
export function AssessmentRowActions({
  assessmentId,
  assessmentName,
}: AssessmentRowActionsProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`${resolveAppMessage("pages.appShell.assessmentActions.menuLabel")}: ${assessmentName}`}
              className="size-7.5 rounded-md border-border bg-card text-muted-foreground"
            >
              <MoreHorizontalIcon className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="w-44 min-w-44 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <PencilIcon />
            {resolveAppMessage("pages.appShell.assessmentActions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
            {resolveAppMessage("pages.appShell.assessmentActions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameAssessmentDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        assessmentId={assessmentId}
        currentName={assessmentName}
      />

      <DeleteAssessmentDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        assessmentId={assessmentId}
        assessmentName={assessmentName}
      />
    </>
  );
}
