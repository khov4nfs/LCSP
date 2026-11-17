"use client";

import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Controller, useFormContext, type FieldValues } from "react-hook-form";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormSelectFieldProps } from "@/components/types/form-select-field.types";
import { appLocale } from "@/lib/locale";

export function FormSelectField<T extends FieldValues>({
  name,
  id,
  labelKey,
  options,
}: FormSelectFieldProps<T>) {
  const { control, formState } = useFormContext<T>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={!!fieldState.error}>
          <FieldLabel htmlFor={id}>
            {resolveMessage(appLocale, labelKey)}
          </FieldLabel>
          <Select
            name={field.name}
            value={field.value}
            items={options.map((option) => ({
              value: option.value,
              label: resolveMessage(appLocale, option.labelKey),
            }))}
            onValueChange={field.onChange}
            disabled={formState.isSubmitting}
          >
            <SelectTrigger
              ref={field.ref}
              id={id}
              onBlur={field.onBlur}
              className="w-full"
              aria-invalid={!!fieldState.error}
              aria-describedby={fieldState.error ? `${id}-error` : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {resolveMessage(appLocale, option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error?.message ? (
            <FieldError id={`${id}-error`}>
              {resolveMessage(
                appLocale,
                fieldState.error.message as MessageKey,
              )}
            </FieldError>
          ) : null}
        </Field>
      )}
    />
  );
}
