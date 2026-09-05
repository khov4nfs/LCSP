import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const shellPath = new URL(
  "../src/features/workspace/components/organisms/assessment-app-shell.tsx",
  import.meta.url,
);
const appSidebarPath = new URL(
  "../src/features/workspace/components/organisms/app-sidebar.tsx",
  import.meta.url,
);
const sidebarNavItemPath = new URL(
  "../src/features/workspace/components/molecules/sidebar-nav-item.tsx",
  import.meta.url,
);
const recentAssessmentItemPath = new URL(
  "../src/features/workspace/components/molecules/recent-assessment-item.tsx",
  import.meta.url,
);
const recentEmptyMessagePath = new URL(
  "../src/features/workspace/components/molecules/recent-empty-message.tsx",
  import.meta.url,
);
const recentFilterTriggerPath = new URL(
  "../src/features/workspace/components/molecules/recent-filter-trigger.tsx",
  import.meta.url,
);
const recentFilterPopoverPath = new URL(
  "../src/features/workspace/components/molecules/recent-filter-popover.tsx",
  import.meta.url,
);
const recentFilterSubmenuPath = new URL(
  "../src/features/workspace/components/molecules/recent-filter-submenu.tsx",
  import.meta.url,
);
const sidebarAccountMountPath = new URL(
  "../src/features/workspace/components/molecules/sidebar-account-mount.tsx",
  import.meta.url,
);
const sidebarAccountTriggerPath = new URL(
  "../src/features/workspace/components/molecules/sidebar-account-trigger.tsx",
  import.meta.url,
);
const accountPopoverPath = new URL(
  "../src/features/workspace/components/molecules/account-popover.tsx",
  import.meta.url,
);
const accountPopoverItemPath = new URL(
  "../src/features/workspace/components/molecules/account-popover-item.tsx",
  import.meta.url,
);
const settingsModalPath = new URL(
  "../src/features/settings/components/organisms/settings-modal.tsx",
  import.meta.url,
);
const settingsSidebarPath = new URL(
  "../src/features/settings/components/organisms/settings-sidebar.tsx",
  import.meta.url,
);
const settingsTabPath = new URL(
  "../src/features/settings/components/molecules/settings-tab.tsx",
  import.meta.url,
);
const settingsTypesPath = new URL(
  "../src/features/settings/types/settings.types.ts",
  import.meta.url,
);
const settingsUtilsPath = new URL(
  "../src/features/settings/utils/settings-page.utils.ts",
  import.meta.url,
);
const sidebarHeaderControlsPath = new URL(
  "../src/features/workspace/components/molecules/sidebar-header-controls.tsx",
  import.meta.url,
);
const workspaceSwitcherPath = new URL(
  "../src/features/workspace/components/molecules/workspace-switcher.tsx",
  import.meta.url,
);
const uiSidebarPath = new URL(
  "../src/components/ui/sidebar.tsx",
  import.meta.url,
);
const agentsPath = new URL("../../../AGENTS.md", import.meta.url);
const recentFilterTypesPath = new URL(
  "../src/features/workspace/types/recent-filter.types.ts",
  import.meta.url,
);
const recentFilterOptionsPath = new URL(
  "../src/features/workspace/config/recent-filter-options.ts",
  import.meta.url,
);
const recentFilterUtilsPath = new URL(
  "../src/features/workspace/utils/recent-filter-utils.ts",
  import.meta.url,
);
const slotPath = new URL(
  "../src/features/workspace/components/organisms/assessment-shell-slots.tsx",
  import.meta.url,
);
const legacySidebarAssessmentListPath = new URL(
  "../src/features/workspace/components/molecules/sidebar-assessment-list.tsx",
  import.meta.url,
);
const statePath = new URL(
  "../src/features/workspace/types/assessment-shell-state.types.ts",
  import.meta.url,
);
const navigationPath = new URL(
  "../src/features/workspace/config/app-shell-navigation.ts",
  import.meta.url,
);
const workspaceClientPath = new URL(
  "../src/lib/api/workspace-client.ts",
  import.meta.url,
);
const appI18nPath = new URL("../src/lib/i18n.ts", import.meta.url);
const createAssessmentPath = new URL(
  "../src/features/workspace/components/organisms/create-assessment-form.tsx",
  import.meta.url,
);
const summaryCardPath = new URL(
  "../src/features/workspace/components/molecules/assessment-summary-card.tsx",
  import.meta.url,
);
const legacyRoutePaths = [
  "../src/app/(workspace)/assessments/[id]/readiness/page.tsx",
  "../src/app/(workspace)/assessments/[id]/technical-evidence/page.tsx",
  "../src/app/(workspace)/assessments/[id]/classification/page.tsx",
  "../src/app/(workspace)/assessments/[id]/documents/page.tsx",
  "../src/app/(workspace)/assessments/[id]/conflicts/page.tsx",
].map((path) => new URL(path, import.meta.url));

