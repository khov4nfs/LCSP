import type { RecentFilterOption } from "../types/recent-filter.types";
import {
  RECENT_FILTER_ACTIVITY,
  RECENT_FILTER_GROUPS,
  RECENT_FILTER_SORTS,
  RECENT_FILTER_STATUSES,
  RECENT_FILTER_TYPES,
  type RecentFilterActivity,
  type RecentFilterGroup,
  type RecentFilterSort,
  type RecentFilterStatus,
  type RecentFilterType,
} from "../types/recent-filter.types";

export const RECENT_TYPE_OPTIONS = [
  {
    value: RECENT_FILTER_TYPES.all,
    labelKey: "pages.appShell.recentFilter.options.all",
  },
  {
    value: RECENT_FILTER_TYPES.chat,
    labelKey: "pages.appShell.recentFilter.options.chat",
  },
  {
    value: RECENT_FILTER_TYPES.task,
    labelKey: "pages.appShell.recentFilter.options.task",
  },
] satisfies RecentFilterOption<RecentFilterType>[];

export const RECENT_STATUS_OPTIONS = [
  {
    value: RECENT_FILTER_STATUSES.active,
    labelKey: "pages.appShell.recentFilter.options.active",
  },
  {
    value: RECENT_FILTER_STATUSES.archived,
    labelKey: "pages.appShell.recentFilter.options.archived",
  },
  {
    value: RECENT_FILTER_STATUSES.all,
    labelKey: "pages.appShell.recentFilter.options.all",
  },
] satisfies RecentFilterOption<RecentFilterStatus>[];

export const RECENT_ACTIVITY_OPTIONS = [
  {
    value: RECENT_FILTER_ACTIVITY.oneDay,
    labelKey: "pages.appShell.recentFilter.options.oneDay",
  },
  {
    value: RECENT_FILTER_ACTIVITY.threeDays,
    labelKey: "pages.appShell.recentFilter.options.threeDays",
  },
  {
    value: RECENT_FILTER_ACTIVITY.sevenDays,
    labelKey: "pages.appShell.recentFilter.options.sevenDays",
  },
  {
    value: RECENT_FILTER_ACTIVITY.thirtyDays,
    labelKey: "pages.appShell.recentFilter.options.thirtyDays",
  },
  {
    value: RECENT_FILTER_ACTIVITY.all,
    labelKey: "pages.appShell.recentFilter.options.all",
  },
] satisfies RecentFilterOption<RecentFilterActivity>[];

export const RECENT_GROUP_OPTIONS = [
  {
    value: RECENT_FILTER_GROUPS.date,
    labelKey: "pages.appShell.recentFilter.options.date",
  },
  {
    value: RECENT_FILTER_GROUPS.type,
    labelKey: "pages.appShell.recentFilter.labels.type",
  },
  {
    value: RECENT_FILTER_GROUPS.unread,
    labelKey: "pages.appShell.recentFilter.options.unread",
  },
  {
    value: RECENT_FILTER_GROUPS.state,
    labelKey: "pages.appShell.recentFilter.options.state",
  },
  {
    value: RECENT_FILTER_GROUPS.customGroups,
    labelKey: "pages.appShell.recentFilter.options.customGroups",
  },
  {
    value: RECENT_FILTER_GROUPS.none,
    labelKey: "pages.appShell.recentFilter.options.none",
  },
] satisfies RecentFilterOption<RecentFilterGroup>[];

export const RECENT_SORT_OPTIONS = [
  {
    value: RECENT_FILTER_SORTS.name,
    labelKey: "pages.appShell.recentFilter.options.name",
  },
  {
    value: RECENT_FILTER_SORTS.dateCreated,
    labelKey: "pages.appShell.recentFilter.options.dateCreated",
  },
  {
    value: RECENT_FILTER_SORTS.lastActivity,
    labelKey: "pages.appShell.recentFilter.options.lastActivity",
  },
] satisfies RecentFilterOption<RecentFilterSort>[];
