"use client";

import { CUSTOMER_USAGE_DIMENSIONS } from "@lcsp/contracts/billing";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CUSTOMER_USAGE_LABELS } from "../../config/customer-usage.config";
import type {
  CustomerUsageBreakdownProps,
  CustomerUsageDimension,
} from "../../types/customer-usage.types";
import { formatUsageCount } from "../../utils/customer-usage";

export function CustomerUsageBreakdown({
  locale,
  rows,
}: CustomerUsageBreakdownProps) {
  const [dimension, setDimension] = useState<CustomerUsageDimension>(
    CUSTOMER_USAGE_DIMENSIONS.DAY,
  );

  return (
    <section
      className="min-w-0 space-y-3"
      aria-labelledby="customer-usage-breakdown-heading"
    >
      <h3 id="customer-usage-breakdown-heading" className="font-semibold">
        {resolveMessage(locale, "pages.workspace.settingsHub.usage.breakdown")}
      </h3>
      <Select<CustomerUsageDimension>
        value={dimension}
        onValueChange={(value) => {
          if (value) setDimension(value);
        }}
      >
        <SelectTrigger
          aria-label={resolveMessage(
            locale,
            "pages.workspace.settingsHub.usage.breakdown",
          )}
          className="w-full sm:w-48"
        >
          <SelectValue>
            {resolveMessage(locale, CUSTOMER_USAGE_LABELS[dimension])}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.values(CUSTOMER_USAGE_DIMENSIONS).map((value) => (
            <SelectItem key={value} value={value}>
              {resolveMessage(locale, CUSTOMER_USAGE_LABELS[value])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        className="max-h-80 overflow-auto rounded-xl border"
        tabIndex={0}
        role="region"
        aria-label={resolveMessage(
          locale,
          "pages.workspace.settingsHub.usage.breakdown",
        )}
      >
        <Table>
          <TableCaption className="sr-only">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.usage.breakdown",
            )}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.group",
                )}
              </TableHead>
              <TableHead scope="col">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.calls",
                )}
              </TableHead>
              <TableHead scope="col">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.totalTokens",
                )}
              </TableHead>
              <TableHead scope="col">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.unknownInvocations",
                )}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .filter((row) => row.dimension === dimension)
              .map((row) => (
                <TableRow key={row.key}>
                  <TableHead
                    scope="row"
                    className="max-w-48 wrap-anywhere whitespace-normal font-normal"
                  >
                    {row.key}
                  </TableHead>
                  <TableCell className="tabular-nums">
                    {formatUsageCount(row.summary.calls, locale)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.summary.tokens.totalTokens.unknownInvocations ===
                    row.summary.calls
                      ? resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.usage.unknown",
                        )
                      : formatUsageCount(
                          row.summary.tokens.totalTokens.known,
                          locale,
                        )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatUsageCount(
                      row.summary.tokens.totalTokens.unknownInvocations,
                      locale,
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
