import Link from "next/link";
import { type LegalSourceVersionSummary } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import { LegalSourceLifecycleBadge } from "../atoms/legal-source-lifecycle-badge";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceVersionsTable({
  versions,
}: {
  versions: LegalSourceVersionSummary[];
}) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("pages.legalSources.noVersions")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-160 text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.versionLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.statusLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.basedOnLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.readyDocumentCountLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.chunkCountLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.createdAtLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.activatedAtLabel")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {versions.map((version) => (
            <tr key={version.id}>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/legal-source-versions/${encodeURIComponent(version.id)}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {version.version}
                </Link>
              </td>
              <td className="px-4 py-3">
                <LegalSourceLifecycleBadge status={version.status} />
              </td>
              <td className="px-4 py-3">
                {versions.find((item) => item.id === version.basedOnVersionId)
                  ?.version ?? "—"}
              </td>
              <td className="px-4 py-3">
                {version.readyDocumentCount}/{version.documentCount}
              </td>
              <td className="px-4 py-3">{version.chunkCount}</td>
              <td className="px-4 py-3">{formatDate(version.createdAt)}</td>
              <td className="px-4 py-3">
                {version.activatedAt ? formatDate(version.activatedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}
