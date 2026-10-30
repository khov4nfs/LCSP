"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import {
  useMfaRecoveryCodeVerifyMutation,
  useMfaVerifyMutation,
} from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import type {
  MfaVerifyError,
  MfaVerifyOutcome,
} from "@/lib/api/types/mfa-verify.types";
import { appLocale } from "@/lib/locale";
import { resolvePostAuthRedirectPath } from "../../utils/post-auth-redirect";

import {
  MFA_VERIFY_METHODS,
  type MfaVerifyMethod,
} from "../../config/mfa-verify-methods";
import {
  mfaRecoveryCodeVerifySchema,
  mfaVerifySchema,
  type MfaRecoveryCodeVerifyFormValues,
  type MfaVerifyFormValues,
} from "../../schemas/mfa-verify.schema";
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

export function MfaVerifyForm({
  initialMethod = MFA_VERIFY_METHODS.otp,
}: {
  initialMethod?: MfaVerifyMethod;
}) {
  const router = useRouter();
  const mfaVerifyMutation = useMfaVerifyMutation();
  const recoveryCodeVerifyMutation = useMfaRecoveryCodeVerifyMutation();
  const [method, setMethod] = useState<MfaVerifyMethod>(initialMethod);
  const [error, setError] = useState<MfaVerifyError>();
  const [isLocked, setIsLocked] = useState(false);
  const form = useForm<MfaVerifyFormValues>({
    resolver: zodResolver(mfaVerifySchema),
    defaultValues: { otp: "" },
  });
  const recoveryCodeForm = useForm<MfaRecoveryCodeVerifyFormValues>({
    resolver: zodResolver(mfaRecoveryCodeVerifySchema),
    defaultValues: { code: "" },
  });
  const isRecoveryCode = method === MFA_VERIFY_METHODS.recoveryCode;
  const otpError = form.formState.errors.otp?.message;
  const recoveryCodeError = recoveryCodeForm.formState.errors.code?.message;
  const isSubmitting =
    form.formState.isSubmitting || recoveryCodeForm.formState.isSubmitting;

  async function onSubmit(values: MfaVerifyFormValues) {
    setError(undefined);
    const outcome = await mfaVerifyMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
    }));
    form.resetField("otp");

    await handleOutcome(outcome);
  }

  async function onRecoveryCodeSubmit(values: MfaRecoveryCodeVerifyFormValues) {
    setError(undefined);
    const outcome = await recoveryCodeVerifyMutation
      .mutateAsync(values)
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
        detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
      }));
    recoveryCodeForm.resetField("code");

    await handleOutcome(outcome);
  }

  async function handleOutcome(outcome: MfaVerifyOutcome) {
    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      try {
        router.replace(await resolvePostAuthRedirectPath());
      } catch {
        setError({
          titleKey: "pages.mfaVerify.errors.requestFailedTitle",
          detailKey: "pages.mfaVerify.errors.requestFailedDetail",
        });
      }
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      router.replace(API_REDIRECT_LOCATIONS.signIn);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.mfaRequired) {
      setError({
        titleKey: "auth.errors.mfaRequired.title",
        detailKey: "auth.errors.mfaRequired.detail",
      });
      return;
    }
    if (
      outcome.kind === API_OUTCOME_KINDS.invalid &&
      outcome.requiredAction === REQUIRED_ACTIONS.retryRecovery
    ) {
      setMethod(MFA_VERIFY_METHODS.recoveryCode);
      setError(outcome);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.mfaEnrollmentExpired) {
      setError(outcome);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.reauthRequired) {
      // Defensive edge fallback: retains pending session while displaying step-up alert.
      setError(outcome);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.rateLimited) {
      setIsLocked(true);
    }
    setError(outcome);
  }

  return (
    <AuthFormSurface
      className="pt-28 pb-16 sm:pt-32"
      data-figma-node={isRecoveryCode ? "926:31359" : "925:31355"}
    >
      <AuthHeading
        title={resolveMessage(
          appLocale,
          isRecoveryCode
            ? "pages.mfaVerify.recoveryCodeTitle"
            : "pages.mfaVerify.formTitle",
        )}
        description={resolveMessage(
          appLocale,
          isRecoveryCode
            ? "pages.mfaVerify.recoveryCodeDescription"
            : "pages.mfaVerify.formDescription",
        )}
      />
      {isRecoveryCode ? (
        <RecoveryCodeForm
          error={error}
          recoveryCodeError={recoveryCodeError}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          onSubmit={recoveryCodeForm.handleSubmit(onRecoveryCodeSubmit)}
          control={recoveryCodeForm.control}
          onSwitchMethod={() => {
            setError(undefined);
            setMethod(MFA_VERIFY_METHODS.otp);
          }}
        />
      ) : (
        <OtpForm
          error={error}
          otpError={otpError}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          control={form.control}
          onSubmit={form.handleSubmit(onSubmit)}
          onSwitchMethod={() => {
            setError(undefined);
            setMethod(MFA_VERIFY_METHODS.recoveryCode);
          }}
        />
      )}
    </AuthFormSurface>
  );
}

