"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { useAppLocale } from "@/components/providers/locale-provider";
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
  // Keep request copy reactive without resetting the email or the enumeration-safe confirmation state.
  const locale = useAppLocale();
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

  // AuthShell owns page placement; natural height keeps confirmation and error feedback from clipping.
  return (
    <AuthFormSurface className="w-full" data-figma-node="1662:1195">
      <AuthHeading
        title={resolveMessage(locale, "pages.recoveryRequest.formTitle")}
        description={resolveMessage(
          locale,
          "pages.recoveryRequest.formDescription",
        )}
      />
      <FormProvider {...form}>
        {/* The reference places the email row below the heading while retaining the current request and feedback states. */}
        <form
          id="recovery-request-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-11.5 flex flex-col"
        >
          <FieldGroup className="gap-4.5">
            <AuthTextField
              id="email"
              type="email"
              autoComplete="email"
              disabled={form.formState.isSubmitting}
              label={resolveMessage(
                locale,
                "pages.recoveryRequest.emailLabel",
              )}
              placeholder={resolveMessage(
                locale,
                "pages.recoveryRequest.emailPlaceholder",
              )}
              description={resolveMessage(
                locale,
                "pages.recoveryRequest.emailDescription",
              )}
              descriptionClassName="sr-only"
              error={
                emailError
                  ? resolveMessage(
                      locale,
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
                    locale,
                    "pages.recoveryRequest.successTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    locale,
                    "pages.recoveryRequest.successDetail",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(locale, error.titleKey)}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(locale, error.detailKey)}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-8"
            type="submit"
            form="recovery-request-form"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {resolveMessage(
              locale,
              form.formState.isSubmitting
                ? "pages.recoveryRequest.submitting"
                : "pages.recoveryRequest.submit",
            )}
          </AuthPrimaryButton>
        </form>
        <AuthInlineLink
          href={API_REDIRECT_LOCATIONS.signIn}
          className="mt-6 self-start"
        >
          {resolveMessage(locale, "pages.recoveryRequest.backToSignIn")}
        </AuthInlineLink>
        <AuthNote className="mt-8 self-start text-left">
          {resolveMessage(locale, "pages.recoveryRequest.accessHelp")}
        </AuthNote>
      </FormProvider>
    </AuthFormSurface>
  );
}
