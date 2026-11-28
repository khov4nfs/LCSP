"use client";

import { CopyIcon, LockIcon } from "lucide-react";
import type {
  ModelTariffRateScheduleView,
  OperationalAssumptions,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { AdminDetailRow } from "../atoms/admin-detail-row";
import { PricingScopeBadge } from "../atoms/pricing-scope-badge";
import {
  PricingAssignmentStatusBadge,
  PricingDraftStatusBadge,
} from "../atoms/pricing-status-badge";
import { TOKEN_BUCKET_POLICY_LABEL_KEYS } from "../../config/admin-pricing.config";
import {
  PRICING_DETAIL_KINDS,
  type PricingDetailTarget,
} from "../../types/admin-pricing.types";
import { formatMicrocreditRate } from "../../utils/admin-pricing-format";

type AdminPricingDetailDialogProps = {
  target: PricingDetailTarget | null;
  locale: Locale;
  onClose: () => void;
  onCopyId: (id: string) => void;
};

function renderRateValue(rate: string | null, locale: Locale): string {
  if (rate === null) {
    return resolveAppMessage("pages.admin.pricing.labels.none");
  }
  const formatted = formatMicrocreditRate(rate, locale);
  return formatAppMessage("pages.admin.pricing.labels.perMillionTokens", {
    microcredits: formatted.microcreditsFormatted,
    credits: formatted.creditsDecimal,
  });
}

function RateScheduleRows({
  rates,
  locale,
}: {
  rates: ModelTariffRateScheduleView;
  locale: Locale;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-1">
      <AdminDetailRow
        label={resolveAppMessage("pages.admin.pricing.dialog.fields.inputRate")}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.inputMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage("pages.admin.pricing.dialog.fields.outputRate")}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.outputMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.reasoningPolicy",
        )}
        value={resolveAppMessage(
          TOKEN_BUCKET_POLICY_LABEL_KEYS[rates.reasoningPolicy],
        )}
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.reasoningRate",
        )}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.reasoningMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cachedInputPolicy",
        )}
        value={resolveAppMessage(
          TOKEN_BUCKET_POLICY_LABEL_KEYS[rates.cachedInputPolicy],
        )}
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cachedInputRate",
        )}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.cachedInputMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cacheWritePolicy",
        )}
        value={resolveAppMessage(
          TOKEN_BUCKET_POLICY_LABEL_KEYS[rates.cacheWritePolicy],
        )}
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cacheWriteRate",
        )}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.cacheWriteMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cacheWrite5mRate",
        )}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.cacheWrite5mMicrocreditsPerMillion, locale)}
          </span>
        }
      />
      <AdminDetailRow
        label={resolveAppMessage(
          "pages.admin.pricing.dialog.fields.cacheWrite1hRate",
        )}
        value={
          <span className="font-mono tabular-nums">
            {renderRateValue(rates.cacheWrite1hMicrocreditsPerMillion, locale)}
          </span>
        }
      />
    </div>
  );
}

function OperationalAssumptionsRows({
  assumptions,
}: {
  assumptions: OperationalAssumptions;
}) {
  const none = resolveAppMessage("pages.admin.pricing.labels.none");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          {resolveAppMessage("pages.admin.pricing.dialog.assumptionsHeading")}
        </h3>
        <Badge
          variant="outline"
          className="rounded-sm border-admin-warning-border bg-admin-warning-surface text-admin-warning-foreground"
        >
          <span>
            {resolveAppMessage("pages.admin.pricing.labels.nonAuthoritativeTag")}
          </span>
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {resolveAppMessage("pages.admin.pricing.dialog.assumptionsWarning")}
      </p>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-1">
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.providerPriceSource",
          )}
          value={assumptions.providerPriceSource ?? none}
        />
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.providerPriceVersion",
          )}
          value={assumptions.providerPriceVersion ?? none}
        />
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.providerCurrency",
          )}
          value={assumptions.providerCurrency ?? none}
        />
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.referenceFxVndPerUsd",
          )}
          value={assumptions.referenceFxVndPerUsd ?? none}
        />
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.infrastructureOverheadPercent",
          )}
          value={
            assumptions.infrastructureOverheadPercent !== undefined
              ? `${assumptions.infrastructureOverheadPercent}%`
              : none
          }
        />
        <AdminDetailRow
          label={resolveAppMessage(
            "pages.admin.pricing.dialog.fields.markupMultiplier",
          )}
          value={
            assumptions.markupMultiplier !== undefined
              ? String(assumptions.markupMultiplier)
              : none
          }
        />
        <AdminDetailRow
          label={resolveAppMessage("pages.admin.pricing.dialog.fields.notes")}
          value={assumptions.notes ?? none}
        />
      </div>
    </div>
  );
}

