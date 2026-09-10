"use client";

import { ASSESSMENT_NAME_MAX_LENGTH } from "@lcsp/contracts/assessment";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  useDeleteAssessmentMutation,
  useRenameAssessmentMutation,
} from "@/lib/api/workspace-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { AssessmentSummary } from "../../types/workspace.types";

type AssessmentActionsMenuProps = {
  active: boolean;
  assessment: AssessmentSummary;
  onNavigate?: () => void;
  suppressHover?: boolean;
};

export function AssessmentActionsMenu({
  active,
  assessment,
  onNavigate,
  suppressHover = false,
}: AssessmentActionsMenuProps) {
  const router = useRouter();
  const renameMutation = useRenameAssessmentMutation();
  const deleteMutation = useDeleteAssessmentMutation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameName, setRenameName] = useState(assessment.name);

  function openRenameDialog() {
    renameMutation.reset();
    setRenameName(assessment.name);
    setRenameOpen(true);
  }

  function openDeleteDialog() {
    deleteMutation.reset();
    setDeleteOpen(true);
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameName.trim();
    if (!name || name === assessment.name || renameMutation.isPending) return;

    try {
      await renameMutation.mutateAsync({ assessmentId: assessment.id, name });
      setRenameOpen(false);
    } catch {
      // Mutation state renders the customer-safe error copy.
    }
  }

  async function handleDelete() {
    if (deleteMutation.isPending) return;

    try {
      await deleteMutation.mutateAsync(assessment.id);
      setDeleteOpen(false);
      if (active) {
        router.replace("/assessments");
        onNavigate?.();
      }
    } catch {
      // Mutation state renders the customer-safe error copy.
    }
  }

  const canRename =
    renameName.trim().length > 0 && renameName.trim() !== assessment.name;

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              aria-label={`${resolveAppMessage("pages.appShell.assessmentActions.menuLabel")}: ${assessment.name}`}
              className={cn(
                "absolute top-1/2 right-1 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                menuOpen
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                suppressHover ? "pointer-events-none opacity-0" : null,
              )}
              data-assessment-actions-trigger="true"
              type="button"
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent
          align="end"
          className="w-44 min-w-44 rounded-xl border border-border bg-popover p-0.75 text-popover-foreground shadow-[0_8px_9px_rgba(0,0,0,0.18)] ring-0 dark:shadow-[0_8px_9px_rgba(0,0,0,0.35)]"
          side="bottom"
          sideOffset={4}
        >
          <DropdownMenuItem onClick={openRenameDialog}>
            <PencilIcon />
            {resolveAppMessage("pages.appShell.assessmentActions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={openDeleteDialog}>
            <Trash2Icon />
            {resolveAppMessage("pages.appShell.assessmentActions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent
          className="max-w-md gap-0"
          closeLabel={resolveAppMessage(
            "pages.appShell.assessmentActions.close",
          )}
        >
          <DialogHeader>
            <div>
              <DialogTitle className="text-lg leading-6">
                {resolveAppMessage(
                  "pages.appShell.assessmentActions.renameTitle",
                )}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {resolveAppMessage(
                  "pages.appShell.assessmentActions.renameDescription",
                )}
              </DialogDescription>
            </div>
          </DialogHeader>
          <form onSubmit={handleRename}>
            <DialogBody>
              <label className="space-y-2 text-sm font-medium">
                <span>
                  {resolveAppMessage(
                    "pages.appShell.assessmentActions.nameLabel",
                  )}
                </span>
                <Input
                  autoFocus
                  maxLength={ASSESSMENT_NAME_MAX_LENGTH}
                  onChange={(event) => setRenameName(event.target.value)}
                  value={renameName}
                />
              </label>
              {renameMutation.isError ? (
                <p className="text-sm text-destructive">
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
                onClick={() => setRenameOpen(false)}
              >
                {resolveAppMessage("pages.appShell.assessmentActions.cancel")}
              </Button>
              <Button
                disabled={!canRename || renameMutation.isPending}
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

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          className="max-w-md gap-0"
          closeLabel={resolveAppMessage(
            "pages.appShell.assessmentActions.close",
          )}
        >
          <DialogHeader>
            <div>
              <DialogTitle className="text-lg leading-6">
                {resolveAppMessage(
                  "pages.appShell.assessmentActions.deleteTitle",
                )}
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
              {assessment.name}
            </div>
            {deleteMutation.isError ? (
              <p className="text-sm text-destructive">
                {resolveAppMessage(
                  "pages.appShell.assessmentActions.deleteError",
                )}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
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
    </>
  );
}
