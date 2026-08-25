"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LabeledSeparator } from "@/components/molecules/labeled-separator";
import { FormCard } from "@/components/organisms/form-card";
import { Spinner } from "@/components/ui/spinner";
import { useSignInMutation } from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import googleIcon from "@/public/assets/icons/google.svg";

import { signInFields } from "../../config/sign-in-fields";
import { appLocale } from "@/lib/locale";
import { signInSchema } from "../../schemas/sign-in.schema";
import type { SignInFormValues } from "../../schemas/sign-in.schema";
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
    <FormProvider {...form}>
      <FormCard
        title={resolveMessage(appLocale, "pages.signIn.formTitle")}
        description={resolveMessage(appLocale, "pages.signIn.formDescription")}
        footer={
          <>
            <Button
              className="w-full"
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
            </Button>
            <LabeledSeparator
              label={resolveMessage(appLocale, "pages.signIn.divider")}
            />
            <div>
              <OAuthButton provider="google" icon={<GoogleIcon />}>
                {resolveMessage(appLocale, "pages.signIn.oauthGoogle")}
              </OAuthButton>
            </div>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              {resolveMessage(appLocale, "pages.signIn.accessHelp")}
            </p>
            <p className="text-center text-xs">
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={API_REDIRECT_LOCATIONS.signUp}
              >
                {resolveMessage(appLocale, "pages.signIn.createAccount")}
              </Link>
            </p>
            <p className="text-center text-xs">
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={API_REDIRECT_LOCATIONS.recoveryRequest}
              >
                {resolveMessage(appLocale, "pages.signIn.forgotPassword")}
              </Link>
            </p>
          </>
        }
      >
        <form
          id="sign-in-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <FieldGroup>
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
        </form>
      </FormCard>
    </FormProvider>
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
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      className="w-full"
      variant="outline"
      nativeButton={false}
      render={<a href={`/api/auth/oauth/start?provider=${provider}`} />}
    >
      {icon}
      {children}
    </Button>
  );
}

function GoogleIcon() {
  return (
    <Image src={googleIcon} alt="" className="size-4" aria-hidden="true" />
  );
}
