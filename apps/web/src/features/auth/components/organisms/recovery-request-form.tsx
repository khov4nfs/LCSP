"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { appLocale } from "@/lib/locale";
import { useRequestRecoveryMutation } from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";

import {
  recoveryRequestSchema,
  type RecoveryRequestFormValues,
} from "../../schemas/recovery-request.schema";
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

export function RecoveryRequestForm() {
  const requestMutation = useRequestRecoveryMutation();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<{
    titleKey: Parameters<typeof resolveMessage>[1];
    detailKey: Parameters<typeof resolveMessage>[1];
  } | null>(null);
  const form = useForm<RecoveryRequestFormValues>({
    resolver: zodResolver(recoveryRequestSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: RecoveryRequestFormValues) {
    setError(null);
    const outcome = await requestMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.recoveryRequest.errors.requestFailedTitle" as const,
      detailKey: "pages.recoveryRequest.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.requested) {
      setSubmitted(true);
      form.reset();
      return;
    }

    setError(outcome);
  }

  const emailError = form.formState.errors.email?.message;

  return (
    <AuthFormSurface className="pt-[168px]" data-figma-node="925:31314">
      <AuthHeading
        title={resolveMessage(appLocale, "pages.recoveryRequest.formTitle")}
        description={resolveMessage(
          appLocale,
          "pages.recoveryRequest.formDescription",
        )}
      />
      <FormProvider {...form}>
        <form
          id="recovery-request-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-[38px] flex flex-col"
        >
          <FieldGroup className="gap-[18px]">
            <AuthTextField
              id="email"
              type="email"
              autoComplete="email"
              disabled={form.formState.isSubmitting}
              label={resolveMessage(
                appLocale,
                "pages.recoveryRequest.emailLabel",
              )}
              description={resolveMessage(
                appLocale,
                "pages.recoveryRequest.emailDescription",
              )}
              error={
                emailError
                  ? resolveMessage(
                      appLocale,
                      emailError as Parameters<typeof resolveMessage>[1],
                    )
                  : undefined
              }
              {...form.register("email")}
            />
            {submitted ? (
              <Alert>
                <AlertTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.recoveryRequest.successTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    appLocale,
                    "pages.recoveryRequest.successDetail",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(appLocale, error.titleKey)}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(appLocale, error.detailKey)}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-6"
            type="submit"
            form="recovery-request-form"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {resolveMessage(
              appLocale,
              form.formState.isSubmitting
                ? "pages.recoveryRequest.submitting"
                : "pages.recoveryRequest.submit",
            )}
          </AuthPrimaryButton>
        </form>
        <AuthInlineLink
          href={API_REDIRECT_LOCATIONS.signIn}
          className="mt-[22px] self-start"
        >
          {resolveMessage(appLocale, "pages.recoveryRequest.backToSignIn")}
        </AuthInlineLink>
        <AuthNote className="mt-[34px]">
          {resolveMessage(appLocale, "pages.recoveryRequest.accessHelp")}
        </AuthNote>
      </FormProvider>
    </AuthFormSurface>
  );
}
