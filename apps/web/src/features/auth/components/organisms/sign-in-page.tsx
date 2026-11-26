import { AuthShell } from "./auth-shell";
import { SignInForm } from "./sign-in-form";
import type { SignInPageProps } from "../../types/sign-in.types";

export function SignInPage({ oauthFailure = false }: SignInPageProps) {
  // Pass a message key so AuthShell can update its accessible home name when the user switches locales.
  return (
    <AuthShell
      homeLabelKey="pages.signIn.homeAriaLabel"
    >
      <SignInForm oauthFailure={oauthFailure} />
    </AuthShell>
  );
}
