"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useAppLocale } from "@/components/providers/locale-provider";
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
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

function RegularSignUpForm() {
  // Subscribe to locale changes without remounting so validation state and entered credentials remain intact.
  const locale = useAppLocale();
  const router = useRouter();
  const signUpMutation = useSignUpMutation();
  const [submissionError, setSubmissionError] =
    useState<SignUpSubmissionError>(null);
  const form = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      display_name: "",
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

  // AuthShell owns page alignment; let field feedback and longer translated copy determine the form height.
  return (
    <AuthFormSurface className="w-full" data-figma-node="1662:1128">
      <AuthHeading
        title={resolveMessage(locale, "pages.signUp.formTitle")}
        description={resolveMessage(locale, "pages.signUp.formDescription")}
      />
      <FormProvider {...form}>
        {/* The post-heading offset aligns the first field row with the audited sign-up frame. */}
        <form
          id="sign-up-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-10.5 flex flex-col"
        >
          <FieldGroup className="gap-6.5">
            {submissionError ? (
              <SignUpErrorAlert submissionError={submissionError} />
            ) : null}
            {signUpFields.map((field) => (
              <SignUpField key={field.name} field={field} />
            ))}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-7"
            type="submit"
            form="sign-up-form"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            {resolveMessage(
              locale,
              form.formState.isSubmitting
                ? "pages.signUp.submitting"
                : "pages.signUp.submit",
            )}
          </AuthPrimaryButton>
        </form>
        <p className="mt-6 text-left text-xs leading-4 text-muted-foreground">
          {resolveMessage(locale, "pages.signUp.alreadyHaveAccount")}{" "}
          <AuthInlineLink href={API_REDIRECT_LOCATIONS.signIn}>
            {resolveMessage(locale, "pages.signUp.signInInstead")}
          </AuthInlineLink>
        </p>
        <AuthNote className="sr-only">
          {resolveMessage(locale, "pages.signUp.accessHelp")}
        </AuthNote>
      </FormProvider>
    </AuthFormSurface>
  );
}

function SignUpField({ field }: SignUpFieldProps) {
  // Resolve field labels and validation messages from the active locale while preserving the RHF registration.
  const locale = useAppLocale();
  const { formState, register } = useFormContext<SignUpFormValues>();
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
      trailing={
        field.name === "password"
          ? resolveMessage(locale, "pages.signUp.passwordMinHint")
          : undefined
      }
      error={
        error
          ? resolveMessage(
              locale,
              error as Parameters<typeof resolveMessage>[1],
            )
          : undefined
      }
      {...register(field.name)}
    />
  );
}

function SignUpErrorAlert({
  submissionError,
}: {
  submissionError: Exclude<SignUpSubmissionError, null>;
}) {
  // Keep API outcome copy reactive to locale changes without altering the existing submission outcome mapping.
  const locale = useAppLocale();
  if (submissionError === SIGN_UP_SUBMISSION_ERRORS.emailAlreadyExists) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {resolveMessage(locale, "pages.signUp.errors.emailExistsTitle")}
        </AlertTitle>
        <AlertDescription>
          {resolveMessage(locale, "pages.signUp.errors.emailExistsDetail")}{" "}
          <AuthInlineLink href={API_REDIRECT_LOCATIONS.signIn}>
            {resolveMessage(locale, "pages.signUp.signInInstead")}
          </AuthInlineLink>
        </AlertDescription>
      </Alert>
    );
  }

  if (submissionError === SIGN_UP_SUBMISSION_ERRORS.invalidRequest) {
    return (
      <Alert variant="destructive">
        <AlertTitle>
          {resolveMessage(locale, "pages.signUp.errors.invalidRequestTitle")}
        </AlertTitle>
        <AlertDescription>
          {resolveMessage(
            locale,
            "pages.signUp.errors.invalidRequestDetail",
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>
        {resolveMessage(locale, "pages.signUp.errors.requestFailedTitle")}
      </AlertTitle>
      <AlertDescription>
        {resolveMessage(locale, "pages.signUp.errors.requestFailedDetail")}
      </AlertDescription>
    </Alert>
  );
}

export function SignUpForm() {
  return <RegularSignUpForm />;
}
