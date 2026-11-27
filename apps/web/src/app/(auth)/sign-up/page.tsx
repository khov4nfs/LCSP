import type { Metadata } from "next";

import { SignUpPage as AuthSignUpPage } from "@/features/auth/components/organisms/sign-up-page";
import { getAuthPageMetadata } from "@/features/auth/utils/get-auth-page-metadata";

// Resolve metadata per request so parallel English and Vietnamese visits stay isolated.
export async function generateMetadata(): Promise<Metadata> {
  return getAuthPageMetadata(
    "pages.signUp.metadataTitle",
    "pages.signUp.metadataDescription",
  );
}

export default function SignUpPage() {
  return <AuthSignUpPage />;
}
