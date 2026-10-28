"use client";

import type { MessageKey } from "@lcsp/i18n";

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
import { resolveAppMessage } from "@/lib/i18n";

export function LegalSourceConfirmDialog({
  open,
  onOpenChange,
  titleKey,
  descriptionKey,
  confirmKey,
  pendingKey,
  pending,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleKey: string;
  descriptionKey: string;
  confirmKey: string;
  pendingKey: string;
  pending: boolean;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const t = (key: string) => resolveAppMessage(key as MessageKey);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter className="flex-row justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("pages.legalSources.cancel")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={onConfirm}
          >
            {t(pending ? pendingKey : confirmKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
