"use client";

import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSignOutMutation } from "@/lib/api/auth-queries";
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
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../../types/workspace-runtime.types";
import {
  connectionLabel,
  runStatusLabel,
  stageLabel,
} from "../../utils/assessment-runtime-formatter";
import { AppSidebar, SIDEBAR_RECENT_LOAD_STATES } from "./app-sidebar";
import {
  AssessmentRightPanelSlot,
  CenterContentSlot,
  LeftSidebarSlot,
} from "./assessment-shell-slots";
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

  const navigation = (
    <AppSidebar
      assessments={assessments}
      onBack={() => router.back()}
      onForward={() => router.forward()}
      onNavigate={() => setMobileNavigationOpen(false)}
      onSearch={openAssessmentSearch}
      onSignOut={() => void handleSignOut()}
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
            className={cn(
              "min-w-0 flex-1",
              leftCollapsed ? "ml-8" : "ml-2",
            )}
          >
            <p className="truncate text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {headerEyebrow}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {headerTitle}
            </p>
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
                assessmentName={assessment?.name}
                runtime={runtime}
                pathname={pathname}
                workflowItems={assessmentSection?.items ?? []}
                workflowLabel={assessmentSection?.label}
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
              assessmentName={assessment?.name}
              runtime={runtime}
              pathname={pathname}
              workflowItems={assessmentSection?.items ?? []}
              workflowLabel={assessmentSection?.label}
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function AssessmentRuntimePanel({
  assessmentId,
  assessmentName,
  pathname,
  runtime,
  workflowItems,
  workflowLabel,
}: {
  assessmentId: string;
  assessmentName?: string;
  pathname: string;
  runtime: ReturnType<typeof useWorkspaceRuntime>;
  workflowItems: AppShellNavigationItem[];
  workflowLabel?: string;
}) {
  const timeline = runtime.getAssessmentRuntime(assessmentId);
  const run = timeline.currentRun;
  const recentActivity = timeline.recentActivity.slice(0, 4);

  return (
    <div className="flex min-h-0 w-full flex-col bg-background/95">
      <div className="shrink-0 border-b border-border/70 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {assessmentName ?? t("pages.appShell.assessmentTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {workflowLabel ?? t("pages.appShell.assessmentNavigation")}
            </p>
          </div>
          <Badge
            variant={
              timeline.connectionState ===
              WORKSPACE_RUNTIME_CONNECTION_STATES.connected
                ? "default"
                : "secondary"
            }
          >
            {connectionLabel(timeline.connectionState)}
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {workflowItems.length > 0 ? (
          <AssessmentWorkflowTimeline
            items={workflowItems}
            pathname={pathname}
            label={workflowLabel ?? t("pages.appShell.assessmentNavigation")}
          />
        ) : null}

        <div
          className={cn(
            workflowItems.length > 0 && "mt-6 border-t border-border/60 pt-5",
          )}
        >
          <p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
            {t("pages.appShell.runtimePanelTitle")}
          </p>
          {run ? (
            <div className="rounded-xl border border-border/70 bg-card p-3.5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
                    {t("pages.appShell.runtimePanelLastUpdated")}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                    {stageLabel(run.stage)}
                  </p>
                </div>
                <Badge
                  variant={
                    run.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {runStatusLabel(run.status)}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              {t("pages.appShell.runtimePanelEmpty")}
            </div>
          )}
        </div>

        {recentActivity.length > 0 ? (
          <div className="mt-5">
            <p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
              {t("pages.appShell.runtimePanelRecentActivity")}
            </p>
            <div className="space-y-2">
              {recentActivity.map((activity, index) => (
                <div
                  key={`${activity.emittedAt}-${index}`}
                  className="rounded-xl border border-border/60 bg-card px-3 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full bg-foreground/40" />
                    <p className="truncate text-xs font-medium text-foreground">
                      {stageLabel(activity.stage)}
                    </p>
                  </div>
                  <p className="mt-1.5 line-clamp-2 pl-3.5 text-xs leading-5 text-muted-foreground">
                    {activity.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border/70 p-3">
        <button
          type="button"
          disabled
          className="flex h-9 w-full cursor-not-allowed items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-muted-foreground"
        >
          {t("pages.appShell.runtimePanelViewFull")}
        </button>
      </div>
    </div>
  );
}

function AssessmentWorkflowTimeline({
  items,
  label,
  pathname,
}: {
  items: AppShellNavigationItem[];
  label: string;
  pathname: string;
}) {
  return (
    <section aria-label={label}>
      <p className="mb-3 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <ol className="space-y-0.5">
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = isNavigationItemActive(pathname, item);
          const last = index === items.length - 1;

          return (
            <li key={item.href} className="relative flex min-h-10 gap-3">
              {!last ? (
                <span
                  aria-hidden="true"
                  className="absolute left-3.75 top-8 h-[calc(100%-20px)] w-px bg-border"
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background",
                  active
                    ? "border-foreground/25 bg-foreground text-background"
                    : "border-border text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <button
                type="button"
                disabled={item.disabled}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground",
                  item.disabled
                    ? "cursor-not-allowed opacity-45"
                    : "hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <span className="block truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
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