test("assessment app shell exposes the LCSP-267 state machine and slots", async () => {
  const [shellSource, slotSource, stateSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(slotPath, "utf8"),
    readFile(statePath, "utf8"),
  ]);

  assert.match(stateSource, /export type AssessmentShellState/);
  assert.match(stateSource, /ASSESSMENT_SHELL_SCREENS/);
  assert.match(stateSource, /workspace: "workspace"/);
  assert.match(stateSource, /legal: "legal"/);
  assert.match(stateSource, /ASSESSMENT_LEFT_SIDEBAR_STATES/);
  assert.match(stateSource, /ASSESSMENT_RIGHT_PANEL_STATES/);
  assert.match(shellSource, /const \[shellState, setShellState\]/);
  assert.match(shellSource, /data-shell-screen/);
  assert.match(slotSource, /export function LeftSidebarSlot/);
  assert.match(slotSource, /export function CenterContentSlot/);
  assert.match(slotSource, /export function AssessmentRightPanelSlot/);
});

test("workspace route uses the redesigned app shell instead of the legacy sidebar provider", async () => {
  const appShellSource = await readFile(
    new URL(
      "../src/features/workspace/components/organisms/app-shell.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(appShellSource.includes('pathname === "/workspace"'));
  assert.ok(appShellSource.includes('pathname.startsWith("/workspace/")'));
  assert.ok(appShellSource.includes('pathname === "/laws"'));
  assert.match(appShellSource, /<AssessmentAppShell/);
  assert.doesNotMatch(appShellSource, /SidebarProvider|AppSidebar|AppHeader/);
});

test("assessment app shell releases the left sidebar space completely when collapsed", async () => {
  const slotSource = await readFile(slotPath, "utf8");

  assert.match(slotSource, /w-55/);
  assert.match(slotSource, /if \(collapsed\) return null/);
  assert.doesNotMatch(slotSource, /w-14/);
  assert.doesNotMatch(slotSource, /icon|rail|collapsed.*w-/i);
  assert.match(slotSource, /w-105/);
  assert.match(slotSource, /min-w-0 flex-1/);
  assert.match(slotSource, /hidden .*lg:flex/);
  assert.match(slotSource, /hidden .*xl:flex/);
});

test("assessment app shell mounts the single shared LCSP-268 AppSidebar through the left slot", async () => {
  const [shellSource, sidebarSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(appSidebarPath, "utf8"),
  ]);

  assert.match(shellSource, /import \{ AppSidebar/);
  assert.match(shellSource, /<LeftSidebarSlot collapsed=\{leftCollapsed\}>/);
  assert.match(shellSource, /<AppSidebar/);
  const appSidebarInstances = shellSource
    .split("<AppSidebar")
    .slice(1)
    .map((source) => source.slice(0, source.indexOf("/>")));
  assert.ok(appSidebarInstances.length >= 2);
  for (const instance of appSidebarInstances) {
    assert.doesNotMatch(instance, /collapsed=/);
  }
  assert.doesNotMatch(sidebarSource, /collapsed: boolean/);
  assert.doesNotMatch(sidebarSource, /if \(collapsed\) return null/);
  assert.doesNotMatch(shellSource, /function AssessmentShellNavigation/);
  assert.doesNotMatch(shellSource, /<AssessmentShellNavigation/);
  assert.match(sidebarSource, /export function AppSidebar/);
  assert.doesNotMatch(
    sidebarSource,
    /WorkspaceSwitcher|SidebarAssessmentList|SidebarProvider/,
  );
  assert.match(sidebarSource, /RecentAssessmentItem/);
  assert.match(sidebarSource, /RecentFilterPopover/);
  assert.match(sidebarSource, /SidebarAccountMount/);
  assert.match(sidebarSource, /SidebarHeaderControls/);
  assert.match(sidebarSource, /SidebarNavItem/);
  await assert.rejects(readFile(legacySidebarAssessmentListPath, "utf8"), {
    code: "ENOENT",
  });
});

test("app sidebar keeps LCSP-268 navigation contracts without legacy assessment routes", async () => {
  const [sidebarSource, navItemSource, recentItemSource] = await Promise.all([
    readFile(appSidebarPath, "utf8"),
    readFile(sidebarNavItemPath, "utf8"),
    readFile(recentAssessmentItemPath, "utf8"),
  ]);
  const combined = [sidebarSource, navItemSource, recentItemSource].join("\n");

  assert.match(sidebarSource, /href="\/assessments\/new"/);
  assert.match(combined, /getAssessmentActiveHref\(assessment\)/);
  assert.match(combined, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(sidebarSource, /href="\/artifacts"/);
  assert.match(sidebarSource, /active={artifactsActive}/);
  assert.match(navItemSource, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.doesNotMatch(
    combined,
    /\/(?:wizard|readiness|technical-evidence|classification|documents|conflicts)/,
  );
});

test("app shell renders top controls through shell-owned sidebar state", async () => {
  const [shellSource, sidebarSource, headerControlsSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(appSidebarPath, "utf8"),
    readFile(sidebarHeaderControlsPath, "utf8"),
  ]);

  assert.match(sidebarSource, /<SidebarHeaderControls/);
  assert.match(shellSource, /import \{ SidebarHeaderControls/);
  assert.match(shellSource, /leftCollapsed \? \(/);
  assert.match(shellSource, /showDivider=\{false\}/);
  assert.match(shellSource, /className="hidden px-0 lg:-ml-2 lg:flex"/);
  assert.match(shellSource, /leftCollapsed \? "ml-8" : "ml-2"/);
  assert.doesNotMatch(shellSource, /aria-pressed=\{!leftCollapsed\}/);
  assert.match(headerControlsSource, /export function SidebarHeaderControls/);
  assert.match(headerControlsSource, /PanelLeftIcon/);
  assert.match(headerControlsSource, /SearchIcon/);
  assert.match(headerControlsSource, /ArrowLeftIcon/);
  assert.match(headerControlsSource, /ArrowRightIcon/);
  assert.match(headerControlsSource, /flex h-13/);
  assert.match(headerControlsSource, /size="icon"/);
  assert.match(headerControlsSource, /data-icon="inline-start"/);
  assert.match(shellSource, /onToggleCollapse=\{toggleLeftSidebar\}/);
  assert.match(shellSource, /onBack=\{\(\) => router\.back\(\)\}/);
  assert.match(shellSource, /onForward=\{\(\) => router\.forward\(\)\}/);
  assert.match(shellSource, /lcsp:search-assessments/);
});

test("app sidebar exposes the Figma sidebar item state contracts", async () => {
  const [sidebarSource, navItemSource, recentItemSource] = await Promise.all([
    readFile(appSidebarPath, "utf8"),
    readFile(sidebarNavItemPath, "utf8"),
    readFile(recentAssessmentItemPath, "utf8"),
  ]);

  assert.match(sidebarSource, /SIDEBAR_NAV_ITEM_VARIANTS\.new/);
  assert.match(navItemSource, /export function SidebarNavItem/);
  assert.match(recentItemSource, /export function RecentAssessmentItem/);
  assert.match(navItemSource, /hover:bg-sidebar-accent/);
  assert.match(navItemSource, /bg-sidebar-accent/);
  assert.match(navItemSource, /text-sidebar-accent-foreground/);
  assert.match(recentItemSource, /bg-sidebar-accent/);
  assert.match(
    recentItemSource,
    /hover:border-sidebar-border hover:bg-sidebar-accent/,
  );
  assert.match(recentItemSource, /h-8\.5/);
});

test("recent filter popover renders main rows, submenus, and preserved selection state", async () => {
  const [popoverSource, submenuSource, triggerSource, optionsSource] =
    await Promise.all([
      readFile(recentFilterPopoverPath, "utf8"),
      readFile(recentFilterSubmenuPath, "utf8"),
      readFile(recentFilterTriggerPath, "utf8"),
      readFile(recentFilterOptionsPath, "utf8"),
    ]);
  const combined = [
    popoverSource,
    submenuSource,
    triggerSource,
    optionsSource,
  ].join("\n");

  assert.match(triggerSource, /export const RecentFilterTrigger = forwardRef/);
  assert.match(popoverSource, /export function RecentFilterPopover/);
  assert.match(submenuSource, /export function RecentFilterSubmenu/);
  assert.match(triggerSource, /SlidersHorizontalIcon/);
  assert.match(triggerSource, /data-recent-filter-trigger="true"/);
  assert.match(submenuSource, /DropdownMenuSubTrigger/);
  assert.match(submenuSource, /DropdownMenuSubContent/);
  assert.match(submenuSource, /DropdownMenuGroup/);
  assert.match(submenuSource, /DropdownMenuRadioGroup/);
  assert.match(submenuSource, /DropdownMenuRadioItem/);
  assert.match(combined, /labels\.type/);
  assert.match(combined, /labels\.status/);
  assert.match(combined, /labels\.lastActivity/);
  assert.match(combined, /labels\.groupBy/);
  assert.match(combined, /labels\.sortBy/);
  assert.match(submenuSource, /value=\{selectedValue\}/);
  assert.match(submenuSource, /onValueChange/);
  assert.match(submenuSource, /option\.value === selectedValue/);
  assert.doesNotMatch(combined, /z-\[/);
});

test("recent filter empty and hover-through states are explicitly handled", async () => {
  const [sidebarSource, recentItemSource, emptyMessageSource] =
    await Promise.all([
      readFile(appSidebarPath, "utf8"),
      readFile(recentAssessmentItemPath, "utf8"),
      readFile(recentEmptyMessagePath, "utf8"),
    ]);
  const combined = [sidebarSource, recentItemSource, emptyMessageSource].join(
    "\n",
  );

  assert.match(sidebarSource, /recentFilter\.empty/);
  assert.match(sidebarSource, /recentFilter\.loading/);
  assert.match(sidebarSource, /recentFilter\.error/);
  assert.match(recentItemSource, /data-hover-suppressed/);
  assert.match(sidebarSource, /suppressHover=\{filterOpen\}/);
  assert.match(combined, /open \? "mt-47" : "mt-7"/);
});

test("account mount remains available for the LCSP-269 account controls", async () => {
  const [sidebarSource, accountMountSource, triggerSource, popoverSource] =
    await Promise.all([
      readFile(appSidebarPath, "utf8"),
      readFile(sidebarAccountMountPath, "utf8"),
      readFile(sidebarAccountTriggerPath, "utf8"),
      readFile(accountPopoverPath, "utf8"),
    ]);

  assert.match(sidebarSource, /accountControl\?: ReactNode/);
  assert.match(sidebarSource, /data-lcsp268-account-mount="true"/);
  assert.match(sidebarSource, /<SidebarAccountMount/);
  assert.match(accountMountSource, /<SidebarAccountTrigger/);
  assert.match(accountMountSource, /<AccountPopover/);
  assert.match(triggerSource, /data-component="SidebarAccountTrigger"/);
  assert.match(triggerSource, /aria-expanded=\{open\}/);
  assert.match(triggerSource, /aria-haspopup="menu"/);
  assert.match(triggerSource, /open \? ChevronUpIcon : ChevronDownIcon/);
  assert.match(popoverSource, /data-component="AccountPopover"/);
  assert.match(popoverSource, /side="top"/);
  assert.match(popoverSource, /sideOffset=\{8\}/);
  assert.match(popoverSource, /pages\.appShell\.settings/);
  assert.match(popoverSource, /pages\.appShell\.language/);
  assert.match(popoverSource, /pages\.appShell\.getHelp/);
  assert.match(popoverSource, /pages\.appShell\.documentation/);
  assert.match(popoverSource, /pages\.appShell\.learnMore/);
  assert.match(popoverSource, /pages\.appShell\.signOut/);
  assert.doesNotMatch(accountMountSource, /workspace\/settings#repositories/);
  assert.doesNotMatch(accountMountSource, /window\.location/);
});

test("LCSP-269 account popover uses one reusable menu item and existing sign-out", async () => {
  const [mountSource, popoverSource, itemSource] = await Promise.all([
    readFile(sidebarAccountMountPath, "utf8"),
    readFile(accountPopoverPath, "utf8"),
    readFile(accountPopoverItemPath, "utf8"),
  ]);

  assert.match(itemSource, /export function AccountPopoverItem/);
  assert.match(itemSource, /<DropdownMenuItem/);
  assert.match(itemSource, /data-component="AccountPopoverItem"/);
  assert.equal((popoverSource.match(/<AccountPopoverItem/g) ?? []).length, 6);
  assert.match(mountSource, /onSignOut=\{onSignOut\}/);
  assert.match(mountSource, /SETTINGS_SECTION_IDS\.general/);
  assert.match(mountSource, /setOpen\(false\)/);
});

test("LCSP-269 settings modal is owned by the shared app shell", async () => {
  const [shellSource, modalSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(settingsModalPath, "utf8"),
  ]);

  assert.match(shellSource, /import \{ SettingsModal \}/);
  assert.match(
    shellSource,
    /const \[settingsModalOpen, setSettingsModalOpen\]/,
  );
  assert.match(
    shellSource,
    /const \[activeSettingsSection, setActiveSettingsSection\]/,
  );
  assert.match(
    shellSource,
    /function openSettings\(section: SettingsSectionId\)/,
  );
  assert.match(shellSource, /onOpenSettings=\{openSettings\}/);
  assert.match(shellSource, /<SettingsModal/);
  assert.match(
    modalSource,
    /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/,
  );
  assert.match(modalSource, /max-w-295/);
  assert.match(modalSource, /max-h-205/);
  assert.match(modalSource, /<SettingsPage/);
  assert.doesNotMatch(shellSource, /router\.push\(`?\/workspace\/settings/);
});

test("LCSP-269 settings navigation exposes the seven approved tabs and legacy mapping", async () => {
  const [typesSource, sidebarSource, tabSource, utilsSource] =
    await Promise.all([
      readFile(settingsTypesPath, "utf8"),
      readFile(settingsSidebarPath, "utf8"),
      readFile(settingsTabPath, "utf8"),
      readFile(settingsUtilsPath, "utf8"),
    ]);

  for (const section of [
    "general",
    "account",
    "privacy",
    "billing",
    "usage",
    "capabilities",
    "connectors",
  ]) {
    assert.match(typesSource, new RegExp(`${section}: "${section}"`));
  }

  assert.match(tabSource, /export function SettingsTab/);
  assert.match(tabSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(sidebarSource, /data-component="SettingsSidebar"/);
  assert.match(sidebarSource, /data-component="SettingsTabs"/);
  assert.match(utilsSource, /LEGACY_SETTINGS_SECTION_IDS\.repositories/);
  assert.match(utilsSource, /return SETTINGS_SECTION_IDS\.connectors/);
  assert.match(utilsSource, /return SETTINGS_SECTION_IDS\.general/);
});

test("LCSP-268 sidebar is split into feature atomic files", async () => {
  const [
    sidebarSource,
    navItemSource,
    recentItemSource,
    filterTriggerSource,
    filterPopoverSource,
    filterSubmenuSource,
    headerControlsSource,
    typesSource,
    optionsSource,
    utilsSource,
  ] = await Promise.all([
    readFile(appSidebarPath, "utf8"),
    readFile(sidebarNavItemPath, "utf8"),
    readFile(recentAssessmentItemPath, "utf8"),
    readFile(recentFilterTriggerPath, "utf8"),
    readFile(recentFilterPopoverPath, "utf8"),
    readFile(recentFilterSubmenuPath, "utf8"),
    readFile(sidebarHeaderControlsPath, "utf8"),
    readFile(recentFilterTypesPath, "utf8"),
    readFile(recentFilterOptionsPath, "utf8"),
    readFile(recentFilterUtilsPath, "utf8"),
  ]);

  assert.match(sidebarSource, /\.\.\/molecules\/recent-assessment-item/);
  assert.match(sidebarSource, /\.\.\/molecules\/recent-filter-popover/);
  assert.match(sidebarSource, /\.\.\/molecules\/sidebar-nav-item/);
  assert.doesNotMatch(
    sidebarSource,
    /export function SidebarNavItem|export function RecentAssessmentItem|export const RecentFilterTrigger|export function RecentFilterPopover|export function RecentFilterSubmenu/,
  );
  assert.match(navItemSource, /export function SidebarNavItem/);
  assert.match(recentItemSource, /export function RecentAssessmentItem/);
  assert.match(filterTriggerSource, /export const RecentFilterTrigger/);
  assert.match(filterPopoverSource, /export function RecentFilterPopover/);
  assert.match(filterSubmenuSource, /export function RecentFilterSubmenu/);
  assert.match(headerControlsSource, /export function SidebarHeaderControls/);
  assert.match(typesSource, /export const DEFAULT_RECENT_FILTERS/);
  assert.match(optionsSource, /satisfies RecentFilterOption/);
  assert.match(utilsSource, /export function getVisibleRecentAssessments/);
});

test("LCSP-268 sidebar copy resolves through the shared app i18n helper", async () => {
  const [
    sidebarSource,
    filterTriggerSource,
    filterPopoverSource,
    filterSubmenuSource,
    headerControlsSource,
    accountMountSource,
    appI18nSource,
  ] = await Promise.all([
    readFile(appSidebarPath, "utf8"),
    readFile(recentFilterTriggerPath, "utf8"),
    readFile(recentFilterPopoverPath, "utf8"),
    readFile(recentFilterSubmenuPath, "utf8"),
    readFile(sidebarHeaderControlsPath, "utf8"),
    readFile(sidebarAccountMountPath, "utf8"),
    readFile(appI18nPath, "utf8"),
  ]);
  const sidebarCopySources = [
    sidebarSource,
    filterTriggerSource,
    filterPopoverSource,
    filterSubmenuSource,
    headerControlsSource,
    accountMountSource,
  ].join("\n");

  assert.match(appI18nSource, /export function resolveAppMessage/);
  assert.match(sidebarCopySources, /resolveAppMessage/);
  assert.doesNotMatch(sidebarCopySources, /function t\(/);
  assert.doesNotMatch(sidebarCopySources, /resolveMessage\(appLocale/);
});

test("sidebar hover hints use shadcn tooltip primitives instead of native title attributes", async () => {
  const [
    agentsSource,
    sidebarSource,
    navItemSource,
    recentItemSource,
    headerControlsSource,
    workspaceSwitcherSource,
    uiSidebarSource,
  ] = await Promise.all([
    readFile(agentsPath, "utf8"),
    readFile(appSidebarPath, "utf8"),
    readFile(sidebarNavItemPath, "utf8"),
    readFile(recentAssessmentItemPath, "utf8"),
    readFile(sidebarHeaderControlsPath, "utf8"),
    readFile(workspaceSwitcherPath, "utf8"),
    readFile(uiSidebarPath, "utf8"),
  ]);
  const tooltipSources = [
    navItemSource,
    recentItemSource,
    headerControlsSource,
    workspaceSwitcherSource,
    uiSidebarSource,
  ].join("\n");

  assert.match(agentsSource, /Do not add HTML `title` attributes/);
  assert.match(sidebarSource, /tooltip=\{resolveAppMessage/);
  assert.doesNotMatch(sidebarSource, /title=\{/);
  assert.match(tooltipSources, /Tooltip/);
  assert.match(tooltipSources, /TooltipTrigger/);
  assert.match(tooltipSources, /TooltipContent/);
  assert.doesNotMatch(tooltipSources, /\btitle=/);
});

test("assessment entry points no longer route progression through legacy step pages", async () => {
  const [navigationSource, clientSource, createSource, summarySource] =
    await Promise.all([
      readFile(navigationPath, "utf8"),
      readFile(workspaceClientPath, "utf8"),
      readFile(createAssessmentPath, "utf8"),
      readFile(summaryCardPath, "utf8"),
    ]);
  const combined = [
    navigationSource,
    clientSource,
    createSource,
    summarySource,
  ].join("\n");

  assert.doesNotMatch(
    combined,
    /\/(?:wizard|readiness|technical-evidence|classification|documents|conflicts)/,
  );
  assert.match(clientSource, /return `\/assessments\/\$\{encodedId\}`/);
  assert.match(
    createSource,
    /router\.push\(`\/assessments\/\$\{outcome\.assessmentId\}`\)/,
  );
});

test("deprecated assessment step routes redirect back to the shared shell", async () => {
  for (const path of legacyRoutePaths) {
    const source = await readFile(path, "utf8");

    assert.match(source, /import \{ redirect \} from "next\/navigation"/);
    assert.match(
      source,
      /redirect\(`\/assessments\/\$\{encodeURIComponent\(id\)\}`\)/,
    );
    assert.doesNotMatch(
      source,
      /WizardFormPage|ReadinessStatusPage|TechnicalEvidenceRuntimePage|ClassificationStatusPage|DocumentsPageClient|ConflictResolutionPage/,
    );
  }
});

test("wizard assessment route is removed from production routing", async () => {
  await assert.rejects(
    readFile(
      new URL(
        "../src/app/(workspace)/assessments/[id]/wizard/page.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    /ENOENT/,
  );
});
