"use client";

import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useFormContext, type FieldValues } from "react-hook-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormTextFieldProps } from "@/components/types/form-text-field.types";
import { cn } from "@/lib/utils";
import { appLocale } from "@/lib/locale";

export function FormTextField<T extends FieldValues>({
  name,
  id,
  labelKey,
  descriptionKey,
  autoComplete,
  type = "text",
  inputClassName,
  actions,
  wrapActions = false,
}: FormTextFieldProps<T>) {
  const { register, getFieldState, formState } = useFormContext<T>();
  const { error } = getFieldState(name, formState);
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>
        {resolveMessage(appLocale, labelKey)}
      </FieldLabel>
      {/* Compact profile rows wrap actions so the editable field keeps its usable minimum width. */}
      <div
        className={cn(
          "flex min-w-0 items-center justify-between gap-4 sm:gap-6",
          wrapActions &&
            "flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center sm:gap-6",
        )}
      >
        <Input
          {...register(name)}
          id={id}
          type={type}
          className={cn(
            inputClassName,
            // A CSS-pixel floor stays usable under root-font enlargement; rem-based minima grow beyond narrow viewports.
            wrapActions && "min-w-[180px] basis-48 flex-1",
          )}
          autoComplete={autoComplete}
          disabled={formState.isSubmitting}
          aria-invalid={!!error}
          aria-describedby={
            [
              descriptionKey ? `${id}-description` : null,
              error ? `${id}-error` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-2",
              wrapActions && "ml-auto max-w-full min-w-0 shrink flex-wrap justify-end",
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {descriptionKey ? (
        <FieldDescription id={`${id}-description`}>
          {resolveMessage(appLocale, descriptionKey)}
        </FieldDescription>
      ) : null}
      {error?.message ? (
        <FieldError id={`${id}-error`}>
          {resolveMessage(appLocale, error.message as MessageKey)}
        </FieldError>
      ) : null}
    </Field>
  );
}
