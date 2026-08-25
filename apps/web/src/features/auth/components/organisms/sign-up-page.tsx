import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { AuthShell } from "./auth-shell";
import { SignUpForm } from "./sign-up-form";

export function SignUpPage() {
  return (
    <AuthShell
      homeLabel={resolveMessage(appLocale, "pages.signUp.homeAriaLabel")}
    >
      <SignUpForm />
    </AuthShell>
  );
}