function OtpForm({
  error,
  otpError,
  isLocked,
  isSubmitting,
  control,
  onSubmit,
  onSwitchMethod,
}: {
  error?: MfaVerifyError;
  otpError?: string;
  isLocked: boolean;
  isSubmitting: boolean;
  control: Control<MfaVerifyFormValues>;
  onSubmit: () => void;
  onSwitchMethod: () => void;
}) {
  return (
    <>
      <form
        id="mfa-verify-form"
        onSubmit={onSubmit}
        noValidate
        className="mt-8 flex flex-col"
      >
        <FieldGroup className="gap-5">
          <Field
            data-invalid={Boolean(otpError) || undefined}
            data-disabled={isSubmitting || isLocked || undefined}
            className="items-center gap-3"
          >
            <FieldLabel
              htmlFor="otp"
              className="block w-full text-center text-xs font-semibold tracking-wide text-foreground uppercase"
            >
              {resolveMessage(appLocale, "pages.mfaVerify.otpLabel")}
            </FieldLabel>
            <Controller
              control={control}
              name="otp"
              render={({ field }) => (
                <InputOTP
                  id="otp"
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  autoComplete="one-time-code"
                  containerClassName="justify-center gap-2 sm:gap-2.5"
                  disabled={isSubmitting || isLocked}
                  aria-invalid={Boolean(otpError)}
                  {...field}
                >
                  <InputOTPGroup className="gap-2 rounded-none">
                    <AuthOtpSlot index={0} invalid={Boolean(otpError)} />
                    <AuthOtpSlot index={1} invalid={Boolean(otpError)} />
                    <AuthOtpSlot index={2} invalid={Boolean(otpError)} />
                  </InputOTPGroup>
                  <InputOTPSeparator className="text-muted-foreground [&_svg]:size-3" />
                  <InputOTPGroup className="gap-2 rounded-none">
                    <AuthOtpSlot index={3} invalid={Boolean(otpError)} />
                    <AuthOtpSlot index={4} invalid={Boolean(otpError)} />
                    <AuthOtpSlot index={5} invalid={Boolean(otpError)} />
                  </InputOTPGroup>
                </InputOTP>
              )}
            />
            {otpError ? (
              <FieldError className="text-center text-xs leading-normal">
                {resolveMessage(
                  appLocale,
                  otpError as Parameters<typeof resolveMessage>[1],
                )}
              </FieldError>
            ) : (
              <FieldDescription className="text-center text-xs leading-normal text-muted-foreground">
                {resolveMessage(appLocale, "pages.mfaVerify.otpDescription")}
              </FieldDescription>
            )}
          </Field>
          <MfaErrorAlert error={error} />
        </FieldGroup>
        <AuthPrimaryButton
          className="mt-6"
          type="submit"
          form="mfa-verify-form"
          disabled={isSubmitting || isLocked}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {resolveMessage(
            appLocale,
            isSubmitting
              ? "pages.mfaVerify.submitting"
              : "pages.mfaVerify.submit",
          )}
        </AuthPrimaryButton>
      </form>
      <AuthInlineLink
        href={API_REDIRECT_LOCATIONS.mfaRecoveryCode}
        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onSwitchMethod();
        }}
        className="mt-6 self-center"
      >
        {resolveMessage(appLocale, "pages.mfaVerify.moreOptions")}
      </AuthInlineLink>
      <AuthNote className="mt-6">
        {resolveMessage(appLocale, "pages.mfaVerify.accessHelp")}
      </AuthNote>
    </>
  );
}

