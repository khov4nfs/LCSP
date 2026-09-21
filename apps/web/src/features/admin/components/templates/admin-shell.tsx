"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@lcsp/i18n";

import { AdminSidebar } from "./admin-sidebar";
import { useAuthSettingsProfileQuery } from "@/lib/api/auth-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  getAppLocaleSnapshot,
  setAppLocale,
  subscribeToAppLocale,
} from "@/lib/locale";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  children: ReactNode;
  adminName?: string;
  adminEmail?: string;
};

export function AdminShell({
  children,
  adminName,
  adminEmail,
}: AdminShellProps) {
  const pathname = usePathname();
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const isBillingRoute = pathname.startsWith("/admin/billing");
  const { data: profile } = useAuthSettingsProfileQuery();
  const fallbackName = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackName" as MessageKey,
  );
  const fallbackEmail = resolveAppMessage(
    "pages.admin.sidebar.identityFallbackEmail" as MessageKey,
  );

  const resolvedName =
    adminName ??
    profile?.display_name ??
    (profile?.email ? profile.email.split("@")[0] : undefined) ??
    fallbackName;
  const resolvedEmail = adminEmail ?? profile?.email ?? fallbackEmail;

  useEffect(() => {
    const documentLocale = document.documentElement.lang;
    if (
      (documentLocale === "en" || documentLocale === "vi") &&
      locale !== documentLocale
    ) {
      setAppLocale(documentLocale);
    }
  }, [locale]);

  return (
    <div
      className={cn(
        "flex min-h-screen w-full bg-background text-foreground antialiased selection:bg-primary/20",
        isBillingRoute && "dark",
      )}
      data-admin-theme={isBillingRoute ? "billing-dark" : "default"}
      data-locale={locale}
    >
      {/* 248px Desktop Admin Sidebar */}
      <AdminSidebar adminName={resolvedName} adminEmail={resolvedEmail} />

      {/* Main Content Surface (1192px at 1440px desktop viewport) */}
      <main
        className={cn(
          "flex min-h-screen flex-1 min-w-0 flex-col overflow-y-auto px-10 py-8",
          isBillingRoute && "2xl:px-11.5 2xl:py-9",
        )}
      >
        <div
          className={cn(
            "mx-auto w-full max-w-[1192px]",
            isBillingRoute && "2xl:max-w-7xl",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
