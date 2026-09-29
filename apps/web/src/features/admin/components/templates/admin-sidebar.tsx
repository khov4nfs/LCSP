"use client";

import type { MessageKey } from "@lcsp/i18n";
import { LOCALES } from "@lcsp/contracts/shared";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import {
  LCSP_LOGO_SIZES,
  LCSP_LOGO_VARIANTS,
} from "@/components/types/lcsp-logo.types";
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
import { useSignOutMutation } from "@/lib/api/auth-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  getAppLocaleSnapshot,
  setAppLocale,
  subscribeToAppLocale,
} from "@/lib/locale";
import { cn } from "@/lib/utils";

type AdminSidebarProps = {
  adminName?: string;
  adminEmail?: string;
  isLoading?: boolean;
};

const emptySubscribe = () => () => {};

export function AdminSidebar({
  adminName,
  adminEmail,
  isLoading = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const currentLocale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isDark = mounted && resolvedTheme === "dark";
  const signOutMutation = useSignOutMutation();
  const fallbackName = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackName" as MessageKey,
  );
  const fallbackEmail = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackEmail" as MessageKey,
  );
  const adminRole = resolveAppMessage(
    "pages.admin.sidebar.roleAdminLabel" as MessageKey,
  );
  const resolvedAdminName = adminName ?? fallbackName;
  const resolvedAdminEmail = adminEmail ?? fallbackEmail;

  async function handleSignOut() {
    await signOutMutation.mutateAsync();
    window.location.assign("/sign-in");
  }

  const isUserAccountsActive =
    pathname === "/admin/users" || Boolean(pathname?.startsWith("/admin/users/"));
  const isOverviewActive =
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/admin/overview";
  const isCorpusActive = Boolean(pathname?.startsWith("/admin/corpus"));
  const isBillingActive = Boolean(pathname?.startsWith("/admin/billing"));

  const navItems = [
    {
      labelKey: "pages.admin.sidebar.navOverview" as MessageKey,
      href: "/admin",
      icon: LayoutDashboardIcon,
      isActive: isOverviewActive,
      disabled: false,
    },
    {
      labelKey: "pages.admin.sidebar.navUserAccounts" as MessageKey,
      href: "/admin/users",
      icon: UsersIcon,
      isActive: isUserAccountsActive,
      disabled: false,
    },
    {
      labelKey: "pages.admin.sidebar.navBilling" as MessageKey,
      href: "/admin/billing",
      icon: WalletCardsIcon,
      isActive: isBillingActive,
      disabled: false,
    },
    {
      labelKey: "pages.admin.sidebar.navCorpusVersions" as MessageKey,
      href: "/admin/corpus-versions",
      icon: BookOpenIcon,
      isActive: isCorpusActive,
      disabled: false,
    },
  ];

  return (
    <aside
      className="flex h-screen w-62 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar text-sidebar-foreground select-none"
      aria-label={resolveAppMessage(
        "pages.admin.sidebar.navigationAria" as MessageKey,
      )}
    >
      <div className="flex flex-col">
        {/* Brand Lockup & ADMIN Tag */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <LCSPLogo
              variant={LCSP_LOGO_VARIANTS.lockup}
              size={LCSP_LOGO_SIZES.md}
              label={resolveAppMessage(
                "pages.admin.sidebar.logoLabel" as MessageKey,
              )}
            />
          </div>
          <div className="mt-2.5 flex items-center">
            <span className="text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase">
              {resolveAppMessage(
                "pages.admin.sidebar.adminBadge" as MessageKey,
              )}
            </span>
          </div>
        </div>

        {/* Navigation Rows */}
        <nav
          className="mt-4 flex flex-col gap-1 px-3"
          aria-label={resolveAppMessage(
            "pages.admin.sidebar.sectionsAria" as MessageKey,
          )}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const label = resolveAppMessage(item.labelKey);

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="flex h-10 w-56 cursor-not-allowed items-center justify-between rounded-lg px-3 text-[13px] font-medium text-muted-foreground/50 opacity-60"
                  aria-disabled="true"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="size-4 shrink-0 text-muted-foreground/50" />
                    <span>{label}</span>
                  </div>
                  <span className="rounded bg-sidebar-border/40 px-1 py-0.5 text-[9.5px] font-medium text-muted-foreground uppercase">
                    {resolveAppMessage(
                      "pages.admin.sidebar.soonLabel" as MessageKey,
                    )}
                  </span>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 w-56 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  item.isActive
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
                aria-current={item.isActive ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    item.isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="mx-5 my-5 h-px bg-sidebar-border/60" />

        {/* Administration Section Note */}
        <div className="px-5">
          <p className="text-[10.5px] font-semibold tracking-wider text-sidebar-foreground/70 uppercase">
            {resolveAppMessage(
              "pages.admin.sidebar.administrationLabel" as MessageKey,
            )}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {resolveAppMessage(
              "pages.admin.sidebar.administrationDescription" as MessageKey,
            )}
          </p>
        </div>
      </div>

      {/* Bottom Authenticated Admin Identity with Dropdown */}
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-14 w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring cursor-pointer"
            aria-label={resolveAppMessage(
              "pages.admin.sidebar.identityFallbackName" as MessageKey,
            )}
          >
            {isLoading ? (
              <div className="size-8 shrink-0 rounded-full bg-sidebar-accent animate-pulse" />
            ) : (
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isBillingActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "bg-admin-status-active-surface text-admin-status-active-foreground",
                )}
              >
                {isBillingActive
                  ? adminRole.charAt(0).toUpperCase()
                  : resolvedAdminName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              {isLoading ? (
                <div className="flex flex-col gap-1.5 py-0.5">
                  <div className="h-3 w-20 rounded bg-sidebar-accent animate-pulse" />
                  <div className="h-2.5 w-28 rounded bg-sidebar-accent/60 animate-pulse" />
                </div>
              ) : (
                <>
                  <span className="truncate text-[12.5px] font-medium text-sidebar-foreground">
                    {isBillingActive ? resolvedAdminEmail : resolvedAdminName}
                  </span>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {isBillingActive ? adminRole : resolvedAdminEmail}
                  </span>
                </>
              )}
            </div>
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={8}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md"
          >
            {/* Header: Admin profile summary */}
            <div className="flex items-center gap-3 px-1.5 py-1.5">
              {isLoading ? (
                <>
                  <div className="size-8 shrink-0 rounded-full bg-muted animate-pulse" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-32 rounded bg-muted/60 animate-pulse" />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-admin-status-active-surface text-admin-status-active-foreground text-xs font-semibold">
                    {resolvedAdminName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {resolvedAdminName}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {resolvedAdminEmail}
                    </span>
                  </div>
                </>
              )}
            </div>

            <DropdownMenuSeparator className="my-1" />

            {/* Language Submenu (Scalable for 2, 5, 10, 50+ languages) */}
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer">
                  <LanguagesIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {resolveAppMessage(
                      "pages.workspace.settingsHub.general.language" as MessageKey,
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {currentLocale === "vi" ? "Tiếng Việt" : "English"}
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
                          <span className="text-xs">{loc === "vi" ? "🇻🇳" : "🇬🇧"}</span>
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
                    <MoonIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  ) : (
                    <SunIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
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
                  {[
                    {
                      value: THEME_PREFERENCES.system,
                      labelKey: "pages.workspace.settingsHub.appearance.themeOptions.system" as MessageKey,
                      icon: MonitorIcon,
                    },
                    {
                      value: THEME_PREFERENCES.light,
                      labelKey: "pages.workspace.settingsHub.appearance.themeOptions.light" as MessageKey,
                      icon: SunIcon,
                    },
                    {
                      value: THEME_PREFERENCES.dark,
                      labelKey: "pages.workspace.settingsHub.appearance.themeOptions.dark" as MessageKey,
                      icon: MoonIcon,
                    },
                  ].map((opt) => {
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
      </div>
    </aside>
  );
}
