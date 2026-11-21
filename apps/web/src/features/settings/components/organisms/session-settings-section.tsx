"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useHydrated } from "@/components/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import {
  useAuthSessionsQuery,
  useAuthSettingsProfileQuery,
  useRevokeAuthSessionMutation,
  useRevokeAllAuthSessionsMutation,
} from "@/lib/api/auth-queries";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import type { SessionSettingsSectionProps } from "../../types/session-settings.types";
import { SessionSettingsRow } from "../molecules/session-settings-row";

export function SessionSettingsSection({
  locale,
  onReauthenticate,
}: SessionSettingsSectionProps) {
  const hydrated = useHydrated();
  const query = useAuthSessionsQuery();
  const profileQuery = useAuthSettingsProfileQuery();
  const revoke = useRevokeAuthSessionMutation();
  const revokeAll = useRevokeAllAuthSessionsMutation();
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [success, setSuccess] = useState(false);
  const t = (key: MessageKey) => resolveMessage(locale, key);

  /**
   * Business purpose: Revoke selected or all sessions only after explicit access confirmation.
   * Business rules:
   * - Lock repeated clicks, require a loaded account and never mutate after canceled verification.
   * - Only a backend-confirmed result may show success or clear identity and leave Settings.
   * Execution flow:
   * 1. Clear prior feedback and obtain password or MFA verification.
   * 2. Submit the owner-scoped action and map its outcome to section-local feedback.
   * 3. On all-device completion cancel cached requests, clear private data and navigate to sign-in.
   * Failure cases:
   * - Canceled verification, missing targets, renewed challenges and transport failures preserve the page.
   * - Expired caller authentication follows the shared API redirect policy without success feedback.
   * Side effects:
   * - Opens reauthentication, revokes sessions and refreshes the list; all-device completion clears query cache.
   */
  async function revokeSessions(sessionId?: string) {
    if (locked.current || !profileQuery.data || profileQuery.isError) return;
    locked.current = true;
    setPending(true);
    setErrorKey(null);
    setSuccess(false);
    try {
      if (!(await onReauthenticate(profileQuery.data.mfa_enrolled))) {
        setErrorKey("pages.workspace.settingsHub.sessions.cancelled");
        return;
      }
      const outcome = sessionId
        ? await revoke.mutateAsync(sessionId)
        : await revokeAll.mutateAsync();
      if (outcome.kind === API_OUTCOME_KINDS.saved) {
        if (!sessionId) {
          await queryClient.cancelQueries();
          queryClient.clear();
          window.location.assign(API_REDIRECT_LOCATIONS.signIn);
          return;
        }
        setSuccess(true);
      } else {
        setErrorKey(
          outcome.kind === API_OUTCOME_KINDS.notFound
            ? "pages.workspace.settingsHub.sessions.targetMissing"
            : outcome.kind === API_OUTCOME_KINDS.sessionInvalid
              ? "auth.errors.sessionInvalid.detail"
              : outcome.kind === API_OUTCOME_KINDS.reauthRequired ||
                  outcome.kind === API_OUTCOME_KINDS.mfaRequired
                ? "pages.workspace.settingsHub.sessions.verifyAgain"
                : "pages.workspace.settingsHub.sessions.actionFailed",
        );
      }
    } catch {
      setErrorKey("pages.workspace.settingsHub.sessions.actionFailed");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <section
      className="space-y-6"
      aria-labelledby="settings-sessions-heading"
      aria-busy={pending}
    >
      <div className="space-y-2">
        <h2 id="settings-sessions-heading" className="text-lg font-semibold">
          {t("pages.workspace.settingsHub.sessions.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("pages.workspace.settingsHub.sessions.scopeDescription")}
        </p>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">
            {t("pages.workspace.settingsHub.sessions.logOutAllDevicesTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("pages.workspace.settingsHub.sessions.logoutAllDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={
            !hydrated || !profileQuery.data || profileQuery.isError || pending
          }
          onClick={() => void revokeSessions()}
        >
          {t("pages.workspace.settingsHub.sessions.logOutAllDevicesTitle")}
        </Button>
      </div>
      {hydrated && profileQuery.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("pages.workspace.settingsHub.sessions.accountFailed")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={profileQuery.isFetching}
            onClick={() => void profileQuery.refetch()}
          >
            {t("pages.workspace.settingsHub.profile.retry")}
          </Button>
        </div>
      ) : null}
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm">
          {t("pages.workspace.settingsHub.sessions.revoking")}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm">
          {t("pages.workspace.settingsHub.sessions.revokedTitle")}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium">
          {t("pages.workspace.settingsHub.sessions.summary")}
        </h3>
        <Button
          type="button"
          variant="outline"
          disabled={!hydrated || query.isFetching || pending}
          onClick={() => void query.refetch()}
        >
          {t("pages.workspace.settingsHub.sessions.refresh")}
        </Button>
      </div>
      {!hydrated || query.isPending ? (
        <p role="status">{t("pages.workspace.settingsHub.sessions.loading")}</p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("pages.workspace.settingsHub.sessions.loadFailed")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("pages.workspace.settingsHub.profile.retry")}
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("pages.workspace.settingsHub.states.noSessions")}
        </p>
      ) : (
        <ul className="space-y-3">
          {query.data.map((session) => (
            <SessionSettingsRow
              key={session.id}
              session={session}
              locale={locale}
              disabled={pending || !profileQuery.data || profileQuery.isError}
              onRevoke={(id) => void revokeSessions(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
