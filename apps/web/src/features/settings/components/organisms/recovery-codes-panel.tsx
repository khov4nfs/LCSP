"use client";

import { useRef, useState } from "react";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import {
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
  type MfaRecoveryCodeAccessAction,
} from "@lcsp/contracts/auth";
import { Button } from "@/components/ui/button";
import { recordMfaRecoveryCodeAccess } from "@/lib/api/auth-client";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import type { RecoveryCodesPanelProps } from "../../types/account-security.types";

export function RecoveryCodesPanel({
  codes,
  locale,
  onClose,
}: RecoveryCodesPanelProps) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [feedback, setFeedback] = useState<MessageKey | null>(null);
  const t = (key: MessageKey) => resolveMessage(locale, key);

  /**
   * Business purpose: Let the account owner securely retain the newly issued recovery credentials.
   * Business rules:
   * - Copy and download require a successful access audit before exporting cleartext codes.
   * - Codes remain in the owning interaction's memory and are never written to browser storage.
   * Execution flow:
   * 1. Lock duplicate exports and record the selected access action.
   * 2. Copy the codes or download a temporary text file, then announce completion.
   * Failure cases:
   * - Failed audit, clipboard denial or download setup shows an error while retaining the codes.
   * Side effects:
   * - Records an audit event and writes only to the user-requested clipboard or downloaded file.
   */
  async function exportCodes(action: MfaRecoveryCodeAccessAction) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError(false);
    setFeedback(null);
    try {
      const result = await recordMfaRecoveryCodeAccess(action);
      if (result.kind !== API_OUTCOME_KINDS.saved) {
        setError(true);
        return;
      }
      if (action === MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy) {
        await navigator.clipboard.writeText(codes.join("\n"));
        setFeedback("pages.workspace.settingsHub.accountSecurity.copied");
      } else {
        const url = URL.createObjectURL(
          new Blob([codes.join("\n")], { type: "text/plain;charset=utf-8" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = t(
          "pages.workspace.settingsHub.accountSecurity.downloadName",
        );
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setFeedback("pages.workspace.settingsHub.accountSecurity.downloaded");
      }
    } catch {
      setError(true);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-labelledby="settings-codes-heading"
      aria-busy={pending}
    >
      <h3 id="settings-codes-heading" className="font-semibold">
        {t("pages.workspace.settingsHub.accountSecurity.codesTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("pages.workspace.settingsHub.accountSecurity.codesDescription")}
      </p>
      <ul className="grid gap-2 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void exportCodes(MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy)
          }
        >
          {t("pages.mfaEnroll.copyCodes")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void exportCodes(MFA_RECOVERY_CODE_ACCESS_ACTIONS.download)
          }
        >
          {t("pages.mfaEnroll.downloadCodes")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onClose}
        >
          {t("pages.workspace.settingsHub.accountSecurity.closeCodes")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("pages.workspace.settingsHub.accountSecurity.accessFailed")}
        </p>
      ) : null}
      {feedback ? (
        <p role="status" className="text-sm">
          {t(feedback)}
        </p>
      ) : null}
    </section>
  );
}
