"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resolveAppMessage as t } from "@/lib/i18n";
import { useAcceptAccountInvitation } from "@/lib/api/account-invitation-queries";
import {
  invitationAcceptSchema,
  type InvitationAcceptValues,
} from "../../schemas/invitation-accept.schema";
import {
  AuthFormSurface,
  AuthHeading,
  AuthTextField,
  AuthPrimaryButton,
  AuthInlineLink,
} from "../molecules/auth-form-primitives";
export function InvitationAcceptForm({ token }: { token: string }) {
  const accept = useAcceptAccountInvitation();
  const form = useForm<InvitationAcceptValues>({
    resolver: zodResolver(invitationAcceptSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  async function submit(input: InvitationAcceptValues) {
    try {
      await accept.mutateAsync({ token, password: input.password });
      form.reset();
    } catch {
      /* safe localized failure below */
    }
  }
  return (
    <AuthFormSurface className="pt-20">
      <AuthHeading
        title={t("pages.accountLifecycle.acceptTitle")}
        description={t("pages.accountLifecycle.acceptDescription")}
      />
      {accept.isSuccess ? (
        <div className="space-y-4" role="status">
          <p>{t("pages.accountLifecycle.accepted")}</p>
          <AuthInlineLink href="/sign-in">
            {t("pages.accountLifecycle.signIn")}
          </AuthInlineLink>
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit(submit)}
          className="mt-6 space-y-4"
          noValidate
        >
          <AuthTextField
            id="invitation-password"
            type="password"
            autoComplete="new-password"
            disabled={accept.isPending}
            label={t("pages.accountLifecycle.password")}
            description={t("pages.accountLifecycle.passwordRule")}
            error={
              form.formState.errors.password
                ? t("pages.accountLifecycle.passwordRule")
                : undefined
            }
            {...form.register("password")}
          />
          <AuthTextField
            id="invitation-confirm-password"
            type="password"
            autoComplete="new-password"
            disabled={accept.isPending}
            label={t("pages.accountLifecycle.confirmPassword")}
            description={t("pages.accountLifecycle.passwordRule")}
            error={
              form.formState.errors.confirmPassword
                ? t("pages.accountLifecycle.passwordMismatch")
                : undefined
            }
            {...form.register("confirmPassword")}
          />
          {accept.error && (
            <p role="alert" className="text-destructive">
              {t("pages.accountLifecycle.invalidInvitation")}
            </p>
          )}
          <AuthPrimaryButton type="submit" disabled={accept.isPending}>
            {t(
              accept.isPending
                ? "pages.accountLifecycle.accepting"
                : "pages.accountLifecycle.accept",
            )}
          </AuthPrimaryButton>
        </form>
      )}
    </AuthFormSurface>
  );
}
