"use client";

import { resolveMessage } from "@lcsp/i18n";
import { usePathname } from "next/navigation";
import { Suspense, type CSSProperties } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { appLocale } from "@/lib/locale";

import {
  getAssessmentNavigation,
  primaryNavigation,
} from "../../config/app-shell-navigation";
import type {
  AppShellProps,
  AppShellNavigationItem,
  AppShellNavigationSection,
} from "../../types/app-shell.types";
import { AppHeader } from "../molecules/app-header";
import { AppSidebar } from "./app-sidebar";
import { WorkspaceRuntimeProvider } from "./workspace-runtime-provider";

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const candidateAssessmentId = pathname.match(/^\/assessments\/([^/]+)/)?.[1];
  const assessmentId =
    candidateAssessmentId === "new" ? undefined : candidateAssessmentId;
  const sections: AppShellNavigationSection[] = [
    {
      label: t("pages.appShell.workspaceNavigation"),
      kind: "workspace",
      items: localizeNavigation(primaryNavigation),
    },
  ];

  sections.push({
    label: t("pages.appShell.assessmentNavigation"),
    kind: "assessment",
    assessmentId,
    items: localizeNavigation(getAssessmentNavigation(assessmentId)),
  });

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as CSSProperties
      }
    >
      <WorkspaceRuntimeProvider>
        <Suspense fallback={null}>
          <AppSidebar sections={sections} />
        </Suspense>
        <SidebarInset>
          <AppHeader />
          <div className="@container/main flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </SidebarInset>
      </WorkspaceRuntimeProvider>
    </SidebarProvider>
  );
}

function localizeNavigation(
  definitions: ReadonlyArray<{
    href: string;
    labelKey: string;
    icon: AppShellNavigationItem["icon"];
    exact?: boolean;
    disabled?: boolean;
  }>,
): AppShellNavigationItem[] {
  return definitions.map((item) => ({
    href: item.href,
    label: t(item.labelKey),
    icon: item.icon,
    exact: item.exact,
    disabled: item.disabled,
    disabledReason: item.disabled
      ? t("pages.appShell.selectAssessmentFirst")
      : undefined,
  }));
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
