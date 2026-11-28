"use client";

import { useState, useSyncExternalStore } from "react";
import { PanelLeftIcon } from "lucide-react";
import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import {
  LCSP_LOGO_SIZES,
  LCSP_LOGO_VARIANTS,
} from "@/components/types/lcsp-logo.types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { resolveAppMessage } from "@/lib/i18n";
import { getAppLocaleSnapshot, subscribeToAppLocale } from "@/lib/locale";
import { useAdminDesktop } from "../../hooks/use-admin-desktop";
import type { AdminShellProps } from "../../types/admin-shell.types";
import { AdminSidebar } from "./admin-sidebar";

export function AdminShell({ children }: AdminShellProps) {
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const desktop = useAdminDesktop();
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    // Inherit the active ThemeProvider mode uniformly across all admin routes;
    // never force a route-local `.dark` class on /admin/billing.
    <div
      className="flex h-dvh w-full overflow-hidden bg-background text-foreground antialiased selection:bg-primary/20"
      data-admin-shell
      data-admin-theme="default"
      data-locale={locale}
    >
      {desktop ? <AdminSidebar /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!desktop ? (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-sidebar-border px-4 py-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setNavigationOpen(true)}
                aria-label={resolveAppMessage(
                  "pages.admin.sidebar.navigationToggle",
                )}
                aria-expanded={navigationOpen}
              >
                <PanelLeftIcon />
              </Button>
              <LCSPLogo
                variant={LCSP_LOGO_VARIANTS.lockup}
                size={LCSP_LOGO_SIZES.md}
                label={resolveAppMessage("pages.admin.sidebar.logoLabel")}
              />
            </header>
            <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
              <SheetContent
                side="left"
                data-figma-node="1662:4763"
                data-figma-name="57 Admin · Mobile sidebar"
                className="max-w-full gap-0 p-0 data-[side=left]:w-68 border-r border-border bg-card"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>
                    {resolveAppMessage("pages.admin.sidebar.navigationAria")}
                  </SheetTitle>
                  <SheetDescription>
                    {resolveAppMessage("pages.admin.sidebar.sectionsAria")}
                  </SheetDescription>
                </SheetHeader>
                <AdminSidebar onNavigate={() => setNavigationOpen(false)} />
              </SheetContent>
            </Sheet>
          </>
        ) : null}
        <main
          key={locale}
          data-admin-content
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 sm:px-6 lg:px-10 lg:py-8"
        >
          <div className="mx-auto w-full max-w-298 shrink-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
