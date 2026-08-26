import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type AppShellProps = {
  children: ReactNode;
};

export type AppShellNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export type AppShellNavigationSection = {
  label: string;
  kind?: "workspace" | "assessment";
  assessmentId?: string;
  items: AppShellNavigationItem[];
};
