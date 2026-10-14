"use client";

import { resolveMessage } from "@lcsp/i18n";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import type { Locale } from "@lcsp/contracts/shared";

import { getAppLocaleSnapshot, subscribeToAppLocale } from "@/lib/locale";

import {
  getAssessmentNavigation,
  primaryNavigation,
} from "../../config/app-shell-navigation";
import type {
  AppShellNavigationItem,
  AppShellNavigationSection,
  AppShellProps,
} from "../../types/app-shell.types";
import { AssessmentAppShell } from "./assessment-app-shell";
import { WorkspaceRuntimeProvider } from "./workspace-runtime-provider";

export function AppShell({ children }: AppShellProps) {
  const rawPathname = usePathname();
  const pathname = rawPathname ?? "/workspace";
  const locale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const candidateAssessmentId = pathname.match(/^\/assessments\/([^/]+)/)?.[1];
  const assessmentId =
    candidateAssessmentId === "new" ? undefined : candidateAssessmentId;
  const sections: AppShellNavigationSection[] = [
    {
      label: t("pages.appShell.workspaceNavigation", locale),
      kind: "workspace",
      items: localizeNavigation(primaryNavigation, locale),
    },
  ];

  sections.push({
    label: t("pages.appShell.assessmentNavigation", locale),
    kind: "assessment",
    assessmentId,
    items: localizeNavigation(getAssessmentNavigation(assessmentId), locale),
  });

  if (
    pathname === "/workspace" ||
    pathname.startsWith("/workspace/") ||
    pathname === "/assessments" ||
    pathname.startsWith("/assessments/") ||
    pathname === "/artifacts" ||
    pathname.startsWith("/artifacts/") ||
    pathname === "/laws" ||
    pathname.startsWith("/laws/")
  ) {
    return (
      <WorkspaceRuntimeProvider>
        <AssessmentAppShell
          key={`${assessmentId ?? getAppShellKey(pathname)}:${locale}`}
          sections={sections}
          assessmentId={assessmentId}
        >
          {children}
        </AssessmentAppShell>
      </WorkspaceRuntimeProvider>
    );
  }

  return <WorkspaceRuntimeProvider>{children}</WorkspaceRuntimeProvider>;
}

function localizeNavigation(
  definitions: ReadonlyArray<{
    href: string;
    labelKey: string;
    icon: AppShellNavigationItem["icon"];
    exact?: boolean;
    disabled?: boolean;
  }>,
  locale: Locale,
): AppShellNavigationItem[] {
  return definitions.map((item) => ({
    href: item.href,
    label: t(item.labelKey, locale),
    icon: item.icon,
    exact: item.exact,
    disabled: item.disabled,
    disabledReason: item.disabled
      ? t("pages.appShell.selectAssessmentFirst", locale)
      : undefined,
  }));
}

function t(key: string, locale: Locale) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
}

function getAppShellKey(pathname: string) {
  if (pathname === "/workspace") return "workspace";
  if (pathname === "/assessments/new") return "assessment-create";
  return "assessment-directory";
}
