import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
/**
 * Business purpose: Resolve localized Admin catalog and preparation copy.
 * Business rules:
 * - Labels use the shared EN/VI message catalog rather than inline display strings.
 * Execution flow:
 * 1. Resolve the requested key inside the catalog message namespace.
 * Failure cases:
 * - Missing keys follow the shared message resolver's existing fallback behavior.
 * Side effects:
 * - Pure message lookup; does not change selection, catalog or preparation state.
 */
export const catalogMessage = (key: string) =>
  resolveAppMessage(`pages.legalRuleCatalog.${key}` as MessageKey);
