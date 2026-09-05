"use client";

import {
  ChartNoAxesCombinedIcon,
  CreditCardIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ToolCaseIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { resolveAppMessage } from "@/lib/i18n";

import { settingsNavigationItems } from "../../config/settings-navigation";
import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../../types/settings.types";
import { SettingsTab } from "../molecules/settings-tab";

const settingsTabIcons = {
  [SETTINGS_SECTION_IDS.general]: SettingsIcon,
  [SETTINGS_SECTION_IDS.account]: UserIcon,
  [SETTINGS_SECTION_IDS.privacy]: ShieldCheckIcon,
  [SETTINGS_SECTION_IDS.billing]: CreditCardIcon,
  [SETTINGS_SECTION_IDS.usage]: ChartNoAxesCombinedIcon,
  [SETTINGS_SECTION_IDS.capabilities]: ToolCaseIcon,
  [SETTINGS_SECTION_IDS.connectors]: PlugIcon,
} satisfies Record<SettingsSectionId, LucideIcon>;

type SettingsSidebarProps = {
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
};

export function SettingsSidebar({
  activeSection,
  onSectionChange,
}: SettingsSidebarProps) {
  return (
    <aside
      aria-label={resolveAppMessage(
        "pages.workspace.settingsHub.navigationLabel",
      )}
      className="flex shrink-0 flex-col border-b border-border/70 bg-muted/30 p-4 md:h-full md:w-60 md:border-r md:border-b-0"
      data-component="SettingsSidebar"
    >
      <div className="relative h-9.5 w-52 shrink-0">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          data-icon="inline-start"
        />
        <Input
          aria-label={resolveAppMessage(
            "pages.workspace.settingsHub.searchLabel",
          )}
          className="h-9.5 w-52 rounded-lg pl-8 text-[13px]"
          disabled
          placeholder={resolveAppMessage(
            "pages.workspace.settingsHub.searchPlaceholder",
          )}
        />
      </div>
      <div className="mt-3.5 flex flex-col">
        <p className="px-1.5 text-xs text-muted-foreground">
          {resolveAppMessage("pages.appShell.settings")}
        </p>
        <nav
          className="mt-3 flex w-52 flex-col gap-2"
          data-component="SettingsTabs"
        >
          {settingsNavigationItems.map((item) => (
            <SettingsTab
              active={activeSection === item.id}
              icon={settingsTabIcons[item.id]}
              id={item.id}
              key={item.id}
              label={resolveAppMessage(item.labelKey)}
              onSelect={onSectionChange}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
