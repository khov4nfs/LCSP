import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/organisms/auth-shell";
import { MfaEnrollForm } from "@/features/auth/components/organisms/mfa-enroll-form";
import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";

// Derive title and description from the locale selected for this request.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.mfaEnroll.metadataTitle",
    "pages.mfaEnroll.metadataDescription",
  );
}

export default function MfaEnrollPage() {
  // Keep the shared logo's accessible name resolved by the reactive shell locale.
  return (
    <AuthShell
      homeLabelKey="pages.mfaEnroll.homeAriaLabel"
    >
      <MfaEnrollForm />
    </AuthShell>
  );
}
