import type { Metadata } from "next";

import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";
import { SignInPage as AuthSignInPage } from "@/features/auth/components/organisms/sign-in-page";

// Resolve document metadata from the same request locale forwarded to the auth shell.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.signIn.metadataTitle",
    "pages.signIn.metadataDescription",
  );
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const { oauth } = await searchParams;

  // Render a generic localized notice only for the known callback failure marker; never surface callback details.
  return <AuthSignInPage oauthFailure={oauth === "failed"} />;
}
