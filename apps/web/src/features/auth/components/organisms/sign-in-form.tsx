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
import { useAppLocale } from "@/components/providers/locale-provider";
import { resolvePostAuthRedirectPath } from "../../utils/post-auth-redirect";
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
import type { SignInPageProps } from "../../types/sign-in.types";

type SignInErrorOutcome = {
  kind: typeof API_OUTCOME_KINDS.error;
  titleKey: MessageKey;
  detailKey: MessageKey;
  lockedUntil?: string;
  retryAfterSeconds?: number;
};

export function SignInForm({ oauthFailure = false }: SignInPageProps) {
  // Subscribe to locale changes without remounting so entered credentials and API feedback stay intact.
  const locale = useAppLocale();
  const router = useRouter();
  const signInMutation = useSignInMutation();
  const [signInError, setSignInError] = useState<SignInErrorOutcome | null>(
    null,
  );
  // Keep callback failure feedback visible until a credential retry starts, without exposing provider/session details.
  const [showOAuthFailure, setShowOAuthFailure] = useState(oauthFailure);
  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignInFormValues) {
    setSignInError(null);
    setShowOAuthFailure(false);
    const outcome = await signInMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.signIn.errors.requestFailedTitle" as const,
      detailKey: "pages.signIn.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.authenticated) {
      try {
        router.replace(await resolvePostAuthRedirectPath(outcome.role));
      } catch {
        setSignInError({
          kind: API_OUTCOME_KINDS.error,
          titleKey: "pages.signIn.errors.requestFailedTitle",
          detailKey: "pages.signIn.errors.requestFailedDetail",
        });
      }
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

  const oauthFailureError: SignInErrorOutcome | null = showOAuthFailure
    ? {
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.signIn.errors.oauthFailedTitle",
        detailKey: "pages.signIn.errors.oauthFailedDetail",
      }
    : null;
  const visibleError = signInError ?? oauthFailureError;

  // AuthShell owns page-level placement; this form grows with its feedback and remains usable in narrow columns.
  return (
    <AuthFormSurface className="w-full" data-figma-node="1662:1078">
      <AuthHeading
        title={resolveMessage(locale, "pages.signIn.formTitle")}
        description={resolveMessage(locale, "pages.signIn.formDescription")}
      />
      <FormProvider {...form}>
        <div className="mt-8.5 flex flex-col gap-4">
          <OAuthButton provider="google" icon={<GoogleIcon />}>
            {resolveMessage(locale, "pages.signIn.oauthGoogle")}
          </OAuthButton>
          <AuthDivider
            label={resolveMessage(locale, "pages.signIn.divider")}
          />
          <form
            id="sign-in-form"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col"
          >
            {/* The audited field cadence is 87px label-to-label once helper copy is screen-reader-only. */}
            <FieldGroup className="gap-6.5">
              {signInFields.map((field) => (
                <CredentialField key={field.name} field={field} />
              ))}
            </FieldGroup>
            {visibleError ? (
              <Alert className="mt-5 rounded-md border-transparent bg-[#FEF2F2] px-3 py-4 text-[#B91C1C]" variant="destructive">
                {visibleError.titleKey === "auth.errors.invalidCredentials.title" ? (
                  <AlertDescription className="text-xs leading-4 text-[#B91C1C]">
                    {resolveMessage(locale, "pages.signIn.errors.invalidCredentialsMessage")}
                  </AlertDescription>
                ) : (
                  <>
                    <AlertTitle className="text-xs">
                      {resolveMessage(locale, visibleError.titleKey)}
                    </AlertTitle>
                    <AlertDescription className="text-xs leading-4 text-[#B91C1C]">
                      <p>{resolveMessage(locale, visibleError.detailKey)}</p>
                      {visibleError.lockedUntil ? (
                        <p>
                          {resolveMessage(locale, "pages.signIn.errors.retryAtLabel")}{" "}
                          {formatRetryTime(visibleError.lockedUntil, locale)}
                        </p>
                      ) : null}
                    </AlertDescription>
                  </>
                )}
              </Alert>
            ) : null}
            <AuthPrimaryButton
              className={visibleError ? "mt-5" : "mt-7"}
              type="submit"
              form="sign-in-form"
              disabled={form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {form.formState.isSubmitting
                ? resolveMessage(locale, "pages.signIn.submitting")
                : resolveMessage(locale, "pages.signIn.submit")}
            </AuthPrimaryButton>
            <AuthNote className="sr-only">
              {resolveMessage(locale, "pages.signIn.accessHelp")}
            </AuthNote>
          </form>
          <div className="mt-2 flex justify-end">
            <AuthInlineLink href={API_REDIRECT_LOCATIONS.recoveryRequest}>
              {resolveMessage(locale, "pages.signIn.forgotPassword")}
            </AuthInlineLink>
          </div>
          <p className="mt-2 text-left text-xs leading-4 text-muted-foreground">
            {resolveMessage(locale, "pages.signIn.newToLcsp")}{" "}
            <AuthInlineLink href={API_REDIRECT_LOCATIONS.signUp}>
              {resolveMessage(locale, "pages.signIn.createAccount")}
            </AuthInlineLink>
          </p>
        </div>
      </FormProvider>
    </AuthFormSurface>
  );
}

// Use the active locale explicitly so lockout feedback does not depend on a stale module snapshot.
function formatRetryTime(lockedUntil: string, locale: "en" | "vi"): string {
  const date = new Date(lockedUntil);
  if (Number.isNaN(date.getTime())) {
    return lockedUntil;
  }

  return new Intl.DateTimeFormat(locale, {
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
