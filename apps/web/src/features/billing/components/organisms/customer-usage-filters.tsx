"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { FormProvider, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { CUSTOMER_USAGE_PERIODS } from "../../config/customer-usage.config";
import {
  customerUsageFiltersSchema,
  toCustomerUsageQuery,
  type CustomerUsageFilters,
} from "../../schemas/customer-usage.schema";
import { customerUsagePeriod } from "../../utils/customer-usage";
import type { CustomerUsageFiltersProps } from "../../types/customer-usage.types";
import { CustomerUsageFilterFields } from "../molecules/customer-usage-filter-fields";

export function CustomerUsageFiltersForm({
  locale,
  query,
  onApply,
}: CustomerUsageFiltersProps) {
  const form = useForm<CustomerUsageFilters>({
    resolver: zodResolver(customerUsageFiltersSchema),
    defaultValues: {
      from: query.from!.slice(0, 10),
      to: query.to!.slice(0, 10),
      provider: query.provider ?? "",
      model: query.model ?? "",
      attemptStatus: query.attemptStatus ?? "",
    },
  });

  /**
   * Business purpose: Apply a quick reporting window without discarding the customer's other filters.
   * Business rules:
   * - Quick periods use inclusive UTC days and go through the same validated form submission as custom dates.
   * Execution flow:
   * 1. Set date fields from the chosen period and submit the full filter draft.
   * Failure cases:
   * - Invalid text/status drafts remain field errors and do not replace the current report.
   * Side effects:
   * - Updates form dates and may replace the active report query at page one.
   */
  function applyPeriod(days: number) {
    const period = customerUsagePeriod(days);
    form.setValue("from", period.from!.slice(0, 10));
    form.setValue("to", period.to!.slice(0, 10));
    void form.handleSubmit(applyFilters)();
  }

  /**
   * Business purpose: Replace the active usage query only after the filter draft is valid.
   * Business rules:
   * - Date and filter changes restart pagination and never modify billing settings.
   * Execution flow:
   * 1. Map the validated draft to a bounded query and notify the report container.
   * Failure cases:
   * - The form resolver prevents invalid drafts from reaching this callback.
   * Side effects:
   * - Changes the query subscription through the parent; no persistence.
   */
  function applyFilters(values: CustomerUsageFilters) {
    onApply(toCustomerUsageQuery(values));
  }

  return (
    <FormProvider {...form}>
      <Card>
        <CardContent>
          <form
            noValidate
            onSubmit={form.handleSubmit(applyFilters)}
            className="space-y-4"
            aria-label={resolveMessage(
              locale,
              "pages.workspace.settingsHub.usage.filters",
            )}
          >
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.period",
              )}
            >
              {CUSTOMER_USAGE_PERIODS.map((days) => (
                <Button
                  key={days}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPeriod(days)}
                >
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.usage.days",
                  ).replace("{days}", String(days))}
                </Button>
              ))}
            </div>
            <CustomerUsageFilterFields />
            <Button type="submit">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.apply",
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </FormProvider>
  );
}
