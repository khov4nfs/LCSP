"use client";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminStatusBadge } from "@/features/admin/components/molecules/admin-overview-primitives";

export type OperationsEventDetailItem = {
  title: string;
  area: string;
  statusLabel: string;
  statusVariant: "success" | "warning" | "danger" | "info";
  timestamp: string;
  actorOrTarget: string;
  summary: string;
};

type OperationsEventDetailDialogProps = {
  event: OperationsEventDetailItem | null;
  closeLabel: string;
  labels: {
    area: string;
    status: string;
    timestamp: string;
    target: string;
    summary: string;
  };
  onClose: () => void;
};

/**
 * Business purpose: Display chronological operational event details aligned to Figma Frame 85 (Activity Event Detail).
 * Business rules:
 * - Presents only safe operator-visible event fields (title, area, semantic status badge, timestamp, target, and summary).
 * - Never fabricates missing timestamps or synthetic audit records.
 * Execution flow:
 * 1. Open Dialog when event !== null.
 * 2. Render header with title + AdminStatusBadge and body with structured metadata fields.
 * Failure cases:
 * - Null event renders a closed dialog without side effects.
 * Side effects:
 * - Calls onClose when dismissed.
 */
export function OperationsEventDetailDialog({
  event,
  closeLabel,
  labels,
  onClose,
}: OperationsEventDetailDialogProps) {
  return (
    <Dialog
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={closeLabel}
        data-component="OperationsEventDetailDialog"
      >
        {event ? (
          <>
            <DialogHeader>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{event.title}</DialogTitle>
                  <AdminStatusBadge
                    label={event.statusLabel}
                    variant={event.statusVariant}
                  />
                </div>
                <DialogDescription>{event.area}</DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="grid gap-4 text-sm sm:grid-cols-2">
              <DetailField label={labels.area} value={event.area} />
              <DetailField label={labels.status} value={event.statusLabel} />
              <DetailField label={labels.timestamp} value={event.timestamp} />
              <DetailField
                label={labels.target}
                value={event.actorOrTarget || "—"}
              />
              <div className="sm:col-span-2">
                <DetailField label={labels.summary} value={event.summary || "—"} />
              </div>
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words font-medium text-foreground">{value}</div>
    </div>
  );
}
