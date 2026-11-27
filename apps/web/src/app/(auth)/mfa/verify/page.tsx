import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/organisms/auth-shell";
import { MfaVerifyForm } from "@/features/auth/components/organisms/mfa-verify-form";
import { MFA_VERIFY_METHODS } from "@/features/auth/config/mfa-verify-methods";
import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";

// Keep the page title and description aligned with the current request locale.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.mfaVerify.metadataTitle",
    "pages.mfaVerify.metadataDescription",
  );
}

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

  // Pass a message key so the client shell can resolve its accessible name after a locale switch.
  return (
    <AuthShell
      homeLabelKey="pages.mfaVerify.homeAriaLabel"
    >
      <MfaVerifyForm initialMethod={initialMethod} />
    </AuthShell>
  );
}
