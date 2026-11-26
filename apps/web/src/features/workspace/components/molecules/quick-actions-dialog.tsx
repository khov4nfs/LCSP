"use client";

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";

type QuickActionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
};

/**
 * Business purpose:
 * Provide keyboard-accessible quick navigation to primary workspace destinations
 * aligned with Figma Prototype overlay / Next quick actions (1828:13598).
 *
 * Business rules:
 * - Selecting any destination closes the dialog before or during navigation.
 * - Settings opens the shared workspace SettingsModal rather than navigating away.
 *
 * Execution flow:
 * 1. Render Dialog with title, description, and explicit Close button.
 * 2. Render 6 quick-action rows linking to core customer workspace routes.
 *
 * Failure cases:
 * - Controlled open state prevents orphaned overlay state.
 *
 * Side effects:
 * - Invokes `onOpenChange(false)` and optional `onOpenSettings()`.
 */
export function QuickActionsDialog({
  open,
  onOpenChange,
  onOpenSettings,
}: QuickActionsDialogProps) {
  const destinations = [
    {
      key: "new-assessment",
      label: resolveAppMessage("pages.appShell.quickActionNewAssessment"),
      description: resolveAppMessage(
        "pages.appShell.quickActionNewAssessmentDesc",
      ),
      href: "/assessments/new",
    },
    {
      key: "assessments",
      label: resolveAppMessage("pages.appShell.assessments"),
      description: resolveAppMessage(
        "pages.appShell.quickActionAssessmentsDesc",
      ),
      href: "/assessments",
    },
    {
      key: "info-requests",
      label: resolveAppMessage("pages.appShell.quickActionInfoRequests"),
      description: resolveAppMessage(
        "pages.appShell.quickActionInfoRequestsDesc",
      ),
      href: "/workspace/compliance",
    },
    {
      key: "legal-library",
      label: resolveAppMessage("pages.appShell.legalLibrary"),
      description: resolveAppMessage(
        "pages.appShell.quickActionLegalLibraryDesc",
      ),
      href: "/laws",
    },
    {
      key: "reports",
      label: resolveAppMessage("pages.appShell.reports"),
      description: resolveAppMessage("pages.appShell.quickActionReportsDesc"),
      href: "/workspace/reports",
    },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        data-component="QuickActionsDialog"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div>
            <DialogTitle className="text-2xl font-semibold">
              {resolveAppMessage("pages.appShell.quickActions")}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {resolveAppMessage("pages.appShell.quickActionsDescription")}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {resolveAppMessage("pages.appShell.quickActionsClose")}
          </Button>
        </DialogHeader>

        <nav
          aria-label={resolveAppMessage("pages.appShell.quickActions")}
          className="flex flex-col gap-2 pt-1"
        >
          {destinations.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => onOpenChange(false)}
              className="group flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {item.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </Link>
          ))}

          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onOpenSettings();
            }}
            className="group flex w-full items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {resolveAppMessage("pages.appShell.settings")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {resolveAppMessage("pages.appShell.quickActionSettingsDesc")}
              </span>
            </span>
            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </button>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
