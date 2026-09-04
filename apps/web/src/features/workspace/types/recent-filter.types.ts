import type { MessageKey } from "@lcsp/i18n";

export const RECENT_FILTER_TYPES = {
  all: "all",
  chat: "chat",
  task: "task",
} as const;

export const RECENT_FILTER_STATUSES = {
  active: "active",
  archived: "archived",
  all: "all",
} as const;

export const RECENT_FILTER_ACTIVITY = {
  oneDay: "oneDay",
  threeDays: "threeDays",
  sevenDays: "sevenDays",
  thirtyDays: "thirtyDays",
  all: "all",
} as const;

export const RECENT_FILTER_GROUPS = {
  date: "date",
  type: "type",
  unread: "unread",
  state: "state",
  customGroups: "customGroups",
  none: "none",
} as const;

export const RECENT_FILTER_SORTS = {
  name: "name",
  dateCreated: "dateCreated",
  lastActivity: "lastActivity",
} as const;

export const RECENT_FILTER_KEYS = {
  type: "type",
  status: "status",
  lastActivity: "lastActivity",
  groupBy: "groupBy",
  sortBy: "sortBy",
} as const;

export const SIDEBAR_RECENT_LOAD_STATES = {
  idle: "idle",
  loading: "loading",
  error: "error",
} as const;

export const SIDEBAR_NAV_ITEM_VARIANTS = {
  new: "new",
  nav: "nav",
} as const;

export type RecentFilterType =
  (typeof RECENT_FILTER_TYPES)[keyof typeof RECENT_FILTER_TYPES];
export type RecentFilterStatus =
  (typeof RECENT_FILTER_STATUSES)[keyof typeof RECENT_FILTER_STATUSES];
export type RecentFilterActivity =
  (typeof RECENT_FILTER_ACTIVITY)[keyof typeof RECENT_FILTER_ACTIVITY];
export type RecentFilterGroup =
  (typeof RECENT_FILTER_GROUPS)[keyof typeof RECENT_FILTER_GROUPS];
export type RecentFilterSort =
  (typeof RECENT_FILTER_SORTS)[keyof typeof RECENT_FILTER_SORTS];
export type RecentFilterKey =
  (typeof RECENT_FILTER_KEYS)[keyof typeof RECENT_FILTER_KEYS];
export type SidebarRecentLoadState =
  (typeof SIDEBAR_RECENT_LOAD_STATES)[keyof typeof SIDEBAR_RECENT_LOAD_STATES];
export type SidebarNavItemVariant =
  (typeof SIDEBAR_NAV_ITEM_VARIANTS)[keyof typeof SIDEBAR_NAV_ITEM_VARIANTS];

export type RecentFilters = {
  type: RecentFilterType;
  status: RecentFilterStatus;
  lastActivity: RecentFilterActivity;
  groupBy: RecentFilterGroup;
  sortBy: RecentFilterSort;
};

export type RecentFilterOption<Value extends string> = {
  value: Value;
  labelKey: MessageKey;
};

export const DEFAULT_RECENT_FILTERS: RecentFilters = {
  type: RECENT_FILTER_TYPES.all,
  status: RECENT_FILTER_STATUSES.active,
  lastActivity: RECENT_FILTER_ACTIVITY.all,
  groupBy: RECENT_FILTER_GROUPS.none,
  sortBy: RECENT_FILTER_SORTS.lastActivity,
};
