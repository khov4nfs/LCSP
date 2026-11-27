"use client";

import { CopyIcon, EyeIcon } from "lucide-react";
import type { ModelTariffDraftView } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { PricingScopeBadge } from "../atoms/pricing-scope-badge";
import { PricingDraftStatusBadge } from "../atoms/pricing-status-badge";
import { formatMicrocreditRate } from "../../utils/admin-pricing-format";

type AdminPricingDraftsTableProps = {
  drafts: readonly ModelTariffDraftView[];
  hasActiveFilters: boolean;
  locale: Locale;
  onResetFilters: () => void;
  onInspect: (draft: ModelTariffDraftView) => void;
  onCopyId: (id: string) => void;
};

/**
 * Displays mutable tariff drafts and non-authoritative `operationalAssumptions` markers.
 */
export function AdminPricingDraftsTable({
  drafts,
  hasActiveFilters,
  locale,
  onResetFilters,
  onInspect,
  onCopyId,
}: AdminPricingDraftsTableProps) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {resolveAppMessage("pages.admin.pricing.sections.draftsTitle")}
        </CardTitle>
        <CardDescription>
          {resolveAppMessage("pages.admin.pricing.sections.draftsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <Empty
            className="border border-dashed border-border py-8"
            data-testid="admin-pricing-drafts-empty"
          >
            <EmptyHeader>
              <EmptyTitle>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyTitle"
                    : "pages.admin.pricing.emptyStates.noDraftsTitle",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyDescription"
                    : "pages.admin.pricing.emptyStates.noDraftsDescription",
                )}
              </EmptyDescription>
            </EmptyHeader>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onResetFilters}
              >
                {resolveAppMessage("pages.admin.pricing.filters.reset")}
              </Button>
            ) : null}
          </Empty>
        ) : (
          <div
            role="region"
            tabIndex={0}
            aria-label={resolveAppMessage(
              "pages.admin.pricing.sections.draftsTableRegionAria",
            )}
            className="overflow-x-auto rounded-md border border-border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Table data-testid="admin-pricing-drafts-table">
              <TableCaption className="sr-only">
                {resolveAppMessage("pages.admin.pricing.sections.draftsCaption")}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.scope")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.normalizedScopeKey",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.status")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.version")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.inputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.outputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.updatedAt")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((draft) => {
                  const inputFmt = formatMicrocreditRate(
                    draft.inputMicrocreditsPerMillion,
                    locale,
                  );
                  const outputFmt = formatMicrocreditRate(
                    draft.outputMicrocreditsPerMillion,
                    locale,
                  );
                  return (
                    <TableRow key={draft.id}>
                      <TableCell>
                        <PricingScopeBadge scope={draft.scope} />
                      </TableCell>
                      <TableCell className="space-y-1 font-mono text-xs text-foreground">
                        <div>{draft.normalizedScopeKey}</div>
                        {draft.operationalAssumptions ? (
                          <Badge
                            variant="outline"
                            className="rounded-sm border-admin-warning-border bg-admin-warning-surface font-sans text-admin-warning-foreground"
                          >
                            <span>
                              {resolveAppMessage(
                                "pages.admin.pricing.labels.nonAuthoritativeTag",
                              )}
                            </span>
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <PricingDraftStatusBadge status={draft.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        v{draft.version}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        <div>{inputFmt.microcreditsFormatted}</div>
                        <div className="text-muted-foreground">
                          {formatAppMessage(
                            "pages.admin.pricing.labels.creditsPerMillion",
                            { credits: inputFmt.creditsDecimal },
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        <div>{outputFmt.microcreditsFormatted}</div>
                        <div className="text-muted-foreground">
                          {formatAppMessage(
                            "pages.admin.pricing.labels.creditsPerMillion",
                            { credits: outputFmt.creditsDecimal },
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        <div>{draft.updatedBy}</div>
                        <div className="text-muted-foreground">
                          {formatLocaleDateTimeWithYear(
                            draft.updatedAt,
                            locale,
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-pricing-inspect="DRAFT"
                            onClick={() => onInspect(draft)}
                          >
                            <EyeIcon aria-hidden="true" />
                            <span>
                              {resolveAppMessage(
                                "pages.admin.pricing.labels.inspect",
                              )}
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${resolveAppMessage("pages.admin.pricing.labels.copyId")}: ${draft.id}`}
                            onClick={() => onCopyId(draft.id)}
                          >
                            <CopyIcon aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
