"use client";

import { resolveMessage } from "@lcsp/i18n";
import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { deriveAssessmentFlowRuntime } from "@/features/assessment-flow/utils/assessment-flow-runtime";
import { useSignOutMutation } from "@/lib/api/auth-queries";
import { useAssessmentInterviewStateQuery } from "@/lib/api/assessment-queries";
import { SettingsModal } from "@/features/settings/components/organisms/settings-modal";
import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "@/features/settings/types/settings.types";
import {
  useAssessmentsQuery,
  useWorkspaceQuery,
} from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type {
  AppShellNavigationItem,
  AppShellNavigationSection,
} from "../../types/app-shell.types";
import {
  ASSESSMENT_LEFT_SIDEBAR_STATES,
  ASSESSMENT_RIGHT_PANEL_STATES,
  ASSESSMENT_SHELL_SCREENS,
  type AssessmentShellState,
} from "../../types/assessment-shell-state.types";
import { normalizeAssessmentRuntime } from "../../utils/assessment-runtime-adapter";
import { selectAssessmentRuntimeSidebarPresentation } from "../../utils/assessment-runtime-selectors";
import { AppSidebar, SIDEBAR_RECENT_LOAD_STATES } from "./app-sidebar";
import {
  AssessmentRightPanelSlot,
  CenterContentSlot,
  LeftSidebarSlot,
} from "./assessment-shell-slots";
import { AssessmentRuntimeSidebar } from "./assessment-runtime-sidebar";
import { SidebarHeaderControls } from "../molecules/sidebar-header-controls";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";

type AssessmentAppShellProps = {
  assessmentId?: string;
  children: ReactNode;
  sections: AppShellNavigationSection[];
};

