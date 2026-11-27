import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/organisms/auth-shell";
import { RecoveryRequestForm } from "@/features/auth/components/organisms/recovery-request-form";
import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";

// Derive title and description from the locale selected for this request.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.recoveryRequest.metadataTitle",
    "pages.recoveryRequest.metadataDescription",
  );
}

export default function RecoveryRequestPage() {
  // Keep the logo's accessible name in the same locale as the shared auth shell.
  return (
    <AuthShell
      homeLabelKey="pages.recoveryRequest.homeAriaLabel"
    >
      <RecoveryRequestForm />
    </AuthShell>
  );
}
