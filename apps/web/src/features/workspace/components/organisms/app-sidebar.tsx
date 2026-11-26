"use client";

import Link from "next/link";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import {
  LCSP_LOGO_SIZES,
  LCSP_LOGO_VARIANTS,
} from "@/components/types/lcsp-logo.types";
import { getAssessmentActiveHref } from "@/lib/api/workspace-client";
import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "@/features/settings/types/settings.types";
import { resolveAppMessage } from "@/lib/i18n";
import { primaryNavigation } from "../../config/app-shell-navigation";

import {
  DEFAULT_RECENT_FILTERS,
  SIDEBAR_NAV_ITEM_VARIANTS,
  SIDEBAR_RECENT_LOAD_STATES,
  type RecentFilterKey,
  type RecentFilters,
  type SidebarRecentLoadState,
} from "../../types/recent-filter.types";
import type { AssessmentSummary } from "../../types/workspace.types";
import { getVisibleRecentAssessments } from "../../utils/recent-filter-utils";
import { RecentAssessmentItem } from "../molecules/recent-assessment-item";
import { RecentEmptyMessage } from "../molecules/recent-empty-message";
import { RecentFilterPopover } from "../molecules/recent-filter-popover";
import { SidebarAccountMount } from "../molecules/sidebar-account-mount";
import { SidebarHeaderControls } from "../molecules/sidebar-header-controls";
import { SidebarNavItem } from "../molecules/sidebar-nav-item";

export { SIDEBAR_RECENT_LOAD_STATES } from "../../types/recent-filter.types";

type AppSidebarProps = {
  assessments: AssessmentSummary[];
  onNavigate?: () => void;
  onBack: () => void;
  onForward: () => void;
  onSignOut: () => void;
  onOpenSettings?: (section: SettingsSectionId) => void;
  onSearch: () => void;
  onToggleCollapse: () => void;
  pathname: string;
  recentLoadState?: SidebarRecentLoadState;
  signOutPending: boolean;
  userName?: string;
  accountControl?: ReactNode;
};

export function AppSidebar({
  accountControl,
  assessments,
  onBack,
  onForward,
  onNavigate,
  onSignOut,
  onOpenSettings,
  onSearch,
  onToggleCollapse,
  pathname,
  recentLoadState = SIDEBAR_RECENT_LOAD_STATES.idle,
  signOutPending,
  userName,
}: AppSidebarProps) {
  const [filters, setFilters] = useState<RecentFilters>(DEFAULT_RECENT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const resolvedUserName =
    userName?.trim() || resolveAppMessage("pages.appShell.productName");
  const userInitial = resolvedUserName.slice(0, 1).toUpperCase();
  const recentAssessments = useMemo(
    () => getVisibleRecentAssessments(assessments, filters),
    [assessments, filters],
  );
  const newActive = pathname === "/assessments/new";

  function updateFilter<Value extends string>(
    key: RecentFilterKey,
    value: Value,
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <nav
      aria-label={resolveAppMessage("pages.appShell.workspaceNavigation")}
      className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground"
      data-component="AppSidebar"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3 py-3">
        <Link
          href="/workspace"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <LCSPLogo
            variant={LCSP_LOGO_VARIANTS.mark}
            size={LCSP_LOGO_SIZES.md}
          />
          <div className="min-w-0">
            <p className="truncate text-base leading-tight font-semibold text-sidebar-foreground">
              {resolveAppMessage("pages.appShell.productName")}
            </p>
            <p className="truncate text-xs leading-tight text-sidebar-foreground/65">
              {resolveAppMessage("pages.appShell.workspaceNavigation")}
            </p>
          </div>
        </Link>
      </div>

      <SidebarHeaderControls
        onBack={onBack}
        onForward={onForward}
        onSearch={onSearch}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="shrink-0 px-2.5 pt-3">
        <p className="mb-1.5 px-2.5 text-xs font-semibold text-sidebar-foreground/65">
          {resolveAppMessage("pages.appShell.platformSection")}
        </p>
        <div className="flex flex-col gap-0.5">
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const label = resolveAppMessage(
              item.labelKey as Parameters<typeof resolveAppMessage>[0],
            );
            return (
              <SidebarNavItem
                key={item.href}
                active={active}
                href={item.href}
                icon={<Icon className="size-4" />}
                label={label}
                tooltip={label}
                variant={SIDEBAR_NAV_ITEM_VARIANTS.nav}
                onNavigate={onNavigate}
              />
            );
          })}
          {onOpenSettings ? (
            <SidebarNavItem
              active={pathname === "/workspace/settings"}
              icon={<SettingsIcon className="size-4" />}
              label={resolveAppMessage("pages.appShell.settings")}
              tooltip={resolveAppMessage("pages.appShell.settings")}
              variant={SIDEBAR_NAV_ITEM_VARIANTS.nav}
              onClick={() => onOpenSettings(SETTINGS_SECTION_IDS.general)}
            />
          ) : null}
        </div>

        <SidebarNavItem
          active={newActive}
          className="mt-2.5"
          href="/assessments/new"
          icon={
            <span className="flex size-4.5 items-center justify-center rounded-full border border-sidebar-border">
              <PlusIcon className="size-3" />
            </span>
          }
          label={resolveAppMessage("pages.appShell.new")}
          onNavigate={onNavigate}
          variant={SIDEBAR_NAV_ITEM_VARIANTS.new}
        />
      </div>

      <section className="mt-3.5 flex min-h-0 flex-1 flex-col overflow-hidden px-2.5 pb-3">
        <div className="flex h-7 shrink-0 items-center">
          <h2 className="ml-2 flex-1 text-[13px] leading-none font-medium text-sidebar-foreground/60">
            {resolveAppMessage("pages.appShell.recents")}
          </h2>
          <RecentFilterPopover
            filters={filters}
            onOpenChange={setFilterOpen}
            onUpdateFilter={updateFilter}
            open={filterOpen}
          />
        </div>

        {recentLoadState === SIDEBAR_RECENT_LOAD_STATES.loading ? (
          <RecentEmptyMessage
            open={filterOpen}
            text={resolveAppMessage("pages.appShell.recentFilter.loading")}
          />
        ) : recentLoadState === SIDEBAR_RECENT_LOAD_STATES.error ? (
          <RecentEmptyMessage
            open={filterOpen}
            text={resolveAppMessage("pages.appShell.recentFilter.error")}
          />
        ) : recentAssessments.length > 0 ? (
          <div
            data-slot="sidebar-recents-scroll"
            className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain"
          >
            {recentAssessments.map((assessment) => (
              <RecentAssessmentItem
                key={assessment.id}
                active={pathname === getAssessmentActiveHref(assessment)}
                assessment={assessment}
                onNavigate={onNavigate}
                suppressHover={filterOpen}
              />
            ))}
          </div>
        ) : (
          <RecentEmptyMessage
            open={filterOpen}
            text={resolveAppMessage("pages.appShell.recentFilter.empty")}
          />
        )}
      </section>

      <div
        className="mt-auto shrink-0 px-2.5 pb-2.5"
        data-lcsp268-account-mount="true"
      >
        {accountControl ?? (
          <SidebarAccountMount
            onOpenSettings={onOpenSettings}
            onSignOut={onSignOut}
            signOutPending={signOutPending}
            userInitial={userInitial}
            userName={resolvedUserName}
          />
        )}
      </div>
    </nav>
  );
}
