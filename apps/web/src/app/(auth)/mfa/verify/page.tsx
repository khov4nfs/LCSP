import { resolveMessage } from "@lcsp/i18n";
import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/organisms/auth-shell";
import { MfaVerifyForm } from "@/features/auth/components/organisms/mfa-verify-form";
import { MFA_VERIFY_METHODS } from "@/features/auth/config/mfa-verify-methods";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.mfaVerify.metadataTitle"),
  description: resolveMessage(appLocale, "pages.mfaVerify.metadataDescription"),
};

export default async function MfaVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string }>;
}) {
  const params = await searchParams;
  const initialMethod =
    params.method === "recovery-code"
      ? MFA_VERIFY_METHODS.recoveryCode
      : MFA_VERIFY_METHODS.otp;

  return (
    <AuthShell
      homeLabel={resolveMessage(appLocale, "pages.mfaVerify.homeAriaLabel")}
    >
      <MfaVerifyForm initialMethod={initialMethod} />
    </AuthShell>
  );
}
