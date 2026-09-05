"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { resolveMessage } from "@lcsp/i18n";
import { KeyRoundIcon, MailIcon, RefreshCwIcon } from "lucide-react";

import { LabeledValueRow } from "@/components/molecules/labeled-value-row";
import { SectionHeading } from "@/components/molecules/section-heading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { appLocale } from "@/lib/locale";
import type { PasswordAuthenticationSectionProps } from "../../types/settings-page.types";

export function PasswordAuthenticationSettingsSection({
  profile,
  mfaToggleBusy,
  mfaEditorOpen,
  setMfaEditorOpen,
  mfaError,
  qrCode,
  onToggleMfa,
  onGenerateMfaSetup,
  enrollPending,
  verifyForm,
  onVerifyOtp,
  onSendRecoveryInstructions,
  recoveryRequestSent,
  requestRecoveryPending,
}: PasswordAuthenticationSectionProps) {
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.password.title",
        )}
        description={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.password.description",
        )}
        icon={<KeyRoundIcon className="size-4" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.password.signInMethodsTitle",
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-hidden rounded-xl border border-border/70 p-0">
          <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-9 items-center justify-center text-foreground">
                <MailIcon className="size-6" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.password.emailMethod",
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.password.emailMethodDescription",
                  )}
                </p>
              </div>
            </div>
            <Button
              render={<Link href="?section=account" />}
              nativeButton={false}
              type="button"
              variant="outline"
              size="sm"
            >
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.actions.manage",
              )}
            </Button>
          </div>

          <div className="px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex size-9 items-center justify-center text-foreground">
                  <KeyRoundIcon className="size-6" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.password.passwordMethod",
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.password.passwordMethodDescription",
                    )}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPasswordEditorOpen((current) => !current);
                }}
              >
                {resolveMessage(
                  appLocale,
                  passwordEditorOpen
                    ? "pages.workspace.settingsHub.actions.hide"
                    : "pages.workspace.settingsHub.actions.changePassword",
                )}
              </Button>
            </div>

            {passwordEditorOpen ? (
              <div className="mt-6 max-w-xl">
                <form className="flex flex-col gap-5" noValidate>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="current-password">
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.password.currentPasswordLabel",
                        )}
                      </FieldLabel>
                      <Input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-password">
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.password.newPasswordLabel",
                        )}
                      </FieldLabel>
                      <Input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="confirm-new-password">
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.password.confirmNewPasswordLabel",
                        )}
                      </FieldLabel>
                      <Input
                        id="confirm-new-password"
                        type="password"
                        autoComplete="new-password"
                      />
                    </Field>
                  </FieldGroup>
                  <p className="text-sm text-muted-foreground">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.password.passwordPolicyHint",
                    )}{" "}
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      href="/recovery/request"
                    >
                      {resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.password.learnMoreLink",
                      )}
                    </Link>
                    .
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline">
                      {resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.actions.updatePassword",
                      )}
                    </Button>
                    <Link
                      className="text-sm text-primary underline-offset-4 hover:underline"
                      href="/recovery/request"
                    >
                      {resolveMessage(appLocale, "pages.signIn.forgotPassword")}
                    </Link>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.password.mfaTitle",
              )}
            </CardTitle>
            <CardDescription>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.password.mfaDescription",
              )}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {resolveMessage(
              appLocale,
              profile?.mfa_enrolled
                ? "pages.workspace.settingsHub.badges.mfaEnabled"
                : "pages.workspace.settingsHub.badges.mfaPending",
            )}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <Field orientation="horizontal" className="items-center gap-3">
              <FieldContent>
                <FieldTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.password.authenticatorApp",
                  )}
                </FieldTitle>
                <FieldDescription>
                  {profile?.mfa_enrolled
                    ? resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.password.authenticatorConfigured",
                      )
                    : resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.password.authenticatorPending",
                      )}
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={profile?.mfa_enrolled === true}
                disabled={mfaToggleBusy}
                onCheckedChange={onToggleMfa}
                aria-label={resolveMessage(
                  appLocale,
                  profile?.mfa_enrolled
                    ? "pages.workspace.settingsHub.actions.turnOff"
                    : "pages.workspace.settingsHub.actions.turnOn",
                )}
              />
            </Field>
            <div className="flex items-center gap-3">
              {profile?.mfa_enrolled ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMfaEditorOpen((current) => !current);
                  }}
                >
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.actions.edit",
                  )}
                </Button>
              ) : null}
            </div>
          </div>

          {mfaEditorOpen ? (
            <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="font-medium">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.password.inlineSetupTitle",
                    )}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.password.inlineSetupDescription",
                    )}
                  </p>
                </div>
                {!qrCode ? (
                  <Button
                    type="button"
                    onClick={() => void onGenerateMfaSetup()}
                    disabled={enrollPending}
                  >
                    {enrollPending ? (
                      <RefreshCwIcon className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.actions.generateSetup",
                    )}
                  </Button>
                ) : null}
              </div>

              {mfaError ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    {resolveMessage(appLocale, mfaError.titleKey)}
                  </AlertTitle>
                  <AlertDescription>
                    {resolveMessage(appLocale, mfaError.detailKey)}
                  </AlertDescription>
                </Alert>
              ) : null}

              {qrCode ? (
                <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,320px)] lg:items-start">
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border bg-white p-3 shadow-sm">
                      <Image
                        src={qrCode}
                        alt={resolveMessage(appLocale, "pages.mfaEnroll.qrAlt")}
                        className="size-56 max-w-full sm:size-60"
                        width={240}
                        height={240}
                        unoptimized
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {resolveMessage(appLocale, "pages.mfaEnroll.qrHint")}
                    </p>
                  </div>
                  <div className="flex flex-col gap-4 pt-1">
                    <form
                      onSubmit={verifyForm.handleSubmit(onVerifyOtp)}
                      className="flex flex-col gap-4"
                      noValidate
                    >
                      <FieldGroup>
                        <Field
                          data-invalid={
                            Boolean(verifyForm.formState.errors.otp) ||
                            undefined
                          }
                        >
                          <FieldLabel htmlFor="otp">
                            {resolveMessage(
                              appLocale,
                              "pages.mfaVerify.otpLabel",
                            )}
                          </FieldLabel>
                          <Input
                            id="otp"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="XXXXXX"
                            disabled={verifyForm.formState.isSubmitting}
                            {...verifyForm.register("otp")}
                          />
                          {verifyForm.formState.errors.otp?.message ? (
                            <FieldError>
                              {resolveMessage(
                                appLocale,
                                verifyForm.formState.errors.otp
                                  .message as Parameters<
                                  typeof resolveMessage
                                >[1],
                              )}
                            </FieldError>
                          ) : (
                            <FieldDescription>
                              {resolveMessage(
                                appLocale,
                                "pages.mfaVerify.otpDescription",
                              )}
                            </FieldDescription>
                          )}
                        </Field>
                      </FieldGroup>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="submit"
                          disabled={verifyForm.formState.isSubmitting}
                        >
                          {resolveMessage(
                            appLocale,
                            verifyForm.formState.isSubmitting
                              ? "pages.mfaVerify.submitting"
                              : "pages.workspace.settingsHub.actions.verifyAndSave",
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            verifyForm.reset();
                            setMfaEditorOpen(false);
                          }}
                        >
                          {resolveMessage(
                            appLocale,
                            "pages.workspace.settingsHub.actions.cancel",
                          )}
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.password.recoveryTitle",
            )}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.password.recoveryDescription",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LabeledValueRow
            label={resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.recoveryEmail",
            )}
            value={
              profile?.recovery_email ??
              resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.states.noRecoveryEmail",
              )
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void onSendRecoveryInstructions()}
              disabled={requestRecoveryPending || !profile}
            >
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.actions.sendRecovery",
              )}
            </Button>
            <Button
              render={<Link href="/recovery/request" />}
              nativeButton={false}
              variant="ghost"
            >
              {resolveMessage(
                appLocale,
                "pages.workspace.security.openRecovery",
              )}
            </Button>
          </div>
          {recoveryRequestSent ? (
            <Alert>
              <AlertTitle>
                {resolveMessage(
                  appLocale,
                  "pages.recoveryRequest.successTitle",
                )}
              </AlertTitle>
              <AlertDescription>
                {resolveMessage(
                  appLocale,
                  "pages.recoveryRequest.successDetail",
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
