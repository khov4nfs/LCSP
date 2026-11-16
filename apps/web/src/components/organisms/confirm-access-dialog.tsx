"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { LockIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { ConfirmAccessSupportLinks } from "@/components/molecules/confirm-access-support-links";
import { SignedInAccountPanel } from "@/components/molecules/signed-in-account-panel";
import {
  confirmAccessOtpSchema,
  confirmAccessPasswordSchema,
  type ConfirmAccessOtpValues,
  type ConfirmAccessPasswordValues,
} from "@/components/schemas/confirm-access-dialog.schema";
import {
  CONFIRM_ACCESS_METHODS,
  CONFIRM_ACCESS_SUPPORT_ITEM_KINDS,
  type ConfirmAccessMethod,
  type ConfirmAccessDialogProps,
  type ConfirmAccessSupportItem,
} from "@/components/types/confirm-access-dialog.types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { appLocale } from "@/lib/locale";

export function ConfirmAccessDialog({
  open,
  onOpenChange,
  ...props
}: ConfirmAccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ConfirmAccessDialogContent
          onOpenChange={onOpenChange}
          {...props}
        />
      ) : null}
    </Dialog>
  );
}

function ConfirmAccessDialogContent({
  onOpenChange,
  onPasswordSubmit,
  accountLabelKey,
  accountHandle,
  avatarFallback,
  avatarImageSrc,
  titleKey,
  descriptionKey,
  passwordLabelKey,
  passwordDescriptionKey,
  passwordPlaceholderKey,
  forgotPasswordHref,
  forgotPasswordLabelKey,
  supportTitleKey,
  confirmLabelKey,
  confirmingLabelKey,
  closeLabelKey,
  errorTitleKey,
  errorKey,
  mfa,
  initialMethod = CONFIRM_ACCESS_METHODS.password,
}: Omit<ConfirmAccessDialogProps, "open">) {
  const [method, setMethod] = useState<ConfirmAccessMethod>(
    initialMethod,
  );
  const passwordForm = useForm<ConfirmAccessPasswordValues>({
    resolver: zodResolver(confirmAccessPasswordSchema),
    defaultValues: { password: "" },
  });
  const otpForm = useForm<ConfirmAccessOtpValues>({
    resolver: zodResolver(confirmAccessOtpSchema),
    defaultValues: { otp: "" },
  });

  async function handlePasswordSubmit(values: ConfirmAccessPasswordValues) {
    await onPasswordSubmit(values);
  }

  async function handleOtpSubmit(values: ConfirmAccessOtpValues) {
    await mfa?.onSubmit(values);
  }

  function handleSelectMfa() {
    if (!mfa) {
      return;
    }

    if (mfa.isEnabled && mfa.isConfigured) {
      otpForm.reset();
      setMethod(CONFIRM_ACCESS_METHODS.otp);
      return;
    }

    onOpenChange(false);
    if (mfa.onSetupRequest) {
      mfa.onSetupRequest();
    }
  }

  function handleSelectPassword() {
    passwordForm.reset();
    setMethod(CONFIRM_ACCESS_METHODS.password);
  }

  const supportItems: ConfirmAccessSupportItem[] = [];
  if (method === CONFIRM_ACCESS_METHODS.password) {
    if (mfa) {
      const mfaSupportItem =
        mfa.isEnabled || mfa.isConfigured || mfa.setupHref || mfa.onSetupRequest
          ? mfa.setupHref && !(mfa.isEnabled && mfa.isConfigured)
            ? {
                kind: CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.link,
                href: mfa.setupHref,
                labelKey: mfa.switchToMfaLabelKey,
              }
            : {
                kind: CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.action,
                labelKey: mfa.switchToMfaLabelKey,
                onSelect: handleSelectMfa,
              }
          : null;
      if (mfaSupportItem) {
        supportItems.push(mfaSupportItem);
      }
    }
  } else if (method === CONFIRM_ACCESS_METHODS.otp) {
    if (mfa?.githubMobileHref && mfa.githubMobileLabelKey) {
      supportItems.push({
        kind: CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.link,
        href: mfa.githubMobileHref,
        labelKey: mfa.githubMobileLabelKey,
      });
    }
    supportItems.push({
      kind: CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.action,
      labelKey: mfa?.switchToPasswordLabelKey ?? forgotPasswordLabelKey!,
      onSelect: handleSelectPassword,
    });
  }
  return (
    <DialogContent closeLabel={resolveMessage(appLocale, closeLabelKey)}>
        <DialogHeader>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <LockIcon className="size-5" />
          </div>
          <div className="space-y-1">
            <DialogTitle>{resolveMessage(appLocale, titleKey)}</DialogTitle>
            {descriptionKey ? (
              <DialogDescription>
                {resolveMessage(appLocale, descriptionKey)}
              </DialogDescription>
            ) : null}
          </div>
        </DialogHeader>

        <DialogBody>
          <SignedInAccountPanel
            accountLabelKey={accountLabelKey}
            accountHandle={accountHandle}
            avatarImageSrc={avatarImageSrc}
            avatarFallback={avatarFallback}
          />

          {method === CONFIRM_ACCESS_METHODS.password ? (
            <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} noValidate>
              <FieldGroup>
                <Field
                  data-invalid={
                    Boolean(passwordForm.formState.errors.password) || undefined
                  }
                >
                  <FieldLabel
                    htmlFor="confirm-access-password"
                    className="sr-only"
                  >
                    {resolveMessage(appLocale, passwordLabelKey)}
                  </FieldLabel>
                  <Input
                    id="confirm-access-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder={
                      passwordPlaceholderKey
                        ? resolveMessage(appLocale, passwordPlaceholderKey)
                        : undefined
                    }
                    {...passwordForm.register("password")}
                  />
                  {forgotPasswordHref && forgotPasswordLabelKey ? (
                    <div className="flex justify-end">
                      <Link
                        href={forgotPasswordHref}
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {resolveMessage(appLocale, forgotPasswordLabelKey)}
                      </Link>
                    </div>
                  ) : null}
                  {passwordForm.formState.errors.password?.message ? (
                    <FieldError>
                      {resolveMessage(
                        appLocale,
                        passwordForm.formState.errors.password.message as Parameters<
                          typeof resolveMessage
                        >[1],
                      )}
                    </FieldError>
                  ) : passwordDescriptionKey ? (
                    <FieldDescription>
                      {resolveMessage(appLocale, passwordDescriptionKey)}
                    </FieldDescription>
                  ) : null}
                </Field>

                {errorKey ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      {resolveMessage(appLocale, errorTitleKey ?? titleKey)}
                    </AlertTitle>
                    <AlertDescription>
                      {resolveMessage(appLocale, errorKey)}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={passwordForm.formState.isSubmitting}
                  aria-busy={passwordForm.formState.isSubmitting}
                >
                  {passwordForm.formState.isSubmitting ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {resolveMessage(
                    appLocale,
                    passwordForm.formState.isSubmitting
                      ? confirmingLabelKey
                      : confirmLabelKey,
                  )}
                </Button>
              </FieldGroup>
            </form>
          ) : null}

          {method === CONFIRM_ACCESS_METHODS.otp && mfa ? (
            <form onSubmit={otpForm.handleSubmit(handleOtpSubmit)} noValidate>
              <FieldGroup>
                <Field
                  data-invalid={Boolean(otpForm.formState.errors.otp) || undefined}
                >
                  <FieldLabel htmlFor="confirm-access-otp" className="sr-only">
                    {resolveMessage(appLocale, mfa.otpLabelKey)}
                  </FieldLabel>
                  <Input
                    id="confirm-access-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={
                      mfa.otpPlaceholderKey
                        ? resolveMessage(appLocale, mfa.otpPlaceholderKey)
                        : undefined
                    }
                    {...otpForm.register("otp")}
                  />
                  {otpForm.formState.errors.otp?.message ? (
                    <FieldError>
                      {resolveMessage(
                        appLocale,
                        otpForm.formState.errors.otp.message as Parameters<
                          typeof resolveMessage
                        >[1],
                      )}
                    </FieldError>
                  ) : mfa.otpDescriptionKey ? (
                    <FieldDescription>
                      {resolveMessage(appLocale, mfa.otpDescriptionKey)}
                    </FieldDescription>
                  ) : null}
                </Field>

                {mfa.errorKey ? (
                  <Alert variant="destructive">
                    <AlertTitle>
                      {resolveMessage(
                        appLocale,
                        mfa.errorTitleKey ?? titleKey,
                      )}
                    </AlertTitle>
                    <AlertDescription>
                      {resolveMessage(appLocale, mfa.errorKey)}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={otpForm.formState.isSubmitting}
                  aria-busy={otpForm.formState.isSubmitting}
                >
                  {otpForm.formState.isSubmitting ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {resolveMessage(
                    appLocale,
                    otpForm.formState.isSubmitting
                      ? mfa.verifyingLabelKey
                      : mfa.verifyLabelKey,
                  )}
                </Button>
              </FieldGroup>
            </form>
          ) : null}

          {supportTitleKey && supportItems.length > 0 ? (
            <ConfirmAccessSupportLinks
              titleKey={supportTitleKey}
              items={supportItems}
            />
          ) : null}
        </DialogBody>
      </DialogContent>
  );
}
