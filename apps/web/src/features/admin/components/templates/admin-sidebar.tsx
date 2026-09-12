"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UsersIcon, LayoutDashboardIcon, BookOpenIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";

import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import { LCSP_LOGO_SIZES, LCSP_LOGO_VARIANTS } from "@/components/types/lcsp-logo.types";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminSidebarProps = {
  adminName?: string;
  adminEmail?: string;
};

export function AdminSidebar({
  adminName,
  adminEmail,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const fallbackName = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackName" as MessageKey,
  );
  const fallbackEmail = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackEmail" as MessageKey,
  );
  const resolvedAdminName = adminName ?? fallbackName;
  const resolvedAdminEmail = adminEmail ?? fallbackEmail;

  const isUserAccountsActive =
    pathname === "/admin/users" || pathname.startsWith("/admin/users/");
  const isOverviewActive =
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/admin/overview";
  const isCorpusActive = pathname.startsWith("/admin/corpus");

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
      labelKey: "pages.admin.sidebar.navCorpusVersions" as MessageKey,
      href: "/admin/corpus-versions",
      icon: BookOpenIcon,
      isActive: isCorpusActive,
      disabled: false,
    },
  ];

  return (
    <aside
      className="flex h-screen w-[248px] shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar text-sidebar-foreground select-none"
      aria-label={resolveAppMessage("pages.admin.sidebar.navigationAria" as MessageKey)}
    >
      <div className="flex flex-col">
        {/* Brand Lockup & ADMIN Tag */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <LCSPLogo
              variant={LCSP_LOGO_VARIANTS.lockup}
              size={LCSP_LOGO_SIZES.md}
              label={resolveAppMessage("pages.admin.sidebar.logoLabel" as MessageKey)}
            />
          </div>
          <div className="mt-2.5 flex items-center">
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase bg-sidebar-accent border border-sidebar-border">
              {resolveAppMessage("pages.admin.sidebar.adminBadge" as MessageKey)}
            </span>
          </div>
        </div>

        {/* Navigation Rows */}
        <nav
          className="mt-4 flex flex-col gap-1 px-3"
          aria-label={resolveAppMessage("pages.admin.sidebar.sectionsAria" as MessageKey)}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const label = resolveAppMessage(item.labelKey);

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="flex h-10 w-[224px] cursor-not-allowed items-center justify-between rounded-[10px] px-3 text-[13px] font-medium text-muted-foreground/50 opacity-60"
                  aria-disabled="true"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="size-4 shrink-0 text-muted-foreground/50" />
                    <span>{label}</span>
                  </div>
                  <span className="rounded bg-sidebar-border/40 px-1 py-0.5 text-[9.5px] font-medium text-muted-foreground uppercase">
                    {resolveAppMessage("pages.admin.sidebar.soonLabel" as MessageKey)}
                  </span>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 w-[224px] items-center gap-3 rounded-[10px] px-3 text-[13px] font-medium transition-colors",
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
            {resolveAppMessage("pages.admin.sidebar.administrationLabel" as MessageKey)}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {resolveAppMessage("pages.admin.sidebar.administrationDescription" as MessageKey)}
          </p>
        </div>
      </div>

      {/* Bottom Authenticated Admin Identity */}
      <div className="p-3">
        <div className="flex h-14 w-[224px] items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-admin-status-active-surface text-xs font-semibold text-admin-status-active-foreground">
            {resolvedAdminName.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-[12.5px] font-medium text-sidebar-foreground">
              {resolvedAdminName}
            </span>
            <span className="truncate text-[10.5px] text-muted-foreground">
              {resolvedAdminEmail}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