export function AssessmentAppShell({
  assessmentId,
  children,
  sections,
}: AssessmentAppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const routeScreen = getRouteScreen(pathname, assessmentId);
  const [shellState, setShellState] = useState<AssessmentShellState>(() => ({
    screen: routeScreen,
    leftSidebar: ASSESSMENT_LEFT_SIDEBAR_STATES.open,
    rightPanel: assessmentId
      ? ASSESSMENT_RIGHT_PANEL_STATES.open
      : ASSESSMENT_RIGHT_PANEL_STATES.closed,
  }));
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [mobileRuntimeOpen, setMobileRuntimeOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>(SETTINGS_SECTION_IDS.general);
  const signOutMutation = useSignOutMutation();
  const assessmentsQuery = useAssessmentsQuery();
  const workspaceQuery = useWorkspaceQuery();
  const runtime = useWorkspaceRuntime();
  const assessments =
    assessmentsQuery.data?.kind === "loaded"
      ? assessmentsQuery.data.assessments
      : [];
  const workspace =
    workspaceQuery.data?.kind === "loaded"
      ? workspaceQuery.data.workspace
      : undefined;
  const recentLoadState = assessmentsQuery.isLoading
    ? SIDEBAR_RECENT_LOAD_STATES.loading
    : assessmentsQuery.data?.kind === "error"
      ? SIDEBAR_RECENT_LOAD_STATES.error
      : SIDEBAR_RECENT_LOAD_STATES.idle;
  const assessmentSection = sections.find(
    (section) => section.kind === "assessment",
  );
  const workspaceSection = sections.find(
    (section) => section.kind === "workspace",
  );
  const assessment = assessmentId
    ? assessments.find((item) => item.id === assessmentId)
    : undefined;
  const activeAssessmentItem = assessmentSection?.items.find((item) =>
    isNavigationItemActive(pathname, item),
  );
  const activeWorkspaceItem = workspaceSection?.items.find((item) =>
    isNavigationItemActive(pathname, item),
  );
  const headerEyebrow =
    assessment?.name ??
    workspaceSection?.label ??
    t("pages.appShell.workspaceNavigation");
  const headerTitle =
    activeAssessmentItem?.label ??
    activeWorkspaceItem?.label ??
    getFallbackHeaderTitle(pathname);
  const effectiveShellState: AssessmentShellState = {
    ...shellState,
    screen: routeScreen,
    rightPanel: assessmentId
      ? shellState.rightPanel
      : ASSESSMENT_RIGHT_PANEL_STATES.closed,
  };
  const leftCollapsed =
    effectiveShellState.leftSidebar ===
    ASSESSMENT_LEFT_SIDEBAR_STATES.collapsed;
  const rightPanelOpen =
    Boolean(assessmentId) &&
    effectiveShellState.rightPanel === ASSESSMENT_RIGHT_PANEL_STATES.open;

  async function handleSignOut() {
    await signOutMutation.mutateAsync();
    window.location.assign("/sign-in");
  }

  function toggleLeftSidebar() {
    setShellState((current) => ({
      ...current,
      leftSidebar:
        current.leftSidebar === ASSESSMENT_LEFT_SIDEBAR_STATES.open
          ? ASSESSMENT_LEFT_SIDEBAR_STATES.collapsed
          : ASSESSMENT_LEFT_SIDEBAR_STATES.open,
    }));
  }

  function toggleRightPanel() {
    setShellState((current) => ({
      ...current,
      rightPanel:
        current.rightPanel === ASSESSMENT_RIGHT_PANEL_STATES.open
          ? ASSESSMENT_RIGHT_PANEL_STATES.closed
          : ASSESSMENT_RIGHT_PANEL_STATES.open,
    }));
  }

  function openAssessmentSearch() {
    window.dispatchEvent(new Event("lcsp:search-assessments"));
  }

  function openSettings(section: SettingsSectionId) {
    setActiveSettingsSection(section);
    setSettingsModalOpen(true);
    setMobileNavigationOpen(false);
  }

  const navigation = (
    <AppSidebar
      assessments={assessments}
      onBack={() => router.back()}
      onForward={() => router.forward()}
      onNavigate={() => setMobileNavigationOpen(false)}
      onSearch={openAssessmentSearch}
      onSignOut={() => void handleSignOut()}
      onOpenSettings={openSettings}
      onToggleCollapse={() => setMobileNavigationOpen(false)}
      pathname={pathname}
      recentLoadState={recentLoadState}
      signOutPending={signOutMutation.isPending}
      userName={workspace?.user.display_name}
    />
  );

  return (
    <div
      className="flex h-svh min-h-0 w-full overflow-hidden bg-background"
      data-shell-screen={effectiveShellState.screen}
      data-left-sidebar={effectiveShellState.leftSidebar}
      data-right-panel={effectiveShellState.rightPanel}
    >
      <LeftSidebarSlot collapsed={leftCollapsed}>
        <AppSidebar
          assessments={assessments}
          onBack={() => router.back()}
          onForward={() => router.forward()}
          onSearch={openAssessmentSearch}
          onSignOut={() => void handleSignOut()}
          onOpenSettings={openSettings}
          onToggleCollapse={toggleLeftSidebar}
          pathname={pathname}
          recentLoadState={recentLoadState}
          signOutPending={signOutMutation.isPending}
          userName={workspace?.user.display_name}
        />
      </LeftSidebarSlot>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-4 lg:px-5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileNavigationOpen(true)}
            aria-label={t("pages.appShell.sidebarToggle")}
            className="lg:hidden"
          >
            <PanelLeftIcon />
          </Button>

          {leftCollapsed ? (
            <SidebarHeaderControls
              className="hidden px-0 lg:-ml-2 lg:flex"
              onBack={() => router.back()}
              onForward={() => router.forward()}
              onSearch={openAssessmentSearch}
              onToggleCollapse={toggleLeftSidebar}
              showDivider={false}
            />
          ) : null}

          <div
            className={cn("min-w-0 flex-1", leftCollapsed ? "ml-8" : "ml-2")}
          >
            <p className="truncate text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {headerEyebrow}
            </p>
            {!assessmentId ? (
              <p className="truncate text-sm font-semibold text-foreground">
                {headerTitle}
              </p>
            ) : null}
          </div>

          {assessmentId ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileRuntimeOpen(true)}
                aria-label={t("pages.appShell.runtimePanelTitle")}
                className="xl:hidden"
              >
                <PanelRightIcon />
              </Button>
              <Button
                type="button"
                variant={rightPanelOpen ? "secondary" : "ghost"}
                size="icon-sm"
                onClick={toggleRightPanel}
                aria-label={t("pages.appShell.runtimePanelTitle")}
                aria-pressed={rightPanelOpen}
                className="hidden xl:inline-flex"
              >
                <PanelRightIcon />
              </Button>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 bg-muted/10">
          <CenterContentSlot assessmentId={assessmentId}>
            {children}
          </CenterContentSlot>

          {assessmentId ? (
            <AssessmentRightPanelSlot open={rightPanelOpen}>
              <AssessmentRuntimePanel
                assessmentId={assessmentId}
                runtime={runtime}
              />
            </AssessmentRightPanelSlot>
          ) : null}
        </div>
      </div>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="w-[min(88vw,320px)] p-0 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("pages.appShell.mobileTitle")}</SheetTitle>
            <SheetDescription>
              {t("pages.appShell.mobileDescription")}
            </SheetDescription>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>

      {assessmentId ? (
        <Sheet open={mobileRuntimeOpen} onOpenChange={setMobileRuntimeOpen}>
          <SheetContent side="right" className="w-[min(92vw,420px)] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("pages.appShell.runtimePanelTitle")}</SheetTitle>
              <SheetDescription>{headerEyebrow}</SheetDescription>
            </SheetHeader>
            <AssessmentRuntimePanel
              assessmentId={assessmentId}
              runtime={runtime}
            />
          </SheetContent>
        </Sheet>
      ) : null}

      <SettingsModal
        activeSection={activeSettingsSection}
        onOpenChange={setSettingsModalOpen}
        onSectionChange={setActiveSettingsSection}
        open={settingsModalOpen}
      />
    </div>
  );
}

