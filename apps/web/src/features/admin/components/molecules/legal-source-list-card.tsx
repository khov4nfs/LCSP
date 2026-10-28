import Link from "next/link";
import type { LegalSourceSummary } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveAppMessage } from "@/lib/i18n";
import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceListCard({
  source,
}: {
  source: LegalSourceSummary;
}) {
  const latest = source.latestVersion;
  return (
    <Link
      href={`/admin/legal-sources/${encodeURIComponent(source.id)}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors hover:bg-muted/30">
        <CardHeader>
          <CardTitle>{source.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{source.slug}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {source.description ? (
            <p className="text-sm text-muted-foreground">
              {source.description}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {source.activeVersion ? (
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                {formatVersionMessage(
                  "pages.legalSources.activeVersion",
                  source.activeVersion.version,
                )}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("pages.legalSources.noActiveVersion")}
              </span>
            )}
            {latest ? (
              <>
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className="text-sm">
                  {formatLatestMessage(latest.version, latest.status)}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("pages.legalSources.noVersions")}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {latest?.documentCount ?? 0} · {latest?.readyDocumentCount ?? 0}{" "}
            {t("pages.legalSources.readyDocumentCountLabel")}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

function formatVersionMessage(key: string, version: string) {
  return resolveAppMessage(key as MessageKey).replaceAll("{version}", version);
}

function formatLatestMessage(version: string, status: string) {
  const statusValue = Object.entries(LEGAL_SOURCE_STATUS_MESSAGE_KEYS).find(
    ([value]) => value === status,
  )?.[1];
  return resolveAppMessage("pages.legalSources.latestVersion" as MessageKey)
    .replaceAll("{version}", version)
    .replaceAll(
      "{status}",
      statusValue
        ? resolveAppMessage(statusValue as MessageKey)
        : resolveAppMessage(
            "pages.legalSources.statuses.INVALID" as MessageKey,
          ),
    );
}
