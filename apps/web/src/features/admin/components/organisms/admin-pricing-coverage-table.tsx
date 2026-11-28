"use client";

import { CheckCircle2Icon, CopyIcon, EyeIcon } from "lucide-react";
import type { ModelPricingCoverageRow } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
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
import { TOKEN_BUCKET_POLICY_LABEL_KEYS } from "../../config/admin-pricing.config";
import { formatMicrocreditRate } from "../../utils/admin-pricing-format";

type AdminPricingCoverageTableProps = {
  rows: readonly ModelPricingCoverageRow[];
  hasActiveFilters: boolean;
  locale: Locale;
  onResetFilters: () => void;
  onInspect: (row: ModelPricingCoverageRow) => void;
  onCopyId: (id: string) => void;
};

function RateCell({
  microcredits,
  locale,
}: {
  microcredits: string | null;
  locale: Locale;
}) {
  if (microcredits === null) {
    return (
      <span className="text-muted-foreground">
        {resolveAppMessage("pages.admin.pricing.labels.none")}
      </span>
    );
  }
  const formatted = formatMicrocreditRate(microcredits, locale);
  return (
    <div className="space-y-0.5 font-mono tabular-nums">
      <div className="text-xs font-medium text-foreground">
        {formatted.microcreditsFormatted}{" "}
        <span className="text-muted-foreground">
          {resolveAppMessage("pages.admin.pricing.labels.microcreditsUnit")}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {formatAppMessage("pages.admin.pricing.labels.creditsPerMillion", {
          credits: formatted.creditsDecimal,
        })}
      </div>
    </div>
  );
}

/**
 * Precedence-ordered effective pricing coverage table (`EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT` -> gap).
 */
export function AdminPricingCoverageTable({
  rows,
  hasActiveFilters,
  locale,
  onResetFilters,
  onInspect,
  onCopyId,
}: AdminPricingCoverageTableProps) {
  const none = resolveAppMessage("pages.admin.pricing.labels.none");
  const openEnded = resolveAppMessage("pages.admin.pricing.labels.openEnded");

  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {resolveAppMessage("pages.admin.pricing.sections.coverageTitle")}
        </CardTitle>
        <CardDescription>
          {resolveAppMessage(
            "pages.admin.pricing.sections.coverageDescription",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty
            className="border border-dashed border-border py-8"
            data-testid={
              hasActiveFilters
                ? "admin-pricing-coverage-filter-empty"
                : "admin-pricing-coverage-empty"
            }
          >
            <EmptyHeader>
              <EmptyTitle>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyTitle"
                    : "pages.admin.pricing.emptyStates.noCoverageTitle",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyDescription"
                    : "pages.admin.pricing.emptyStates.noCoverageDescription",
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
              "pages.admin.pricing.sections.coverageTableRegionAria",
            )}
            className="overflow-x-auto rounded-md border border-border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Table data-testid="admin-pricing-coverage-table">
              <TableCaption className="sr-only">
                {resolveAppMessage(
                  "pages.admin.pricing.sections.coverageCaption",
                )}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.provider")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.model")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.fallbackSource",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.coverageStatus",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.inputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.outputRate")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.secondaryBuckets",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.effectiveInterval",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={`${row.provider}:${row.resolvedModel}:${row.normalizedScopeKey}`}
                  >
                    <TableCell className="font-medium text-foreground">
                      {row.provider}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {row.resolvedModel}
                    </TableCell>
                    <TableCell>
                      <PricingScopeBadge scope={row.fallbackSource} />
                    </TableCell>
                    <TableCell>
                      {row.hasCoverage ? (
                        <Badge
                          variant="outline"
                          className="rounded-sm border-admin-status-active-border bg-admin-status-active-surface text-admin-status-active-foreground"
                        >
                          <CheckCircle2Icon aria-hidden="true" />
                          <span>
                            {resolveAppMessage(
                              "pages.admin.pricing.labels.covered",
                            )}
                            {row.snapshotVersion !== null
                              ? ` · v${row.snapshotVersion}`
                              : ""}
                          </span>
                        </Badge>
                      ) : (
                        <PricingScopeBadge scope={null} />
                      )}
                    </TableCell>
                    <TableCell>
                      <RateCell
                        microcredits={
                          row.rates?.inputMicrocreditsPerMillion ?? null
                        }
                        locale={locale}
                      />
                    </TableCell>
                    <TableCell>
                      <RateCell
                        microcredits={
                          row.rates?.outputMicrocreditsPerMillion ?? null
                        }
                        locale={locale}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.rates ? (
                        <div className="space-y-0.5">
                          <div>
                            {resolveAppMessage(
                              TOKEN_BUCKET_POLICY_LABEL_KEYS[
                                row.rates.reasoningPolicy
                              ],
                            )}
                          </div>
                          <div>
                            {resolveAppMessage(
                              TOKEN_BUCKET_POLICY_LABEL_KEYS[
                                row.rates.cachedInputPolicy
                              ],
                            )}
                          </div>
                        </div>
                      ) : (
                        none
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {row.hasCoverage && row.effectiveFrom ? (
                        <div className="space-y-0.5">
                          <div>
                            {formatLocaleDateTimeWithYear(
                              row.effectiveFrom,
                              locale,
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            {row.effectiveTo
                              ? formatLocaleDateTimeWithYear(
                                  row.effectiveTo,
                                  locale,
                                )
                              : openEnded}
                          </div>
                        </div>
                      ) : (
                        none
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-pricing-inspect="COVERAGE"
                          onClick={() => onInspect(row)}
                        >
                          <EyeIcon aria-hidden="true" />
                          <span>
                            {resolveAppMessage(
                              "pages.admin.pricing.labels.inspect",
                            )}
                          </span>
                        </Button>
                        {row.snapshotId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${resolveAppMessage("pages.admin.pricing.labels.copyId")}: ${row.snapshotId}`}
                            onClick={() => onCopyId(row.snapshotId!)}
                          >
                            <CopyIcon aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