function AssessmentRuntimePanel({
  assessmentId,
  runtime,
}: {
  assessmentId: string;
  runtime: ReturnType<typeof useWorkspaceRuntime>;
}) {
  const timeline = runtime.getAssessmentRuntime(assessmentId);
  const repository =
    runtime.repositorySnapshots.find(
      (item) => item.assessmentId === assessmentId,
    ) ?? null;
  const scanJob =
    runtime.scanJobs.find((item) => item.assessmentId === assessmentId) ?? null;
  const evidenceReport =
    runtime.evidenceReports.find(
      (item) => item.assessmentId === assessmentId,
    ) ?? null;
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: Boolean(repository),
    snapshot: repository,
    scanJob,
    evidenceReport,
    recentActivity: timeline.recentActivity,
  });
  const interviewQuery = useAssessmentInterviewStateQuery(
    assessmentId,
    flow.evidenceAccepted,
  );
  const normalized = normalizeAssessmentRuntime({
    assessmentId,
    interviewState: interviewQuery,
    timeline,
  });
  const presentation = selectAssessmentRuntimeSidebarPresentation(normalized, {
    repository,
    scanner: {
      evidenceAccepted: flow.evidenceAccepted,
      scanFailed: flow.scanFailed,
      programEvidenceSummary: flow.programEvidenceSummary,
    },
  });

  return <AssessmentRuntimeSidebar presentation={presentation} />;
}

function isNavigationItemActive(
  pathname: string,
  item: AppShellNavigationItem,
) {
  const [itemPath] = item.href.split("#");
  if (item.exact) return pathname === itemPath;
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function getRouteScreen(
  pathname: string,
  assessmentId?: string,
): AssessmentShellState["screen"] {
  if (assessmentId) return ASSESSMENT_SHELL_SCREENS.assessment;
  if (pathname === "/laws" || pathname.startsWith("/laws/")) {
    return ASSESSMENT_SHELL_SCREENS.legal;
  }
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) {
    return ASSESSMENT_SHELL_SCREENS.workspace;
  }
  if (pathname === "/assessments/new") return ASSESSMENT_SHELL_SCREENS.create;
  return ASSESSMENT_SHELL_SCREENS.directory;
}

function getFallbackHeaderTitle(pathname: string) {
  if (pathname === "/workspace/settings") return t("pages.appShell.settings");
  if (pathname === "/laws" || pathname.startsWith("/laws/")) {
    return t("pages.appShell.legalLibrary");
  }
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) {
    return t("pages.appShell.overview");
  }
  return t("pages.appShell.assessments");
}
