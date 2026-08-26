"use client";

import { resolveMessage } from "@lcsp/i18n";
import { usePathname } from "next/navigation";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { appLocale } from "@/lib/locale";

export function AppHeader() {
  const pathname = usePathname();
  const titleKey = getTitleKey(pathname);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center border-b bg-background/90 backdrop-blur">
      <div className="flex w-full items-center gap-3 px-4 lg:px-6">
        <SidebarTrigger
          className="-ml-1"
          label={t("pages.appShell.sidebarToggle")}
        />
        <Separator orientation="vertical" className="h-4" />
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("pages.appShell.headerEyebrow")}
          </p>
          <p className="truncate text-sm font-semibold sm:text-base">
            {t(titleKey)}
          </p>
        </div>
      </div>
    </header>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function getTitleKey(pathname: string) {
  if (pathname.startsWith("/assessments/")) {
    return "pages.appShell.assessmentTitle" as const;
  }

  return "pages.appShell.workspaceTitle" as const;
}
