"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useFormContext } from "react-hook-form";

import { useAppLocale } from "@/components/providers/locale-provider";
import type { SignInFormValues } from "../../schemas/sign-in.schema";
import type { CredentialFieldProps } from "../../types/sign-in.types";
import { AuthTextField } from "./auth-form-primitives";

export function CredentialField({ field }: CredentialFieldProps) {
  const locale = useAppLocale();
  const { formState, register } = useFormContext<SignInFormValues>();
  const error = formState.errors[field.name]?.message;

  return (
    <AuthTextField
      id={field.name}
      type={field.type}
      autoComplete={field.autoComplete}
      disabled={formState.isSubmitting}
      label={resolveMessage(locale, field.labelKey)}
      placeholder={resolveMessage(locale, field.placeholderKey)}
      description={resolveMessage(locale, field.descriptionKey)}
      descriptionClassName="sr-only"
      error={
        error
          ? resolveMessage(
              // Keep validation feedback reactive with the label and helper text.
              locale,
              error as Parameters<typeof resolveMessage>[1],
            )
          : undefined
      }
      {...register(field.name)}
    />
  );
}
