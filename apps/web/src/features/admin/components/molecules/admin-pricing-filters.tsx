"use client";

import { useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveAppMessage } from "@/lib/i18n";
import {
  DEFAULT_ADMIN_PRICING_FILTERS,
  PRICING_ASSIGNMENT_STATUS_OPTIONS,
  PRICING_SCOPE_LABEL_KEYS,
  PRICING_SCOPE_OPTIONS,
  PRICING_ASSIGNMENT_STATUS_LABEL_KEYS,
} from "../../config/admin-pricing.config";
import {
  adminPricingFiltersSchema,
  type AdminPricingFilters,
} from "../../schemas/admin-pricing.schema";

type AdminPricingFiltersFormProps = {
  filters: AdminPricingFilters;
  onApply: (nextFilters: AdminPricingFilters) => void;
  onReset: () => void;
};

/**
 * Read-only filter bar built with React Hook Form + Zod schema (`schemas/admin-pricing.schema.ts`).
 */
export function AdminPricingFiltersForm({
  filters,
  onApply,
  onReset,
}: AdminPricingFiltersFormProps) {
  const form = useForm<AdminPricingFilters>({
    resolver: zodResolver(adminPricingFiltersSchema),
    defaultValues: filters,
  });

  useEffect(() => {
    form.reset(filters);
  }, [filters, form]);

  function handleReset() {
    form.reset(DEFAULT_ADMIN_PRICING_FILTERS);
    onReset();
  }

  return (
    <Card className="rounded-lg border border-border bg-card shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {resolveAppMessage("pages.admin.pricing.filters.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FormProvider {...form}>
          <form
            onSubmit={form.handleSubmit(onApply)}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
            data-testid="admin-pricing-filters-form"
          >
            <label className="space-y-1.5 text-xs font-medium text-foreground">
              <span>{resolveAppMessage("pages.admin.pricing.filters.provider")}</span>
              <Input
                type="text"
                placeholder={resolveAppMessage(
                  "pages.admin.pricing.filters.providerPlaceholder",
                )}
                {...form.register("provider")}
              />
            </label>

            <label className="space-y-1.5 text-xs font-medium text-foreground">
              <span>
                {resolveAppMessage("pages.admin.pricing.filters.resolvedModel")}
              </span>
              <Input
                type="text"
                placeholder={resolveAppMessage(
                  "pages.admin.pricing.filters.resolvedModelPlaceholder",
                )}
                {...form.register("resolvedModel")}
              />
            </label>

            <label className="space-y-1.5 text-xs font-medium text-foreground">
              <span>{resolveAppMessage("pages.admin.pricing.filters.scope")}</span>
              <select
                aria-label={resolveAppMessage(
                  "pages.admin.pricing.filters.scope",
                )}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                {...form.register("scope")}
              >
                <option value="">
                  {resolveAppMessage("pages.admin.pricing.filters.allScopes")}
                </option>
                {PRICING_SCOPE_OPTIONS.map((scope) => (
                  <option key={scope} value={scope}>
                    {resolveAppMessage(PRICING_SCOPE_LABEL_KEYS[scope])}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-xs font-medium text-foreground">
              <span>{resolveAppMessage("pages.admin.pricing.filters.status")}</span>
              <select
                aria-label={resolveAppMessage(
                  "pages.admin.pricing.filters.status",
                )}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                {...form.register("status")}
              >
                <option value="">
                  {resolveAppMessage("pages.admin.pricing.filters.allStatuses")}
                </option>
                {PRICING_ASSIGNMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {resolveAppMessage(
                      PRICING_ASSIGNMENT_STATUS_LABEL_KEYS[status],
                    )}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col justify-end gap-2">
              <label className="inline-flex min-h-6 items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded-sm border border-input accent-brand"
                  {...form.register("coverageGapOnly")}
                />
                <span>
                  {resolveAppMessage(
                    "pages.admin.pricing.filters.coverageGapOnly",
                  )}
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm">
                  {resolveAppMessage("pages.admin.pricing.filters.apply")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                >
                  {resolveAppMessage("pages.admin.pricing.filters.reset")}
                </Button>
              </div>
            </div>

            {Object.keys(form.formState.errors).length > 0 ? (
              <p
                role="alert"
                className="text-xs text-destructive sm:col-span-2 lg:col-span-5"
              >
                {resolveAppMessage("pages.admin.pricing.filters.invalidFilters")}
              </p>
            ) : null}
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
