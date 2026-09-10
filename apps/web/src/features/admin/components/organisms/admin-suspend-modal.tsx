"use client";

import { ShieldAlertIcon, AlertCircleIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminSuspendModalProps } from "@/features/admin/types/admin.types";

export function AdminSuspendModal({
  isOpen,
  user,
  onClose,
  onConfirm,
  isPending = false,
}: AdminSuspendModalProps) {
  const eyebrow = resolveAppMessage(
    "pages.admin.suspendModal.eyebrow" as MessageKey,
  );
  const title = resolveAppMessage(
    "pages.admin.suspendModal.title" as MessageKey,
  );
  const auditNote = resolveAppMessage(
    "pages.admin.suspendModal.auditNote" as MessageKey,
  );
  const cancelLabel = resolveAppMessage(
    "pages.admin.suspendModal.cancel" as MessageKey,
  );
  const confirmLabel = resolveAppMessage(
    "pages.admin.suspendModal.confirmSuspend" as MessageKey,
  );
  const suspendingLabel = resolveAppMessage(
    "pages.admin.suspendModal.suspending" as MessageKey,
  );

  const rawBody = resolveAppMessage(
    "pages.admin.suspendModal.body" as MessageKey,
  );
  const formattedBody = rawBody
    .replace("{name}", user.fullName)
    .replace("{email}", user.email);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[520px] rounded-[14px] p-0 border border-border shadow-2xl">
        <DialogHeader className="flex flex-col space-y-1.5 border-b-0 pb-0 bg-transparent px-6 pt-6">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
            <ShieldAlertIcon className="size-3.5 text-admin-warning-foreground" />
            <span>{eyebrow}</span>
          </div>
          <DialogTitle className="text-[20px] font-semibold text-foreground">
            {title}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col space-y-4 px-6 py-4">
          <DialogDescription className="text-[12.5px] text-muted-foreground leading-relaxed">
            {formattedBody}
          </DialogDescription>

          {/* Audit Trail Notice */}
          <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-muted/40 px-3.5 py-2.5 text-[11.5px] font-medium text-muted-foreground">
            <AlertCircleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="leading-snug">{auditNote}</span>
          </div>
        </DialogBody>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isPending}
            className="h-[38px] w-[108px] rounded-[10px] border-border bg-secondary text-[12.5px] font-medium text-secondary-foreground hover:bg-secondary/80 shadow-xs"
          >
            {cancelLabel}
          </Button>

          <Button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="h-[38px] w-[164px] rounded-[10px] bg-primary text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 shadow-xs disabled:opacity-50"
          >
            {isPending ? suspendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
