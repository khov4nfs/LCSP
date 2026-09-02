"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useFormContext } from "react-hook-form";

import { appLocale } from "@/lib/locale";
import type { SignInFormValues } from "../../schemas/sign-in.schema";
import type { CredentialFieldProps } from "../../types/sign-in.types";
import { AuthTextField } from "./auth-form-primitives";

export function CredentialField({ field }: CredentialFieldProps) {
  const { formState, register } = useFormContext<SignInFormValues>();
  const error = formState.errors[field.name]?.message;

  return (
    <AuthTextField
      id={field.name}
      type={field.type}
      autoComplete={field.autoComplete}
      disabled={formState.isSubmitting}
      label={resolveMessage(appLocale, field.labelKey)}
      description={resolveMessage(appLocale, field.descriptionKey)}
      error={
        error
          ? resolveMessage(
              appLocale,
              error as Parameters<typeof resolveMessage>[1],
            )
          : undefined
      }
      {...register(field.name)}
    />
  );
}
