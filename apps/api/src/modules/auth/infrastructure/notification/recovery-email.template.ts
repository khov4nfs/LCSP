import { renderMailTemplate } from "../../../../platform/mail/mail-template.renderer.js";

type RecoveryEmailTemplateInput = {
  recoveryLink: string;
  recoveryToken: string;
};

export function renderRecoveryEmailText({
  recoveryLink,
  recoveryToken,
}: RecoveryEmailTemplateInput): string {
  return [
    "A password recovery request was received for your LCSP account.",
    "",
    `Open this link to continue: ${recoveryLink}`,
    "",
    `If needed, you can also paste this recovery token manually: ${recoveryToken}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
}

export function renderRecoveryEmailHtml({
  recoveryLink,
  recoveryToken,
}: RecoveryEmailTemplateInput): string {
  return renderMailTemplate("recovery-email.html", {
    recoveryLink,
    recoveryToken,
  });
}
