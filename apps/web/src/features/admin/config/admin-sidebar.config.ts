import type { MessageKey } from "@lcsp/i18n";
import {
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
    href: "/admin/users",
    labelKey: "pages.admin.sidebar.navUserAccounts",
    icon: UsersIcon,
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
] satisfies { href: string; labelKey: MessageKey; icon: typeof BookOpenIcon }[];

export const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";
