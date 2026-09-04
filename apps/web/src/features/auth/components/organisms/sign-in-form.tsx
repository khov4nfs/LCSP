"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { appLocale } from "@/lib/locale";
import { useSignInMutation } from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import googleIcon from "@/public/assets/icons/google.svg";

import { signInFields } from "../../config/sign-in-fields";
import {
  signInSchema,
  type SignInFormValues,
} from "../../schemas/sign-in.schema";
import {
  AuthDivider,
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthSecondaryButton,
} from "../molecules/auth-form-primitives";
import { CredentialField } from "../molecules/credential-field";

type SignInErrorOutcome = {
  kind: typeof API_OUTCOME_KINDS.error;
  titleKey: MessageKey;
  detailKey: MessageKey;
  lockedUntil?: string;
  retryAfterSeconds?: number;
};

export function SignInForm() {
  const router = useRouter();
  const signInMutation = useSignInMutation();
  const [signInError, setSignInError] = useState<SignInErrorOutcome | null>(
    null,
  );
  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignInFormValues) {
    setSignInError(null);
    const outcome = await signInMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.signIn.errors.requestFailedTitle" as const,
      detailKey: "pages.signIn.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.authenticated) {
      router.replace("/workspace");
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.workspaceSelectionRequired) {
      router.replace("/workspace/select");
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.mfaRequired) {
      router.replace(API_REDIRECT_LOCATIONS.mfaVerify);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.mfaEnrollmentRequired) {
      router.replace(API_REDIRECT_LOCATIONS.mfaEnroll);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.error) {
      setSignInError(outcome);
    }
  }

  return (
    <AuthFormSurface className="pt-[132px]" data-figma-node="924:31258">
      <AuthHeading
        title={resolveMessage(appLocale, "pages.signIn.formTitle")}
        description={resolveMessage(appLocale, "pages.signIn.formDescription")}
      />
      <FormProvider {...form}>
        <div className="mt-[34px] flex flex-col gap-[22px]">
          <OAuthButton provider="google" icon={<GoogleIcon />}>
            {resolveMessage(appLocale, "pages.signIn.oauthGoogle")}
          </OAuthButton>
          <AuthDivider
            label={resolveMessage(appLocale, "pages.signIn.divider")}
          />
          <form
            id="sign-in-form"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col"
          >
            <FieldGroup className="gap-[18px]">
              {signInFields.map((field) => (
                <CredentialField key={field.name} field={field} />
              ))}
              {signInError ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    {resolveMessage(appLocale, signInError.titleKey)}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{resolveMessage(appLocale, signInError.detailKey)}</p>
                    {signInError.lockedUntil ? (
                      <p>
                        {resolveMessage(
                          appLocale,
                          "pages.signIn.errors.retryAtLabel",
                        )}{" "}
                        {formatRetryTime(signInError.lockedUntil)}
                      </p>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <AuthInlineLink
              href={API_REDIRECT_LOCATIONS.recoveryRequest}
              className="mt-[14px] self-end"
            >
              {resolveMessage(appLocale, "pages.signIn.forgotPassword")}
            </AuthInlineLink>
            <AuthPrimaryButton
              className="mt-5"
              type="submit"
              form="sign-in-form"
              disabled={form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {form.formState.isSubmitting
                ? resolveMessage(appLocale, "pages.signIn.submitting")
                : resolveMessage(appLocale, "pages.signIn.submit")}
            </AuthPrimaryButton>
          </form>
          <AuthNote className="-mt-0.5">
            {resolveMessage(appLocale, "pages.signIn.accessHelp")}
          </AuthNote>
          <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">
            {resolveMessage(appLocale, "pages.signIn.newToLcsp")}{" "}
            <AuthInlineLink href={API_REDIRECT_LOCATIONS.signUp}>
              {resolveMessage(appLocale, "pages.signIn.createAccount")}
            </AuthInlineLink>
          </p>
        </div>
      </FormProvider>
    </AuthFormSurface>
  );
}

function formatRetryTime(lockedUntil: string): string {
  const date = new Date(lockedUntil);
  if (Number.isNaN(date.getTime())) {
    return lockedUntil;
  }

  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function OAuthButton({
  provider,
  icon,
  children,
}: {
  provider: "google";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthSecondaryButton
      nativeButton={false}
      render={<a href={`/api/auth/oauth/start?provider=${provider}`} />}
    >
      {icon}
      {children}
    </AuthSecondaryButton>
  );
}

function GoogleIcon() {
  return (
    <Image src={googleIcon} alt="" className="size-4" aria-hidden="true" />
  );
}
