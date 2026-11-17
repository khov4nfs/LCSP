import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionSettingsRowProps } from "../../types/session-settings.types";
import { formatDateTime } from "../../utils/settings-page.utils";

export function SessionSettingsRow({
  session,
  locale,
  disabled,
  onRevoke,
}: SessionSettingsRowProps) {
  const t = (key: MessageKey) => resolveMessage(locale, key);
  return (
    <li className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {t("pages.workspace.settingsHub.sessions.webSession")}
          </span>
          {session.is_current ? (
            <Badge variant="secondary">
              {t("pages.workspace.settingsHub.states.currentSession")}
            </Badge>
          ) : null}
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">
              {t("pages.workspace.settingsHub.labels.createdAt")}
            </dt>
            <dd>{formatDateTime(session.created_at, locale)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("pages.workspace.settingsHub.sessions.expiresAt")}
            </dt>
            <dd>{formatDateTime(session.expires_at, locale)}</dd>
          </div>
        </dl>
      </div>
      {!session.is_current ? (
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={disabled}
          onClick={() => onRevoke(session.id)}
        >
          {t("pages.workspace.settingsHub.actions.revoke")}
        </Button>
      ) : null}
    </li>
  );
}