function RecoveryCodeForm({
  error,
  recoveryCodeError,
  isLocked,
  isSubmitting,
  onSubmit,
  control,
  onSwitchMethod,
}: {
  error?: MfaVerifyError;
  recoveryCodeError?: string;
  isLocked: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  control: Control<MfaRecoveryCodeVerifyFormValues>;
  onSwitchMethod: () => void;
}) {
  return (
    <>
      <form
        id="mfa-recovery-code-verify-form"
        onSubmit={onSubmit}
        noValidate
        className="mt-8 flex flex-col"
      >
        <FieldGroup className="gap-4">
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <AuthTextField
                id="recovery-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="text"
                disabled={isSubmitting || isLocked}
                label={resolveMessage(
                  appLocale,
                  "pages.mfaVerify.recoveryCodeLabel",
                )}
                description={resolveMessage(
                  appLocale,
                  "pages.mfaVerify.recoveryCodeHelp",
                )}
                placeholder={resolveMessage(
                  appLocale,
                  "pages.mfaVerify.recoveryCodePlaceholder",
                )}
                error={
                  recoveryCodeError
                    ? resolveMessage(
                        appLocale,
                        recoveryCodeError as Parameters<
                          typeof resolveMessage
                        >[1],
                      )
                    : undefined
                }
                {...field}
                onChange={(event) =>
                  field.onChange(event.target.value.toUpperCase())
                }
              />
            )}
          />
          <MfaErrorAlert error={error} />
        </FieldGroup>
        <AuthPrimaryButton
          className="mt-6"
          type="submit"
          form="mfa-recovery-code-verify-form"
          disabled={isSubmitting || isLocked}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {resolveMessage(
            appLocale,
            isSubmitting
              ? "pages.mfaVerify.submitting"
              : "pages.mfaVerify.recoveryCodeSubmit",
          )}
        </AuthPrimaryButton>
      </form>
      <AuthInlineLink
        href={API_REDIRECT_LOCATIONS.mfaVerify}
        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onSwitchMethod();
        }}
        className="mt-6 self-center"
      >
        {resolveMessage(appLocale, "pages.mfaVerify.useAuthenticator")}
      </AuthInlineLink>
      <AuthNote className="mt-6 flex flex-col gap-1 text-center">
        <span>
          {resolveMessage(appLocale, "pages.mfaVerify.recoveryCodeAccessHelp")}
        </span>
        <span className="text-muted-foreground/80">
          {resolveMessage(appLocale, "pages.mfaVerify.lostBothFactorsHelp")}
        </span>
      </AuthNote>
    </>
  );
}

function AuthOtpSlot({ index, invalid }: { index: number; invalid: boolean }) {
  return (
    <InputOTPSlot
      index={index}
      aria-invalid={invalid}
      className="h-12 w-11 rounded-lg border border-border bg-muted text-base font-medium text-foreground first:rounded-lg first:border last:rounded-lg data-[active=true]:border-ring data-[active=true]:ring-2 data-[active=true]:ring-ring/20"
    />
  );
}

function MfaErrorAlert({ error }: { error?: MfaVerifyError }) {
  if (!error) {
    return null;
  }

  const isRestartEnrollment =
    error.requiredAction === REQUIRED_ACTIONS.restartEnrollment;

  return (
    <Alert variant="destructive">
      <AlertTitle>{resolveMessage(appLocale, error.titleKey)}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{resolveMessage(appLocale, error.detailKey)}</p>
        {isRestartEnrollment ? (
          <div className="pt-1">
            <Link
              href={API_REDIRECT_LOCATIONS.mfaEnroll}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {resolveMessage(appLocale, "pages.mfaVerify.restartEnrollment")}
            </Link>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
