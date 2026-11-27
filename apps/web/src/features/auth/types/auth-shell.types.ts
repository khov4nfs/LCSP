import type { ReactNode } from "react";
import type { MessageKey } from "@lcsp/i18n";

export type AuthShellProps = {
  children: ReactNode;
  /** Resolve the accessible home name inside AuthShell so it follows the active locale. */
  homeLabelKey: MessageKey;
};
