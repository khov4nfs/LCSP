"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
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
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

export function SignUpForm() {
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

  return (
    <AuthFormSurface className="pt-[104px]" data-figma-node="925:31277">
      <AuthHeading
        title={resolveMessage(appLocale, "pages.signUp.formTitle")}
        description={resolveMessage(appLocale, "pages.signUp.formDescription")}
      />
      <FormProvider {...form}>
        <form
          id="sign-up-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-[30px] flex flex-col"
        >
          <FieldGroup className="gap-3">
            {submissionError ? (
              <SignUpErrorAlert submissionError={submissionError} />
            ) : null}
            {signUpFields.map((field) => (
              <SignUpField key={field.name} field={field} />
            ))}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-5"
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
          </AuthPrimaryButton>
        </form>
        <p className="mt-[18px] text-center text-[11px] leading-4 text-muted-foreground">
          {resolveMessage(appLocale, "pages.signUp.alreadyHaveAccount")}{" "}
          <AuthInlineLink href={API_REDIRECT_LOCATIONS.signIn}>
            {resolveMessage(appLocale, "pages.signUp.signInInstead")}
          </AuthInlineLink>
        </p>
        <AuthNote className="mt-[18px]">
          {resolveMessage(appLocale, "pages.signUp.accessHelp")}
        </AuthNote>
      </FormProvider>
    </AuthFormSurface>
  );
}

function SignUpField({ field }: SignUpFieldProps) {
  const { formState, register } = useFormContext<SignUpFormValues>();
  const error = formState.errors[field.name]?.message;

  return (
    <AuthTextField
      id={field.name}
      type={field.type}
      autoComplete={field.autoComplete}
      disabled={formState.isSubmitting}
      label={resolveMessage(appLocale, field.labelKey)}
      description={resolveMessage(appLocale, field.descriptionKey)}
      trailing={
        field.name === "password"
          ? resolveMessage(appLocale, "pages.signUp.passwordMinHint")
          : undefined
      }
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
          <AuthInlineLink href={API_REDIRECT_LOCATIONS.signIn}>
            {resolveMessage(appLocale, "pages.signUp.signInInstead")}
          </AuthInlineLink>
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
