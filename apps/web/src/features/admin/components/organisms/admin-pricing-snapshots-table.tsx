"use client";

import { CopyIcon, EyeIcon, LockIcon } from "lucide-react";
import type { ModelTariffSnapshotView } from "@lcsp/contracts/billing";
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
import { formatMicrocreditRate } from "../../utils/admin-pricing-format";

type AdminPricingSnapshotsTableProps = {
  snapshots: readonly ModelTariffSnapshotView[];
  hasActiveFilters: boolean;
  locale: Locale;
  onResetFilters: () => void;
  onInspect: (snapshot: ModelTariffSnapshotView) => void;
  onCopyId: (id: string) => void;
};

/**
 * Displays immutable historical `CustomerModelTariffSnapshot` records.
 */
export function AdminPricingSnapshotsTable({
  snapshots,
  hasActiveFilters,
  locale,
  onResetFilters,
  onInspect,
  onCopyId,
}: AdminPricingSnapshotsTableProps) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {resolveAppMessage("pages.admin.pricing.sections.snapshotsTitle")}
        </CardTitle>
        <CardDescription>
          {resolveAppMessage(
            "pages.admin.pricing.sections.snapshotsDescription",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {snapshots.length === 0 ? (
          <Empty
            className="border border-dashed border-border py-8"
            data-testid="admin-pricing-snapshots-empty"
          >
            <EmptyHeader>
              <EmptyTitle>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyTitle"
                    : "pages.admin.pricing.emptyStates.noSnapshotsTitle",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyDescription"
                    : "pages.admin.pricing.emptyStates.noSnapshotsDescription",
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
              "pages.admin.pricing.sections.snapshotsTableRegionAria",
            )}
            className="overflow-x-auto rounded-md border border-border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Table data-testid="admin-pricing-snapshots-table">
              <TableCaption className="sr-only">
                {resolveAppMessage(
                  "pages.admin.pricing.sections.snapshotsCaption",
                )}
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
                    {resolveAppMessage("pages.admin.pricing.columns.version")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.inputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.outputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.publishedBy",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.auditReason",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snapshot) => {
                  const inputFmt = formatMicrocreditRate(
                    snapshot.inputMicrocreditsPerMillion,
                    locale,
                  );
                  const outputFmt = formatMicrocreditRate(
                    snapshot.outputMicrocreditsPerMillion,
                    locale,
                  );
                  return (
                    <TableRow key={snapshot.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PricingScopeBadge scope={snapshot.scope} />
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
                        </div>
                      </TableCell>
                      <TableCell className="space-y-0.5 font-mono text-xs text-foreground">
                        <div>{snapshot.normalizedScopeKey}</div>
                        <div className="text-muted-foreground">
                          {snapshot.id}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        v{snapshot.version}
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
                        <div>{snapshot.publishedBy}</div>
                        <div className="text-muted-foreground">
                          {formatLocaleDateTimeWithYear(
                            snapshot.publishedAt,
                            locale,
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                        {snapshot.auditReason}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-pricing-inspect="SNAPSHOT"
                            onClick={() => onInspect(snapshot)}
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
                            aria-label={`${resolveAppMessage("pages.admin.pricing.labels.copyId")}: ${snapshot.id}`}
                            onClick={() => onCopyId(snapshot.id)}
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
