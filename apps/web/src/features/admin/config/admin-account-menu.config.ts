import type { MessageKey } from "@lcsp/i18n";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { THEME_PREFERENCES } from "@/components/types/theme-preference.types";

export const ADMIN_ACCOUNT_THEME_OPTIONS = [
  {
    value: THEME_PREFERENCES.system,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.system",
    icon: MonitorIcon,
  },
  {
    value: THEME_PREFERENCES.light,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.light",
    icon: SunIcon,
  },
  {
    value: THEME_PREFERENCES.dark,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.dark",
    icon: MoonIcon,
  },
] satisfies { value: string; labelKey: MessageKey; icon: typeof SunIcon }[];
