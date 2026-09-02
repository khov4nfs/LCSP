export const ASSESSMENT_SHELL_SCREENS = {
  workspace: "workspace",
  legal: "legal",
  directory: "directory",
  create: "create",
  assessment: "assessment",
} as const;

export type AssessmentScreenState =
  (typeof ASSESSMENT_SHELL_SCREENS)[keyof typeof ASSESSMENT_SHELL_SCREENS];

export const ASSESSMENT_LEFT_SIDEBAR_STATES = {
  open: "open",
  collapsed: "collapsed",
} as const;

export type AssessmentLeftSidebarState =
  (typeof ASSESSMENT_LEFT_SIDEBAR_STATES)[keyof typeof ASSESSMENT_LEFT_SIDEBAR_STATES];

export const ASSESSMENT_RIGHT_PANEL_STATES = {
  open: "open",
  closed: "closed",
} as const;

export type AssessmentRightPanelState =
  (typeof ASSESSMENT_RIGHT_PANEL_STATES)[keyof typeof ASSESSMENT_RIGHT_PANEL_STATES];

export type AssessmentShellState = {
  screen: AssessmentScreenState;
  leftSidebar: AssessmentLeftSidebarState;
  rightPanel: AssessmentRightPanelState;
};
