"use client";

import { QuickActionRow } from "@/components/molecules/quick-action-row";
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
            <QuickActionRow
              key={item.key}
              href={item.href}
              label={item.label}
              description={item.description}
              onClick={() => onOpenChange(false)}
            />
          ))}

          <QuickActionRow
            label={resolveAppMessage("pages.appShell.settings")}
            description={resolveAppMessage(
              "pages.appShell.quickActionSettingsDesc",
            )}
            onClick={() => {
              onOpenChange(false);
              onOpenSettings();
            }}
          />
        </nav>
      </DialogContent>
    </Dialog>
  );
}
