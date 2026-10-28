import { type LegalSourceVersionBlocker } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";
import { LEGAL_SOURCE_BLOCKER_MESSAGE_KEYS } from "../../config/legal-source-display.config";

export function LegalSourceBlockerList({
  blockers,
}: {
  blockers: LegalSourceVersionBlocker[];
}) {
  if (blockers.length === 0) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300">
        {resolveAppMessage("pages.legalSources.noBlockers" as MessageKey)}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {blockers.map((blocker) => (
        <li key={blocker} className="flex items-start gap-2 text-sm">
          <span
            aria-hidden="true"
            className="mt-1 size-2 rounded-full bg-amber-500"
          />
          <span>
            {resolveAppMessage(
              LEGAL_SOURCE_BLOCKER_MESSAGE_KEYS[blocker] as MessageKey,
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
