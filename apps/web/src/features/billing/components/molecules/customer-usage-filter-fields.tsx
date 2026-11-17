"use client";

import { FormSelectField } from "@/components/molecules/form-select-field";
import { FormTextField } from "@/components/molecules/form-text-field";

import {
  CUSTOMER_USAGE_FILTER_FIELDS,
  CUSTOMER_USAGE_LABELS,
  CUSTOMER_USAGE_STATUS_OPTIONS,
} from "../../config/customer-usage.config";
import type { CustomerUsageFilters } from "../../schemas/customer-usage.schema";

export function CustomerUsageFilterFields() {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {CUSTOMER_USAGE_FILTER_FIELDS.map((field) => (
        <FormTextField<CustomerUsageFilters>
          key={field}
          name={field}
          id={`customer-usage-${field}`}
          type={field === "from" || field === "to" ? "date" : "text"}
          labelKey={CUSTOMER_USAGE_LABELS[field]}
          inputClassName="min-w-0 w-full"
        />
      ))}
      <FormSelectField<CustomerUsageFilters>
        name="attemptStatus"
        id="customer-usage-status"
        labelKey="pages.workspace.settingsHub.usage.status"
        options={CUSTOMER_USAGE_STATUS_OPTIONS}
      />
    </div>
  );
}
