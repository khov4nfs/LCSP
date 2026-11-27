"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { resolveMessage } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { useAppLocale } from "@/components/providers/locale-provider";
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
  AuthPrimaryButton,
  AuthTextField,
} from "../molecules/auth-form-primitives";

export function RecoveryConfirmForm({ token }: RecoveryConfirmFormProps) {
  // Read locale changes reactively while retaining the recovery token and entered password.
  const locale = useAppLocale();
  const router = useRouter();
  const confirmMutation = useConfirmRecoveryMutation();
  const form = useForm<RecoveryConfirmFormValues>({
    resolver: zodResolver(recoveryConfirmSchema),
    defaultValues: { token, new_password: "", confirm_new_password: "" },
  });

  /**
   * Business purpose: Complete password recovery only after the user's new password has been confirmed locally.
   * Business rules:
   * - The existing recovery token and 12-character password policy remain authoritative.
   * - The confirmation value is UI-only and must never be sent in the established recovery API payload.
   * Execution flow:
   * 1. Send only token and new_password through the existing mutation.
   * 2. Route verified outcomes to sign-in and display the existing safe errors for rejected outcomes.
   * Failure cases:
   * - Zod blocks missing or mismatched confirmation before this handler runs; invalid or expired tokens retain the existing error outcome.
   * Side effects:
   * - Calls the existing password recovery endpoint and may navigate to sign-in after verified completion.
   */
  async function onSubmit({ token, new_password }: RecoveryConfirmFormValues) {
    const outcome = await confirmMutation
      .mutateAsync({ token, new_password })
      .catch(() => ({
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
  const confirmationError = form.formState.errors.confirm_new_password?.message;
  const rootError = form.formState.errors.root?.message;

  // AuthShell owns page placement; validation feedback and long copy determine the surface height.
  return (
    <AuthFormSurface className="w-full" data-figma-node="1662:1206">
      <AuthHeading
        title={resolveMessage(locale, "pages.recoveryConfirm.formTitle")}
        description={resolveMessage(
          locale,
          "pages.recoveryConfirm.formDescription",
        )}
        titleClassName="text-4xl leading-10"
      />
      <FormProvider {...form}>
        {/* Match the two-row Figma form start while keeping the opaque recovery token out of visible UI. */}
        <form
          id="recovery-confirm-form"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="mt-10.5 flex flex-col"
        >
          <input
            type="hidden"
            autoComplete="one-time-code"
            {...form.register("token")}
          />
          <FieldGroup className="gap-6.5">
            <AuthTextField
              id="new_password"
              type="password"
              autoComplete="new-password"
              disabled={form.formState.isSubmitting}
              label={resolveMessage(
                locale,
                "pages.recoveryConfirm.passwordLabel",
              )}
              placeholder={resolveMessage(
                locale,
                "pages.recoveryConfirm.passwordPlaceholder",
              )}
              description={resolveMessage(
                locale,
                "pages.recoveryConfirm.passwordDescription",
              )}
              descriptionClassName="sr-only"
              trailing={resolveMessage(
                locale,
                "pages.recoveryConfirm.passwordMinHint",
              )}
              error={
                passwordError
                  ? resolveMessage(
                      locale,
                      passwordError as Parameters<typeof resolveMessage>[1],
                    )
                  : undefined
              }
              {...form.register("new_password")}
            />
            <AuthTextField
              id="confirm_new_password"
              type="password"
              autoComplete="new-password"
              disabled={form.formState.isSubmitting}
              label={resolveMessage(
                locale,
                "pages.recoveryConfirm.confirmPasswordLabel",
              )}
              placeholder={resolveMessage(
                locale,
                "pages.recoveryConfirm.confirmPasswordPlaceholder",
              )}
              description={resolveMessage(
                locale,
                "pages.recoveryConfirm.confirmPasswordDescription",
              )}
              descriptionClassName="sr-only"
              error={
                confirmationError
                  ? resolveMessage(
                      locale,
                      confirmationError as Parameters<typeof resolveMessage>[1],
                    )
                  : undefined
              }
              {...form.register("confirm_new_password")}
            />
            {tokenError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(
                    locale,
                    "pages.recoveryConfirm.errors.requestFailedTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    locale,
                    tokenError as Parameters<typeof resolveMessage>[1],
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {rootError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {resolveMessage(
                    locale,
                    "pages.recoveryConfirm.errors.requestFailedTitle",
                  )}
                </AlertTitle>
                <AlertDescription>
                  {resolveMessage(
                    locale,
                    rootError as Parameters<typeof resolveMessage>[1],
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <AuthPrimaryButton
            className="mt-7"
            type="submit"
            form="recovery-confirm-form"
            disabled={form.formState.isSubmitting}
            aria-busy={form.formState.isSubmitting}
          >
            {resolveMessage(
              locale,
              form.formState.isSubmitting
                ? "pages.recoveryConfirm.submitting"
                : "pages.recoveryConfirm.submit",
            )}
          </AuthPrimaryButton>
        </form>
        {/* Backend recovery completion revokes active sessions, so this callout states the verified account effect. */}
        <section
          aria-labelledby="recovery-password-requirements"
          className="mt-5 rounded-xl bg-muted p-3 text-left"
        >
          <h2 id="recovery-password-requirements" className="text-xs font-medium text-foreground">
            {resolveMessage(locale, "pages.recoveryConfirm.passwordRequirementsTitle")}
          </h2>
          <p className="mt-2 text-xs leading-4 text-muted-foreground">
            {resolveMessage(locale, "pages.recoveryConfirm.accessHelp")}
          </p>
        </section>
        <AuthInlineLink
          href={API_REDIRECT_LOCATIONS.recoveryRequest}
          className="mt-6 self-start"
        >
          {resolveMessage(locale, "pages.recoveryConfirm.requestAnother")}
        </AuthInlineLink>
      </FormProvider>
    </AuthFormSurface>
  );
}
