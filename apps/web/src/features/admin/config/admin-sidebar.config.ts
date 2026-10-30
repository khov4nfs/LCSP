import type { MessageKey } from "@lcsp/i18n";
import {
  ActivityIcon,
  BookOpenIcon,
  LayoutDashboardIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";

export const ADMIN_NAV_ITEMS = [
  {
    href: "/admin",
    labelKey: "pages.admin.sidebar.navOverview",
    icon: LayoutDashboardIcon,
  },
  {
    href: "/admin/tracking",
    labelKey: "pages.workspace.tracking.adminTitle",
    icon: ActivityIcon,
  },
  {
    href: "/admin/users",
    labelKey: "pages.admin.sidebar.navUserAccounts",
    icon: UsersIcon,
  },
  {
    href: "/admin/usage",
    labelKey: "pages.admin.sidebar.navUsage",
    icon: ActivityIcon,
  },
  {
    href: "/admin/billing",
    labelKey: "pages.admin.sidebar.navBilling",
    icon: WalletCardsIcon,
  },
  {
    href: "/admin/compliance-rule-sets",
    labelKey: "pages.admin.sidebar.navComplianceRuleSets",
    icon: BookOpenIcon,
  },
  {
    href: "/admin/legal-sources",
    labelKey: "pages.admin.sidebar.navLegalSources",
    icon: BookOpenIcon,
  },
] satisfies { href: string; labelKey: MessageKey; icon: typeof BookOpenIcon }[];

export const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";
