"use client";

import { resolveMessage } from "@lcsp/i18n";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ChevronDownIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useSignOutMutation } from "@/lib/api/auth-queries";
import {
  useAssessmentsQuery,
  useWorkspaceQuery,
} from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";
import { settingsNavigationItems } from "@/features/settings/config/settings-navigation";
import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "@/features/settings/types/settings.types";

import type { AppShellNavigationSection } from "../../types/app-shell.types";
import type { AssessmentSummary } from "../../types/workspace.types";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";
import { AssessmentRuntimeSidebarPanel } from "./assessment-runtime-sidebar-panel";
import { SidebarAssessmentList } from "../molecules/sidebar-assessment-list";
import { WorkspaceSwitcher } from "../molecules/workspace-switcher";

export function AppSidebar({
  sections,
}: {
  sections: AppShellNavigationSection[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [currentHash, setCurrentHash] = useState("");
  const signOutMutation = useSignOutMutation();
  const workspaceQuery = useWorkspaceQuery();
  const assessmentsQuery = useAssessmentsQuery();
  const workspace =
    workspaceQuery.data?.kind === "loaded"
      ? workspaceQuery.data.workspace
      : undefined;
  const assessments =
    assessmentsQuery.data?.kind === "loaded"
      ? assessmentsQuery.data.assessments
      : undefined;
  const isSettingsRoute = pathname === "/workspace/settings";
  const requestedSettingsSection = searchParams.get("section");
  const activeSettingsSection = isSettingsSectionId(requestedSettingsSection)
    ? requestedSettingsSection
    : SETTINGS_SECTION_IDS.passwordAndAuthentication;
  const [settingsOpenOverride, setSettingsOpenOverride] = useState<
    boolean | null
  >(null);
  const settingsOpen = settingsOpenOverride ?? isSettingsRoute;
  const runtime = useWorkspaceRuntime();

  async function handleSignOut() {
    await signOutMutation.mutateAsync();
    window.location.assign("/sign-in");
  }

  useEffect(() => {
    function syncHash() {
      setCurrentHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);

    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  return (
    <Sidebar
      collapsible="offcanvas"
      variant="inset"
      mobileTitle={t("pages.appShell.mobileTitle")}
      mobileDescription={t("pages.appShell.mobileDescription")}
    >
      <SidebarHeader className="border-b border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/workspace" />}
              tooltip={t("pages.appShell.productName")}
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                <ShieldCheckIcon className="size-4" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">
                  {t("pages.appShell.productName")}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/65">
                  {t("pages.appShell.productTagline")}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {workspace && workspace.user.role !== AUTH_USER_ROLES.customer ? (
          <div className="px-2 pb-2">
            <p className="mb-1 px-2 text-xs font-semibold tracking-widest text-sidebar-foreground/55 uppercase">
              {t("pages.appShell.currentWorkspace")}
            </p>
            <WorkspaceSwitcher placement="sidebar" />
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section, index) => (
          <Fragment key={section.label}>
            <SidebarGroup>
              <SidebarGroupLabel>
                {resolveSectionLabel(section, assessments)}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const [itemPath, itemHash = ""] = item.href.split("#");
                    const active = itemHash
                      ? pathname === itemPath && currentHash === `#${itemHash}`
                      : item.exact
                        ? pathname === itemPath && currentHash === ""
                        : pathname.startsWith(itemPath);

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={active}
                          render={<Link href={item.href} />}
                          tooltip={item.disabledReason ?? item.label}
                          onClick={(event) => {
                            if (!item.disabled) return;
                            event.preventDefault();
                            toast.error(item.disabledReason);
                          }}
                          className={
                            item.disabled
                              ? "cursor-not-allowed opacity-55"
                              : undefined
                          }
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
                {section.kind === "assessment" && section.assessmentId ? (
                  <AssessmentRuntimeSidebarPanel
                    assessmentId={section.assessmentId}
                    timeline={{
                      ...runtime.getAssessmentRuntime(section.assessmentId),
                      connectionState: runtime.connectionState,
                    }}
                  />
                ) : null}
              </SidebarGroupContent>
            </SidebarGroup>
            {index === 0 ? <SidebarAssessmentList /> : null}
          </Fragment>
        ))}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible
                open={settingsOpen}
                onOpenChange={setSettingsOpenOverride}
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton
                        isActive={isSettingsRoute}
                        tooltip={t("pages.appShell.settings")}
                      />
                    }
                  >
                    <SettingsIcon />
                    <span>{t("pages.appShell.settings")}</span>
                    <ChevronDownIcon
                      className={`ml-auto size-4 transition-transform ${
                        settingsOpen ? "rotate-180" : ""
                      }`}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {settingsNavigationItems.map((item) => (
                        <SidebarMenuSubItem key={item.id}>
                          <SidebarMenuSubButton
                            isActive={activeSettingsSection === item.id}
                            render={
                              <Link
                                href={`/workspace/settings?section=${item.id}`}
                              />
                            }
                          >
                            <span>
                              {resolveMessage(appLocale, item.labelKey)}
                            </span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signOutMutation.isPending}
              tooltip={t("pages.appShell.signOut")}
              className="cursor-pointer"
            >
              <LogOutIcon className="text-destructive" />
              <span className="text-destructive">
                {t("pages.appShell.signOut")}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-sidebar-foreground/65">
          <ShieldCheckIcon className="size-4 text-sidebar-primary" />
          <span>{t("pages.appShell.secureWorkspace")}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function resolveSectionLabel(
  section: AppShellNavigationSection,
  assessments?: AssessmentSummary[],
) {
  if (section.kind !== "assessment") {
    return section.label;
  }

  if (!section.assessmentId) {
    return t("pages.appShell.chooseAssessmentToView");
  }

  return (
    assessments?.find((assessment) => assessment.id === section.assessmentId)
      ?.name ?? section.label
  );
}

function isSettingsSectionId(value: string | null): value is SettingsSectionId {
  return (
    value !== null &&
    (Object.values(SETTINGS_SECTION_IDS) as string[]).includes(value)
  );
}
