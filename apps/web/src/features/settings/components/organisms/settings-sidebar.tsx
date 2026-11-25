"use client";

import { useMemo, useState } from "react";
import {
  ChartNoAxesCombinedIcon,
  CreditCardIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ToolCaseIcon,
  UserIcon,
  XIcon,
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
  const [searchQuery, setSearchQuery] = useState("");

  // Rationale (Why): Replace the legacy disabled search input with functional client-side filtering.
  // Mechanism (How): Matches normalized query against localized section labels and section topic keywords.
  // Invariants (What): Empty query restores the full navigation list without altering active section state.
  const filteredItems = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return settingsNavigationItems;
    }

    return settingsNavigationItems.filter((item) => {
      const label = resolveAppMessage(item.labelKey).toLowerCase();
      if (label.includes(normalized)) {
        return true;
      }
      return item.keywords.some((keyword) =>
        keyword.toLowerCase().includes(normalized),
      );
    });
  }, [searchQuery]);

  return (
    <aside
      aria-label={resolveAppMessage(
        "pages.workspace.settingsHub.navigationLabel",
      )}
      className="flex min-w-0 shrink-0 flex-col border-b border-border/70 bg-muted/30 p-4 max-md:pr-12 md:h-full md:w-60 md:border-r md:border-b-0"
      data-component="SettingsSidebar"
    >
      <div className="relative hidden h-9.5 w-52 shrink-0 md:block">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          data-icon="inline-start"
        />
        <Input
          aria-label={resolveAppMessage(
            "pages.workspace.settingsHub.searchLabel",
          )}
          className="h-9.5 w-52 rounded-lg pr-8 pl-8 text-[13px]"
          placeholder={resolveAppMessage(
            "pages.workspace.settingsHub.searchPlaceholder",
          )}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searchQuery) {
              setSearchQuery("");
            }
          }}
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label={resolveAppMessage(
              "pages.workspace.settingsHub.clearSearch",
            )}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setSearchQuery("")}
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-3.5 flex flex-col">
        <p className="px-1.5 text-xs text-muted-foreground">
          {resolveAppMessage("pages.appShell.settings")}
        </p>
        <nav
          className="mt-3 flex w-full gap-2 overflow-x-auto md:w-52 md:flex-col"
          data-component="SettingsTabs"
        >
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <SettingsTab
                active={activeSection === item.id}
                icon={settingsTabIcons[item.id]}
                id={item.id}
                key={item.id}
                label={resolveAppMessage(item.labelKey)}
                onSelect={onSectionChange}
              />
            ))
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {resolveAppMessage("pages.workspace.settingsHub.searchNoResults")}
            </p>
          )}
        </nav>
      </div>
    </aside>
  );
}