/**
 * Strictly read-only inspection modal for coverage rows, versioned assignments,
 * mutable drafts (including `operationalAssumptions`), and immutable snapshots.
 */
export function AdminPricingDetailDialog({
  target,
  locale,
  onClose,
  onCopyId,
}: AdminPricingDetailDialogProps) {
  const closeLabel = resolveAppMessage("pages.admin.pricing.dialog.close");
  const none = resolveAppMessage("pages.admin.pricing.labels.none");
  const openEnded = resolveAppMessage("pages.admin.pricing.labels.openEnded");

  const titleKey =
    target?.kind === PRICING_DETAIL_KINDS.coverage
      ? "pages.admin.pricing.dialog.coverageTitle"
      : target?.kind === PRICING_DETAIL_KINDS.assignment
        ? "pages.admin.pricing.dialog.assignmentTitle"
        : target?.kind === PRICING_DETAIL_KINDS.draft
          ? "pages.admin.pricing.dialog.draftTitle"
          : "pages.admin.pricing.dialog.snapshotTitle";

  const copyableId =
    target?.kind === PRICING_DETAIL_KINDS.coverage
      ? (target.item.snapshotId ?? target.item.assignmentId)
      : target?.item.id ?? null;

  const rates: ModelTariffRateScheduleView | null =
    target?.kind === PRICING_DETAIL_KINDS.coverage
      ? target.item.rates
      : target?.kind === PRICING_DETAIL_KINDS.assignment
        ? target.snapshot
        : target?.kind === PRICING_DETAIL_KINDS.draft ||
            target?.kind === PRICING_DETAIL_KINDS.snapshot
          ? target.item
          : null;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-dvh max-w-2xl overflow-y-auto"
        closeLabel={closeLabel}
      >
        <DialogHeader>
          <div className="space-y-1">
            <DialogTitle>{resolveAppMessage(titleKey)}</DialogTitle>
            <DialogDescription>
              {resolveAppMessage("pages.admin.pricing.dialog.description")}
            </DialogDescription>
          </div>
        </DialogHeader>

        {target ? (
          <DialogBody className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {target.kind === PRICING_DETAIL_KINDS.coverage ? (
                  <PricingScopeBadge scope={target.item.fallbackSource} />
                ) : null}
                {target.kind === PRICING_DETAIL_KINDS.assignment ? (
                  <>
                    <PricingScopeBadge scope={target.item.scope} />
                    <PricingAssignmentStatusBadge status={target.item.status} />
                  </>
                ) : null}
                {target.kind === PRICING_DETAIL_KINDS.draft ? (
                  <>
                    <PricingScopeBadge scope={target.item.scope} />
                    <PricingDraftStatusBadge status={target.item.status} />
                  </>
                ) : null}
                {target.kind === PRICING_DETAIL_KINDS.snapshot ? (
                  <>
                    <PricingScopeBadge scope={target.item.scope} />
                    <Badge
                      variant="outline"
                      className="rounded-sm border-border bg-muted text-foreground"
                    >
                      <LockIcon aria-hidden="true" />
                      <span>
                        {resolveAppMessage(
                          "pages.admin.pricing.labels.immutableTag",
                        )}
                      </span>
                    </Badge>
                  </>
                ) : null}
              </div>

              {copyableId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyId(copyableId)}
                >
                  <CopyIcon aria-hidden="true" />
                  <span>
                    {resolveAppMessage("pages.admin.pricing.labels.copyId")}
                  </span>
                </Button>
              ) : null}
            </div>

            {rates ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                  {resolveAppMessage(
                    "pages.admin.pricing.dialog.rateScheduleHeading",
                  )}
                </h3>
                <RateScheduleRows rates={rates} locale={locale} />
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                {resolveAppMessage(
                  "pages.admin.pricing.dialog.provenanceHeading",
                )}
              </h3>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-1">
                {target.kind === PRICING_DETAIL_KINDS.coverage ? (
                  <>
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.provider",
                      )}
                      value={target.item.provider}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.resolvedModel",
                      )}
                      value={target.item.resolvedModel}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.normalizedScopeKey",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.normalizedScopeKey}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.assignmentId",
                      )}
                      value={target.item.assignmentId ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.snapshotId",
                      )}
                      value={target.item.snapshotId ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.effectiveFrom",
                      )}
                      value={
                        target.item.effectiveFrom
                          ? formatLocaleDateTimeWithYear(
                              target.item.effectiveFrom,
                              locale,
                            )
                          : none
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.effectiveTo",
                      )}
                      value={
                        target.item.effectiveTo
                          ? formatLocaleDateTimeWithYear(
                              target.item.effectiveTo,
                              locale,
                            )
                          : target.item.hasCoverage
                            ? openEnded
                            : none
                      }
                    />
                  </>
                ) : null}

                {target.kind === PRICING_DETAIL_KINDS.assignment ? (
                  <>
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.assignmentId",
                      )}
                      value={
                        <span className="font-mono text-xs">
                          {target.item.id}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.snapshotId",
                      )}
                      value={
                        <span className="font-mono text-xs">
                          {target.item.tariffSnapshotId}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.normalizedScopeKey",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.normalizedScopeKey}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.version",
                      )}
                      value={`v${target.item.version}`}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.effectiveFrom",
                      )}
                      value={formatLocaleDateTimeWithYear(
                        target.item.effectiveFrom,
                        locale,
                      )}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.effectiveTo",
                      )}
                      value={
                        target.item.effectiveTo
                          ? formatLocaleDateTimeWithYear(
                              target.item.effectiveTo,
                              locale,
                            )
                          : openEnded
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.supersededByAssignmentId",
                      )}
                      value={target.item.supersededByAssignmentId ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.supersededBy",
                      )}
                      value={target.item.supersededBy ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.supersededAt",
                      )}
                      value={
                        target.item.supersededAt
                          ? formatLocaleDateTimeWithYear(
                              target.item.supersededAt,
                              locale,
                            )
                          : none
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.auditReason",
                      )}
                      value={target.item.auditReason ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.createdBy",
                      )}
                      value={target.item.createdBy}
                    />
                  </>
                ) : null}

                {target.kind === PRICING_DETAIL_KINDS.draft ? (
                  <>
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.draftId",
                      )}
                      value={
                        <span className="font-mono text-xs">
                          {target.item.id}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.normalizedScopeKey",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.normalizedScopeKey}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.version",
                      )}
                      value={`v${target.item.version}`}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.publishedSnapshotId",
                      )}
                      value={target.item.publishedSnapshotId ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.createdBy",
                      )}
                      value={target.item.createdBy}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.updatedBy",
                      )}
                      value={target.item.updatedBy}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.updatedAt",
                      )}
                      value={formatLocaleDateTimeWithYear(
                        target.item.updatedAt,
                        locale,
                      )}
                    />
                  </>
                ) : null}

                {target.kind === PRICING_DETAIL_KINDS.snapshot ? (
                  <>
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.snapshotId",
                      )}
                      value={
                        <span className="font-mono text-xs">
                          {target.item.id}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.sourceDraftId",
                      )}
                      value={target.item.sourceDraftId ?? none}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.normalizedScopeKey",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.normalizedScopeKey}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.version",
                      )}
                      value={`v${target.item.version}`}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.accountingUnitVersion",
                      )}
                      value={`v${target.item.accountingUnitVersion}`}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.idempotencyKey",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.idempotencyKey}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.requestFingerprint",
                      )}
                      value={
                        <span className="font-mono text-xs break-all">
                          {target.item.requestFingerprint}
                        </span>
                      }
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.auditReason",
                      )}
                      value={target.item.auditReason}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.publishedBy",
                      )}
                      value={target.item.publishedBy}
                    />
                    <AdminDetailRow
                      label={resolveAppMessage(
                        "pages.admin.pricing.dialog.fields.publishedAt",
                      )}
                      value={formatLocaleDateTimeWithYear(
                        target.item.publishedAt,
                        locale,
                      )}
                    />
                  </>
                ) : null}
              </div>
            </div>

            {target.kind === PRICING_DETAIL_KINDS.draft &&
            target.item.operationalAssumptions ? (
              <OperationalAssumptionsRows
                assumptions={target.item.operationalAssumptions}
              />
            ) : null}
          </DialogBody>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
