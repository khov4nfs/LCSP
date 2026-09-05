"use client";

import { resolveMessage } from "@lcsp/i18n";
import { usePathname } from "next/navigation";

import { appLocale } from "@/lib/locale";

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
          key={assessmentId ?? getAppShellKey(pathname)}
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

function getAppShellKey(pathname: string) {
  if (pathname === "/workspace") return "workspace";
  if (pathname === "/assessments/new") return "assessment-create";
  return "assessment-directory";
}
