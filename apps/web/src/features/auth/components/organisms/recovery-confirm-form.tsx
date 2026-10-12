"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { appLocale } from "@/lib/locale";
import { useConfirmRecoveryMutation } from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";

import {
  recoveryConfirmSchema,
  type RecoveryConfirmFormValues,
} from "../../schemas/recovery-confirm.schema";
import type { RecoveryConfirmFormProps } from "../../types/recovery-confirm.types";
import {
  AuthFormSurface,
  AuthHeading,
  AuthInlineLink,
  AuthNote,
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

export function RecoveryConfirmForm({ token }: RecoveryConfirmFormProps) {
  const router = useRouter();
  const confirmMutation = useConfirmRecoveryMutation();
  const form = useForm<RecoveryConfirmFormValues>({
    resolver: zodResolver(recoveryConfirmSchema),
    defaultValues: { token, new_password: "" },
  });

  async function onSubmit(values: RecoveryConfirmFormValues) {
    const outcome = await confirmMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.recoveryConfirm.errors.requestFailedTitle" as const,
      detailKey: "pages.recoveryConfirm.errors.requestFailedDetail" as const,
    }));

    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      router.replace(`${API_REDIRECT_LOCATIONS.signIn}?recovered=1`);
      return;
    }

    if (outcome.kind === API_OUTCOME_KINDS.invalid) {
      form.setError("token", {
        message: "auth.errors.recoveryInvalid.detail",
      });
      return;
    }

    form.setError("root", { message: outcome.detailKey });
  }

  const tokenError = form.formState.errors.token?.message;
  const passwordError = form.formState.errors.new_password?.message;
  const rootError = form.formState.errors.root?.message;

  return (
    <AuthFormSurface className="pt-[168px]" data-figma-node="925:31334">
      <AuthHeading
        title={resolveMessage(appLocale, "pages.recoveryConfirm.formTitle")}
        description={resolveMessage(
          appLocale,
          "pages.recoveryConfirm.formDescription",
        )}
      />
      <FormProvider {...form}>
        <form
          id="recovery-confirm-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-[38px] flex flex-col"
        >
          <input
            type="hidden"
            autoComplete="one-time-code"
            {...form.register("token")}
          />
          <FieldGroup className="gap-[18px]">
            <AuthTextField
              id="new_password"
              type="password"
              autoComplete="new-password"
              disabled={form.formState.isSubmitting}
              label={resolveMessage(
                appLocale,
                "pages.recoveryConfirm.passwordLabel",
              )}
              description={resolveMessage(
                appLocale,
                "pages.recoveryConfirm.passwordDescription",
              )}
              trailing={resolveMessage(
                appLocale,
                "pages.recoveryConfirm.passwordMinHint",
              )}
              error={
                passwordError
                  ? resolveMessage(
                      appLocale,
                      passwordError as Parameters<typeof resolveMessage>[1],
                    )
                  : undefined
              }
              {...form.register("new_password")}
            />
            {tokenError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.recoveryConfirm.errors.requestFailedTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    appLocale,
                    tokenError as Parameters<typeof resolveMessage>[1],
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {rootError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.recoveryConfirm.errors.requestFailedTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    appLocale,
                    rootError as Parameters<typeof resolveMessage>[1],
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-6"
            type="submit"
            form="recovery-confirm-form"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {resolveMessage(
              appLocale,
              form.formState.isSubmitting
                ? "pages.recoveryConfirm.submitting"
                : "pages.recoveryConfirm.submit",
            )}
          </AuthPrimaryButton>
        </form>
        <AuthInlineLink
          href={API_REDIRECT_LOCATIONS.recoveryRequest}
          className="mt-[22px] self-start"
        >
          {resolveMessage(appLocale, "pages.recoveryConfirm.requestAnother")}
        </AuthInlineLink>
        <AuthNote className="mt-[34px]">
          {resolveMessage(appLocale, "pages.recoveryConfirm.accessHelp")}
        </AuthNote>
      </FormProvider>
    </AuthFormSurface>
  );
}
