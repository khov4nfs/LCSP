import Link from "next/link";
import type { LegalSourceSummary } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveAppMessage } from "@/lib/i18n";
import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Business purpose: Present a legal source summary card with active and latest version states without redundant duplicate badges.
 * Business rules:
 * - Active version badge is displayed when an active version exists.
 * - Latest version state is only displayed when it differs from the active version, preventing duplicate active status rows.
 * - When no active version exists, show latest version or unconfigured notice.
 * Execution flow:
 * 1. Check if an active version exists for the legal source.
 * 2. Compare latest version identity against active version identity.
 * 3. Render the active version badge.
 * 4. Conditionally render distinct latest version metadata separated by a middle dot only when distinct.
 * 5. Render document count and ready document metrics.
 * Failure cases:
 * - Null or missing version metadata falls back safely to localized empty state labels without throwing.
 * Side effects:
 * - Pure presentation component; no mutations or side effects.
 */
export function LegalSourceListCard({
  source,
}: {
  source: LegalSourceSummary;
}) {
  const latest = source.latestVersion;
  const isLatestDistinct = Boolean(
    latest &&
      (!source.activeVersion ||
        (latest.id !== source.activeVersion.id &&
          latest.version !== source.activeVersion.version)),
  );
  const effectiveVersion = source.activeVersion ?? latest;

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
              <span className="rounded-full border border-status-success-border bg-status-success-bg px-2.5 py-1 text-sm font-medium text-status-success">
                {formatVersionMessage(
                  "pages.legalSources.activeVersion",
                  source.activeVersion.version,
                )}
              </span>
            ) : null}
            {isLatestDistinct && latest ? (
              <>
                {source.activeVersion ? (
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span className="text-sm text-muted-foreground">
                  {formatLatestMessage(latest.version, latest.status)}
                </span>
              </>
            ) : !source.activeVersion ? (
              <span className="text-sm text-muted-foreground">
                {t("pages.legalSources.noVersions")}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {effectiveVersion?.documentCount ?? 0} ·{" "}
            {effectiveVersion?.readyDocumentCount ?? 0}{" "}
            {t("pages.legalSources.readyDocumentCountLabel")}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Business purpose: Format localized active version string with version identifier.
 * Business rules:
 * - Injects the exact version string into the template placeholder.
 * Execution flow:
 * 1. Resolve message key for active version.
 * 2. Replace placeholder `{version}` with provided version string.
 * Failure cases:
 * - Missing version string renders empty placeholder.
 * Side effects:
 * - Pure function; no mutations or side effects.
 */
function formatVersionMessage(key: string, version: string) {
  return resolveAppMessage(key as MessageKey).replaceAll("{version}", version);
}

/**
 * Business purpose: Format localized latest version string with version and lifecycle status.
 * Business rules:
 * - Resolves the lifecycle status key and injects version and status into the localized template.
 * Execution flow:
 * 1. Look up lifecycle status key from configuration mapping.
 * 2. Resolve template string and status label.
 * 3. Replace `{version}` and `{status}` tokens in template.
 * Failure cases:
 * - Unmapped status falls back to INVALID status label.
 * Side effects:
 * - Pure function; no mutations or side effects.
 */
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
