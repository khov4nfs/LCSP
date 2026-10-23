"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MODEL_ATTEMPT_STATUSES } from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import {
  adminUsageFiltersSchema,
  type AdminUsageFilters,
} from "../../schemas/admin-usage.schema";
import {
  DEFAULT_USAGE_FILTERS,
  USAGE_FILTER_FIELDS,
} from "../../config/admin-usage.config";
import type { UsageFiltersProps } from "../../types/admin-usage.types";
export function AdminUsageFiltersForm({ onApply }: UsageFiltersProps) {
  const form = useForm<AdminUsageFilters>({
    resolver: zodResolver(adminUsageFiltersSchema),
    defaultValues: DEFAULT_USAGE_FILTERS,
  });
  const m = (key: string) =>
    resolveAppMessage(`pages.admin.usage.${key}` as MessageKey);
  return (
    <form
      onSubmit={form.handleSubmit(onApply)}
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {USAGE_FILTER_FIELDS.map((field) => (
        <label key={field} className="space-y-1 text-sm">
          <span>{m(field)}</span>
          <Input
            type={field === "from" || field === "to" ? "date" : "text"}
            {...form.register(field)}
          />
        </label>
      ))}
      <label className="space-y-1 text-sm">
        <span>{m("status")}</span>
        <select
          {...form.register("attemptStatus")}
          className="h-8 w-full rounded-lg border border-input bg-background px-2"
        >
          <option value="">{m("all")}</option>
          {Object.values(MODEL_ATTEMPT_STATUSES).map((s) => (
            <option key={s} value={s}>
              {m(s)}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" className="self-end">
        {m("apply")}
      </Button>
      {Object.keys(form.formState.errors).length ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {m("invalidFilters")}
        </p>
      ) : null}
    </form>
  );
}
