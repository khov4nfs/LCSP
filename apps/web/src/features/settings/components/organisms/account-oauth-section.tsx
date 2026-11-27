"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, CheckCircle2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { OAUTH_LINK_QUERY_RESULTS } from "@lcsp/contracts/auth";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
// Reuse the bundled Google mark used by sign-in; the former public URL was not served by this Next.js app.
import googleIcon from "@/public/assets/icons/google.svg";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthSettingsProfile } from "@/lib/api/auth-client";
import { useLinkedOAuthIdentitiesQuery } from "@/lib/api/auth-queries";
import { apiQueryKeys } from "@/lib/api/query-keys";
import { formatLocaleDate } from "@/lib/date-format";

export type AccountOAuthSectionProps = {
  profile: AuthSettingsProfile;
  locale: Locale;
  onReauthenticate: (mfaRequired: boolean) => Promise<boolean>;
  oauthLinkResult?: string | null;
  onDismissResult?: () => void;
};

/**
 * Business purpose: Manage third-party OAuth account linking (e.g. Google) for the current LCSP account.
 *
 * Business rules:
 * - Shows connected status and linked date for linked providers confirmed by backend data.
 * - Enforces reauthentication sensitive action check before initiating an account link.
 * - Prevents starting duplicate or concurrent OAuth link attempts.
 * - Validates backend data before showing success banner, preventing forged URL manipulation.
 *
 * Execution flow:
 * 1. Query backend for linked third-party identities of the authenticated user.
 * 2. Process callback query parameters and invalidate query cache.
 * 3. Render appropriate loading, connected, not-connected, or error states.
 * 4. Handle connect initiation through reauthentication gate and redirect to BFF link start endpoint.
 *
 * Failure cases:
 * - Query failure renders load error alert with retry button.
 * - Cancelled or failed linking flow displays informational or error feedback.
 * - Expired sessions surface session-expired error feedback.
 *
 * Side effects:
 * - Initiates browser redirect to OAuth provider upon successful reauthentication.
 * - Cleans up callback outcome query parameters from the browser URL.
 */
