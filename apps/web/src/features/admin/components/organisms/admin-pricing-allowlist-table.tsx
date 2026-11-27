"use client";

import type { ModelPricingAllowlistedModelView } from "@lcsp/contracts/billing";
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
import { resolveAppMessage } from "@/lib/i18n";

type AdminPricingAllowlistTableProps = {
  models: readonly ModelPricingAllowlistedModelView[];
};

/**
 * Displays runtime-allowlisted model routes eligible for tariff resolution.
 */
export function AdminPricingAllowlistTable({
  models,
}: AdminPricingAllowlistTableProps) {
  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {resolveAppMessage("pages.admin.pricing.sections.allowlistTitle")}
        </CardTitle>
        <CardDescription>
          {resolveAppMessage(
            "pages.admin.pricing.sections.allowlistDescription",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {models.length === 0 ? (
          <Empty
            className="border border-dashed border-border py-8"
            data-testid="admin-pricing-allowlist-empty"
          >
            <EmptyHeader>
              <EmptyTitle>
                {resolveAppMessage(
                  "pages.admin.pricing.emptyStates.noAllowlistTitle",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {resolveAppMessage(
                  "pages.admin.pricing.emptyStates.noAllowlistDescription",
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            role="region"
            tabIndex={0}
            aria-label={resolveAppMessage(
              "pages.admin.pricing.sections.allowlistTableRegionAria",
            )}
            className="overflow-x-auto rounded-md border border-border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Table data-testid="admin-pricing-allowlist-table">
              <TableCaption className="sr-only">
                {resolveAppMessage(
                  "pages.admin.pricing.sections.allowlistCaption",
                )}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.role")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.routeKey")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.provider")}
                  </TableHead>
                  <TableHead scope="col">
                    {resolveAppMessage("pages.admin.pricing.columns.model")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((entry) => (
                  <TableRow key={`${entry.role}:${entry.routeKey}`}>
                    <TableCell className="font-mono text-xs text-foreground">
                      {entry.role}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.routeKey}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {entry.provider}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {entry.resolvedModel}
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
