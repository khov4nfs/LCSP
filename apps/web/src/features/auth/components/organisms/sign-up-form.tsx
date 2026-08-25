"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormCard } from "@/components/organisms/form-card";
import { appLocale } from "@/lib/locale";
import { useSignUpMutation } from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";

import { signUpFields } from "../../config/sign-up-fields";
import {
  signUpSchema,
  type SignUpFormValues,
} from "../../schemas/sign-up.schema";
import {
  SIGN_UP_SUBMISSION_ERRORS,
  type SignUpFieldProps,
  type SignUpSubmissionError,
} from "../../types/sign-up.types";

export function SignUpForm() {
  const router = useRouter();
  const signUpMutation = useSignUpMutation();
  const [submissionError, setSubmissionError] =
    useState<SignUpSubmissionError>(null);
  const form = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      display_name: "",
      organization_name: "",
      email: "",
      password: "",
      confirm_password: "",
    },
  });

  async function onSubmit(values: SignUpFormValues) {
    setSubmissionError(null);
    const outcome = await signUpMutation
      .mutateAsync({
        display_name: values.display_name.trim(),
        organization_name: values.organization_name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      })
      .catch(() => ({ kind: API_OUTCOME_KINDS.error }));

    if (outcome.kind === API_OUTCOME_KINDS.authenticated) {
      form.reset();
      router.replace("/workspace");
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.passwordTooShort) {
      form.setError("password", {
        message: "pages.signUp.errors.passwordTooShort",
      });
      return;
    }

    setSubmissionError(
      outcome.kind === API_OUTCOME_KINDS.emailAlreadyExists
        ? SIGN_UP_SUBMISSION_ERRORS.emailAlreadyExists
        : outcome.kind === API_OUTCOME_KINDS.validationError
          ? SIGN_UP_SUBMISSION_ERRORS.invalidRequest
          : SIGN_UP_SUBMISSION_ERRORS.requestFailed,
    );
  }

  return (
    <FormProvider {...form}>
      <FormCard
        title={resolveMessage(appLocale, "pages.signUp.formTitle")}
        description={resolveMessage(appLocale, "pages.signUp.formDescription")}
        footer={
          <>
            <Button
              className="w-full"
              type="submit"
              form="sign-up-form"
              disabled={form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {resolveMessage(
                appLocale,
                form.formState.isSubmitting
                  ? "pages.signUp.submitting"
                  : "pages.signUp.submit",
              )}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              {resolveMessage(appLocale, "pages.signUp.alreadyHaveAccount")}{" "}
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={API_REDIRECT_LOCATIONS.signIn}
              >
                {resolveMessage(appLocale, "pages.signUp.signInInstead")}
              </Link>
            </p>
          </>
        }
      >
        <form
          id="sign-up-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <FieldGroup>
            {submissionError ? (
              <SignUpErrorAlert submissionError={submissionError} />
            ) : null}
            {signUpFields.map((field) => (
              <SignUpField key={field.name} field={field} />
            ))}
          </FieldGroup>
        </form>
      </FormCard>
    </FormProvider>
  );
}

function SignUpField({ field }: SignUpFieldProps) {
  const { formState, register } = useFormContext<SignUpFormValues>();
  const error = formState.errors[field.name]?.message;

  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={field.name}>
        {resolveMessage(appLocale, field.labelKey)}
      </FieldLabel>
      <Input
        id={field.name}
        type={field.type}
        autoComplete={field.autoComplete}
        disabled={formState.isSubmitting}
        aria-invalid={Boolean(error)}
        {...register(field.name)}
      />
      {error ? (
        <FieldError>
          {resolveMessage(
            appLocale,
            error as Parameters<typeof resolveMessage>[1],
          )}
        </FieldError>
      ) : (
        <FieldDescription>
          {resolveMessage(appLocale, field.descriptionKey)}
        </FieldDescription>
      )}
    </Field>
  );
}

function SignUpErrorAlert({
  submissionError,
}: {
  submissionError: Exclude<SignUpSubmissionError, null>;
}) {
  if (submissionError === SIGN_UP_SUBMISSION_ERRORS.emailAlreadyExists) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {resolveMessage(appLocale, "pages.signUp.errors.emailExistsTitle")}
        </AlertTitle>
        <AlertDescription>
          {resolveMessage(appLocale, "pages.signUp.errors.emailExistsDetail")}{" "}
          <Link className="underline" href={API_REDIRECT_LOCATIONS.signIn}>
            {resolveMessage(appLocale, "pages.signUp.signInInstead")}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (submissionError === SIGN_UP_SUBMISSION_ERRORS.invalidRequest) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {resolveMessage(appLocale, "pages.signUp.errors.invalidRequestTitle")}
        </AlertTitle>
        <AlertDescription>
          {resolveMessage(
            appLocale,
            "pages.signUp.errors.invalidRequestDetail",
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>
        {resolveMessage(appLocale, "pages.signUp.errors.requestFailedTitle")}
      </AlertTitle>
      <AlertDescription>
        {resolveMessage(appLocale, "pages.signUp.errors.requestFailedDetail")}
      </AlertDescription>
    </Alert>
  );
}
