"use client";

import type { LegalSourceActivationDialogProps } from "../../types/legal-source-lifecycle.types";

import { resolveAppMessage as t } from "@/lib/i18n";
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
import { LegalSourceReadinessChecklist } from "./legal-source-readiness-checklist";

export function LegalSourceActivationDialog({
  open,
  onOpenChange,
  version,
  activeVersion,
}: LegalSourceActivationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeLabel={t("pages.legalSources.cancel")}
      >
        <DialogHeader className="flex-col">
          <DialogTitle>{t("pages.legalSources.activateTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages.legalLifecycle.activationContext")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="font-medium">
            {version.source.name} · {version.version}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {version.id}
          </p>
          <p className="text-sm">
            {t("pages.legalLifecycle.activeVersion")}:{" "}
            {activeVersion ?? t("pages.legalLifecycle.notRecorded")}
          </p>
          <LegalSourceReadinessChecklist version={version} />
        </DialogBody>
        <DialogFooter className="sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("pages.legalSources.cancel")}
          </Button>
          <Button
            disabled
            aria-describedby="legal-source-admission-unavailable"
          >
            {t("pages.legalSources.confirmActivate")}
          </Button>
          <span id="legal-source-admission-unavailable" className="sr-only">
            {t("pages.legalLifecycle.admissionMissing")}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
