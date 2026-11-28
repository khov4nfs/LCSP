"use client";

import type { LegalSourceDocumentDialogProps } from "../../types/legal-source-lifecycle.types";

import { useState } from "react";
import { resolveAppMessage as t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LegalSourceImportForm } from "./legal-source-import-form";
import { LegalSourceUploadForm } from "./legal-source-upload-form";

export function LegalSourceDocumentDialog({
  versionId,
  importFromUrl = false,
  onSuccess,
}: LegalSourceDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const label = t(
    importFromUrl
      ? "pages.legalSources.importTab"
      : "pages.legalSources.uploadTab",
  );
  function submitted() {
    setOpen(false);
    onSuccess();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={importFromUrl ? "outline" : "default"} />}
      >
        {label}
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeLabel={t("pages.legalSources.cancel")}
      >
        <DialogHeader className="flex-col">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {t("pages.legalLifecycle.purposeHelp")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="break-all text-xs text-muted-foreground">
            {t("pages.legalLifecycle.versionId")}: {versionId}
          </p>
          {importFromUrl ? (
            <LegalSourceImportForm
              versionId={versionId}
              onSuccess={submitted}
            />
          ) : (
            <LegalSourceUploadForm
              versionId={versionId}
              onSuccess={submitted}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
