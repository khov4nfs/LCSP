"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const isRecoveryCode = initialMethod === MFA_VERIFY_METHODS.recoveryCode;
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

    handleOutcome(outcome);
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

    handleOutcome(outcome);
  }

  function handleOutcome(outcome: MfaVerifyOutcome) {
    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      router.replace("/workspace");
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      router.replace(API_REDIRECT_LOCATIONS.signIn);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.mfaRequired) {
      router.replace(API_REDIRECT_LOCATIONS.mfaEnroll);
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.rateLimited) {
      setIsLocked(true);
    }
    setError(outcome);
  }

  return (
    <AuthFormSurface
      className="pt-[168px]"
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
        />
      ) : (
        <OtpForm
          error={error}
          otpError={otpError}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          control={form.control}
          onSubmit={form.handleSubmit(onSubmit)}
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
}: {
  error?: MfaVerifyError;
  otpError?: string;
  isLocked: boolean;
  isSubmitting: boolean;
  control: Control<MfaVerifyFormValues>;
  onSubmit: () => void;
}) {
  return (
    <>
      <form
        id="mfa-verify-form"
        onSubmit={onSubmit}
        noValidate
        className="mt-[38px] flex flex-col"
      >
        <FieldGroup className="gap-[18px]">
          <Field
            data-invalid={Boolean(otpError) || undefined}
            data-disabled={isSubmitting || isLocked || undefined}
            className="gap-2"
          >
            <FieldLabel
              htmlFor="otp"
              className="text-xs font-medium text-foreground"
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
                  containerClassName="justify-start gap-[14px]"
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
              <FieldError className="text-[11px] leading-normal">
                {resolveMessage(
                  appLocale,
                  otpError as Parameters<typeof resolveMessage>[1],
                )}
              </FieldError>
            ) : (
              <FieldDescription className="text-[11px] leading-normal text-muted-foreground">
                {resolveMessage(appLocale, "pages.mfaVerify.otpDescription")}
              </FieldDescription>
            )}
          </Field>
          <MfaErrorAlert error={error} />
        </FieldGroup>
        <AuthPrimaryButton
          className="mt-[30px]"
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
        className="mt-[40px] self-center"
      >
        {resolveMessage(appLocale, "pages.mfaVerify.moreOptions")}
      </AuthInlineLink>
      <AuthNote className="mt-[34px]">
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
}: {
  error?: MfaVerifyError;
  recoveryCodeError?: string;
  isLocked: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  control: Control<MfaRecoveryCodeVerifyFormValues>;
}) {
  return (
    <>
      <form
        id="mfa-recovery-code-verify-form"
        onSubmit={onSubmit}
        noValidate
        className="mt-[38px] flex flex-col"
      >
        <FieldGroup className="gap-[18px]">
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
        className="mt-[22px] self-start"
      >
        {resolveMessage(appLocale, "pages.mfaVerify.useAuthenticator")}
      </AuthInlineLink>
      <AuthNote className="mt-[34px]">
        {resolveMessage(appLocale, "pages.mfaVerify.recoveryCodeAccessHelp")}
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

  return (
    <Alert variant="destructive">
      <AlertTitle>{resolveMessage(appLocale, error.titleKey)}</AlertTitle>
      <AlertDescription>
        {resolveMessage(appLocale, error.detailKey)}
      </AlertDescription>
    </Alert>
  );
}