export function AccountOAuthSection({
  profile,
  locale,
  onReauthenticate,
  oauthLinkResult: controlledResult,
  onDismissResult,
}: AccountOAuthSectionProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const query = useLinkedOAuthIdentitiesQuery();
  const { data: identities = [], isPending, isError, refetch } = query;

  const [isConnecting, setIsConnecting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const processedParam = useRef<string | null>(null);

  const t = useCallback(
    (key: MessageKey) => resolveMessage(locale, key),
    [locale],
  );

  const handleDismissResult = useCallback(() => {
    setIsDismissed(true);
    onDismissResult?.();
  }, [onDismissResult]);

  const googleIdentity = identities.find(
    (id) => id.provider.toLowerCase() === "google",
  );
  const isGoogleConnected = Boolean(googleIdentity);

  // Read callback outcome parameter from props or URL
  const activeResult =
    controlledResult ?? searchParams?.get("oauth_link") ?? null;

  // Rationale: Derive alert visibility directly from URL/prop state instead of calling setState in an effect.
  // Mechanism: Check activeResult against OAUTH_LINK_QUERY_RESULTS and enforce confirmation via backend data.
  // Invariant: Success banner must only display if backend confirmed the provider is connected (TC14); dismissible locally.
  const showFailureAlert =
    activeResult === OAUTH_LINK_QUERY_RESULTS.failed && !isDismissed;

  const isConfirmedSuccess =
    activeResult === OAUTH_LINK_QUERY_RESULTS.success &&
    isGoogleConnected &&
    !isDismissed;

  useEffect(() => {
    if (!activeResult || processedParam.current === activeResult) {
      return;
    }
    processedParam.current = activeResult;

    // Rationale: Ensure cached identities reflect the newly completed link callback immediately.
    // Mechanism: Invalidate TanStack query cache and trigger background refetch.
    // Invariant: Query cache must always reconcile with backend state after a callback redirect.
    void queryClient.invalidateQueries({
      queryKey: apiQueryKeys.auth.oauthIdentities(),
    });

    if (activeResult === OAUTH_LINK_QUERY_RESULTS.sessionExpired) {
      toast.error(
        t("pages.workspace.settingsHub.connectedAccounts.sessionExpiredToast"),
      );
    } else if (activeResult === OAUTH_LINK_QUERY_RESULTS.cancelled) {
      toast.info(
        t("pages.workspace.settingsHub.connectedAccounts.cancelledToast"),
      );
    } else if (activeResult === OAUTH_LINK_QUERY_RESULTS.alreadyLinked) {
      toast.info(
        t("pages.workspace.settingsHub.connectedAccounts.alreadyLinkedToast"),
      );
    } else if (activeResult === OAUTH_LINK_QUERY_RESULTS.failed) {
      toast.error(
        t("pages.workspace.settingsHub.connectedAccounts.failedToast"),
      );
    } else if (activeResult === OAUTH_LINK_QUERY_RESULTS.success) {
      toast.success(
        t("pages.workspace.settingsHub.connectedAccounts.successToast"),
      );
    }

    // Clean up query param from URL so refresh does not re-trigger the outcome
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("oauth_link")) {
        url.searchParams.delete("oauth_link");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [activeResult, queryClient, t]);

  /**
   * Business purpose: Start Google OAuth account linking after verifying account security.
   *
   * Business rules:
   * - Must not trigger if already connecting or if Google is already linked.
   * - Must prompt for reauthentication before initiating linking.
   * - If reauthentication is cancelled or fails, aborts without redirection.
   *
   * Execution flow:
   * 1. Set connecting lock state.
   * 2. Challenge user for reauthentication using current MFA profile enrollment state.
   * 3. Upon approval, redirect to BFF link start endpoint.
   *
   * Failure cases:
   * - Reauthentication cancelled/denied resets connecting lock state.
   *
   * Side effects:
   * - Redirects browser window to OAuth authorization endpoint.
   */
  async function handleConnectGoogle() {
    if (isConnecting || isGoogleConnected) return;

    setIsConnecting(true);
    try {
      // Rationale: Adding an authentication method is a sensitive action requiring proof of account ownership.
      // Mechanism: Trigger the shared reauthentication challenge before redirecting.
      // Invariant: Unconfirmed challenges fail closed without navigating to the OAuth start endpoint.
      const authenticated = await onReauthenticate(profile.mfa_enrolled);
      if (!authenticated) {
        setIsConnecting(false);
        return;
      }

      window.location.assign("/api/auth/oauth/link/start?provider=google");
    } catch {
      setIsConnecting(false);
    }
  }

  // Prevent false success display if backend data confirms provider is NOT linked (TC14)
  return (
    <section
      className="space-y-4"
      aria-labelledby="settings-oauth-heading"
      data-component="AccountOAuthSection"
    >
      <div>
        <h2 id="settings-oauth-heading" className="text-lg font-semibold">
          {t("pages.workspace.settingsHub.connectedAccounts.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("pages.workspace.settingsHub.connectedAccounts.description")}
        </p>
      </div>

      {isConfirmedSuccess ? (
        <Alert
          className="border-primary/40 bg-primary/5 text-foreground"
          data-testid="oauth-link-success-banner"
        >
          <CheckCircle2Icon
            className="size-4 text-primary"
            aria-hidden="true"
          />
          <div className="flex items-center justify-between">
            <AlertTitle>
              {t("pages.workspace.settingsHub.connectedAccounts.successBanner")}
            </AlertTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={handleDismissResult}
              aria-label="Dismiss"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      ) : null}

      {showFailureAlert ? (
        <Alert variant="destructive" data-testid="oauth-link-failure-alert">
          <AlertCircleIcon className="size-4" aria-hidden="true" />
          <div className="flex items-start justify-between">
            <div>
              <AlertTitle>
                {t("pages.workspace.settingsHub.connectedAccounts.failedToast")}
              </AlertTitle>
              <AlertDescription>
                {t(
                  "pages.workspace.settingsHub.account.oauthLinkFailedDescription",
                )}
              </AlertDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-destructive-foreground hover:text-foreground"
              onClick={handleDismissResult}
              aria-label="Dismiss"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Alert>
      ) : null}

      {isError ? (
        <Alert variant="destructive" data-testid="oauth-load-error-alert">
          <AlertCircleIcon className="size-4" aria-hidden="true" />
          <AlertTitle>
            {t("pages.workspace.settingsHub.connectedAccounts.loadFailedTitle")}
          </AlertTitle>
          <AlertDescription className="mt-2 flex items-center justify-between">
            <span>
              {t(
                "pages.workspace.settingsHub.connectedAccounts.loadFailedDetail",
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              {t("pages.workspace.settingsHub.connectedAccounts.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={googleIcon}
              alt=""
              width={20}
              height={20}
              className="size-5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium">
                {t("pages.workspace.settingsHub.connectedAccounts.google")}
              </p>
              {isPending ? (
                <Skeleton className="mt-1 h-4 w-32" />
              ) : isGoogleConnected && googleIdentity ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "pages.workspace.settingsHub.connectedAccounts.linkedOn",
                  ).replace(
                    "{date}",
                    formatLocaleDate(googleIdentity.linked_at, locale),
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "pages.workspace.settingsHub.connectedAccounts.notConnected",
                  )}
                </p>
              )}
            </div>
          </div>

          <div>
            {isPending ? (
              <Skeleton className="h-9 w-24" />
            ) : isGoogleConnected ? (
              <Badge variant="secondary" className="px-3 py-1 text-xs">
                {t("pages.workspace.settingsHub.connectedAccounts.connected")}
              </Badge>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isConnecting}
                onClick={() => void handleConnectGoogle()}
              >
                {isConnecting
                  ? t(
                      "pages.workspace.settingsHub.connectedAccounts.connecting",
                    )
                  : t("pages.workspace.settingsHub.connectedAccounts.connect")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("pages.workspace.settingsHub.connectedAccounts.disclaimer")}
      </p>
    </section>
  );
}
