import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { SignUpPage as AuthSignUpPage } from "@/features/auth/components/organisms/sign-up-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.signUp.metadataTitle"),
  description: resolveMessage(appLocale, "pages.signUp.metadataDescription"),
};

export default function SignUpPage() {
  return <AuthSignUpPage />;
}
