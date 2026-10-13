"use client";

import type { MessageKey } from "@lcsp/i18n";
import { LOCALES } from "@lcsp/contracts/shared";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LanguagesIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { THEME_PREFERENCES } from "@/components/types/theme-preference.types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAuthSettingsProfileQuery,
  useSignOutMutation,
} from "@/lib/api/auth-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  getAppLocaleSnapshot,
  setAppLocale,
  subscribeToAppLocale,
} from "@/lib/locale";
import { cn } from "@/lib/utils";
import { ADMIN_ACCOUNT_THEME_OPTIONS } from "../../config/admin-account-menu.config";
import { getAdminAccountIdentity } from "../../lib/admin-account-identity";
import { AdminAccountIdentity } from "../molecules/admin-account-identity";

const emptySubscribe = () => () => {};

export function AdminAccountMenu() {
  const { data: profile } = useAuthSettingsProfileQuery();
  const identity = getAdminAccountIdentity(profile);
  const currentLocale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const isDark = mounted && resolvedTheme === "dark";
  const signOutMutation = useSignOutMutation();
  async function handleSignOut() {
    await signOutMutation.mutateAsync();
    window.location.assign("/sign-in");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-admin-account-trigger
        disabled={!identity}
        className="flex h-14 w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring cursor-pointer"
        aria-label={resolveAppMessage("pages.appShell.accountMenu")}
      >
        <AdminAccountIdentity identity={identity} />
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-56 min-w-56 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md"
      >
        <div
          className="flex items-center gap-3 px-1.5 py-1.5"
          data-admin-account-header
        >
          <AdminAccountIdentity identity={identity} />
        </div>

        <DropdownMenuSeparator className="my-1" />

        {/* Language */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer">
              <LanguagesIcon
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">
                {resolveAppMessage(
                  "pages.workspace.settingsHub.general.language" as MessageKey,
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {resolveAppMessage(
                  currentLocale === "vi"
                    ? "pages.workspace.settingsHub.general.languageVietnamese"
                    : "pages.workspace.settingsHub.general.languageEnglish",
                )}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md">
              {LOCALES.map((loc) => {
                const isSelected = currentLocale === loc;
                return (
                  <DropdownMenuItem
                    key={loc}
                    closeOnClick={false}
                    onClick={() => {
                      setAppLocale(loc);
                    }}
                    className={cn(
                      "flex h-8 items-center justify-between rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer",
                      isSelected
                        ? "bg-accent/80 text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs">
                        {loc === "vi" ? "🇻🇳" : "🇬🇧"}
                      </span>
                      <span>
                        {loc === "vi"
                          ? resolveAppMessage(
                              "pages.workspace.settingsHub.general.languageVietnamese" as MessageKey,
                            )
                          : resolveAppMessage(
                              "pages.workspace.settingsHub.general.languageEnglish" as MessageKey,
                            )}
                      </span>
                    </div>
                    {isSelected ? (
                      <CheckIcon className="size-3.5 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        {/* Theme Submenu (System / Light / Dark) */}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer">
              {isDark ? (
                <MoonIcon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
              ) : (
                <SunIcon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {resolveAppMessage(
                  "pages.workspace.settingsHub.appearance.shellTitle" as MessageKey,
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {theme === THEME_PREFERENCES.system || !theme
                  ? resolveAppMessage(
                      "pages.workspace.settingsHub.appearance.themeOptions.system" as MessageKey,
                    )
                  : isDark
                    ? resolveAppMessage(
                        "pages.workspace.settingsHub.appearance.themeOptions.dark" as MessageKey,
                      )
                    : resolveAppMessage(
                        "pages.workspace.settingsHub.appearance.themeOptions.light" as MessageKey,
                      )}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md">
              {ADMIN_ACCOUNT_THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected =
                  theme === opt.value ||
                  (!theme && opt.value === THEME_PREFERENCES.system);
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    closeOnClick={false}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex h-8 items-center justify-between rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer",
                      isSelected
                        ? "bg-accent/80 text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5" />
                      <span>{resolveAppMessage(opt.labelKey)}</span>
                    </div>
                    {isSelected ? (
                      <CheckIcon className="size-3.5 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-1" />

        {/* Sign Out */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={signOutMutation.isPending}
            onClick={handleSignOut}
            variant="destructive"
            className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer"
          >
            <LogOutIcon aria-hidden="true" className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {resolveAppMessage("pages.appShell.signOut")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
