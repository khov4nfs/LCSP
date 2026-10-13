"use client";

import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import {
  LCSP_LOGO_SIZES,
  LCSP_LOGO_VARIANTS,
} from "@/components/types/lcsp-logo.types";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_ITEMS } from "../../config/admin-sidebar.config";
import type { AdminSidebarProps } from "../../types/admin-shell.types";
import { AdminAccountMenu } from "../organisms/admin-account-menu";

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const pathname = usePathname();
  return (
    <aside
      className="flex h-full min-h-0 w-62 max-w-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground select-none"
      aria-label={resolveAppMessage(
        "pages.admin.sidebar.navigationAria" as MessageKey,
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
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
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href === "/admin"
                ? pathname === "/admin/" || pathname === "/admin/overview"
                : Boolean(pathname?.startsWith(`${item.href}/`)));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex h-10 w-56 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <span>{resolveAppMessage(item.labelKey)}</span>
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

      <div className="mt-auto shrink-0 p-3">
        <AdminAccountMenu />
      </div>
    </aside>
  );
}
