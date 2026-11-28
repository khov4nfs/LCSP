"use client";

import { CopyIcon, EyeIcon } from "lucide-react";
import type { ModelTariffAssignmentView } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
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
import { PricingAssignmentStatusBadge } from "../atoms/pricing-status-badge";

type AdminPricingAssignmentsTableProps = {
  assignments: readonly ModelTariffAssignmentView[];
  hasActiveFilters: boolean;
  locale: Locale;
  onResetFilters: () => void;
  onInspect: (assignment: ModelTariffAssignmentView) => void;
  onCopyId: (id: string) => void;
};

/**
 * Displays active, scheduled, and superseded customer tariff assignments with half-open UTC intervals.
 */
export function AdminPricingAssignmentsTable({
  assignments,
  hasActiveFilters,
  locale,
  onResetFilters,
  onInspect,
  onCopyId,
}: AdminPricingAssignmentsTableProps) {
  const none = resolveAppMessage("pages.admin.pricing.labels.none");
  const openEnded = resolveAppMessage("pages.admin.pricing.labels.openEnded");

  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {resolveAppMessage("pages.admin.pricing.sections.assignmentsTitle")}
        </CardTitle>
        <CardDescription>
          {resolveAppMessage(
            "pages.admin.pricing.sections.assignmentsDescription",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <Empty
            className="border border-dashed border-border py-8"
            data-testid="admin-pricing-assignments-empty"
          >
            <EmptyHeader>
              <EmptyTitle>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyTitle"
                    : "pages.admin.pricing.emptyStates.noAssignmentsTitle",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {resolveAppMessage(
                  hasActiveFilters
                    ? "pages.admin.pricing.emptyStates.filterEmptyDescription"
                    : "pages.admin.pricing.emptyStates.noAssignmentsDescription",
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
              "pages.admin.pricing.sections.assignmentsTableRegionAria",
            )}
            className="overflow-x-auto rounded-md border border-border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Table data-testid="admin-pricing-assignments-table">
              <TableCaption className="sr-only">
                {resolveAppMessage(
                  "pages.admin.pricing.sections.assignmentsCaption",
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
                    {resolveAppMessage("pages.admin.pricing.columns.status")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.version")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.effectiveInterval",
                    )}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage(
                      "pages.admin.pricing.columns.snapshotRef",
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
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <PricingScopeBadge scope={assignment.scope} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {assignment.normalizedScopeKey}
                    </TableCell>
                    <TableCell>
                      <PricingAssignmentStatusBadge
                        status={assignment.status}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      v{assignment.version}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      <div>
                        {formatLocaleDateTimeWithYear(
                          assignment.effectiveFrom,
                          locale,
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        {assignment.effectiveTo
                          ? formatLocaleDateTimeWithYear(
                              assignment.effectiveTo,
                              locale,
                            )
                          : openEnded}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {assignment.tariffSnapshotId}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs whitespace-normal text-muted-foreground">
                      <div>{assignment.auditReason ?? none}</div>
                      {assignment.supersededByAssignmentId ? (
                        <div className="mt-0.5 font-mono text-foreground">
                          {formatAppMessage(
                            "pages.admin.pricing.labels.supersededByLabel",
                            { id: assignment.supersededByAssignmentId },
                          )}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-pricing-inspect="ASSIGNMENT"
                          onClick={() => onInspect(assignment)}
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
                          aria-label={`${resolveAppMessage("pages.admin.pricing.labels.copyId")}: ${assignment.id}`}
                          onClick={() => onCopyId(assignment.id)}
                        >
                          <CopyIcon aria-hidden="true" />
                        </Button>
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
