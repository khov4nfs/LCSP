"use client";

import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { AssessmentSummary } from "../../types/workspace.types";
import { DeleteAssessmentDialog } from "./delete-assessment-dialog";
import { RenameAssessmentDialog } from "./rename-assessment-dialog";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        assessmentId={assessment.id}
        currentName={assessment.name}
      />

      <DeleteAssessmentDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        assessmentId={assessment.id}
        assessmentName={assessment.name}
        onDeleted={() => {
          if (active) {
            router.replace("/assessments");
            onNavigate?.();
          }
        }}
      />
    </>
  );
}
