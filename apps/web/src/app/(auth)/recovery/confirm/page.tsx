import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/components/organisms/auth-shell";
import { RecoveryConfirmForm } from "@/features/auth/components/organisms/recovery-confirm-form";
import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";

// Derive title and description from the locale selected for this request.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.recoveryConfirm.metadataTitle",
    "pages.recoveryConfirm.metadataDescription",
  );
}

export default async function RecoveryConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  // Pass a message key so the client shell can resolve its accessible name after a locale switch.
  return (
    <AuthShell
      homeLabelKey="pages.recoveryConfirm.homeAriaLabel"
    >
      <RecoveryConfirmForm token={params.token ?? ""} />
    </AuthShell>
  );
}
