import { AuthShell } from "./auth-shell";
import { SignUpForm } from "./sign-up-form";

export function SignUpPage() {
  // Pass a message key so AuthShell can update its accessible home name when the user switches locales.
  return (
    <AuthShell
      homeLabelKey="pages.signUp.homeAriaLabel"
    >
      <SignUpForm />
    </AuthShell>
  );
}
