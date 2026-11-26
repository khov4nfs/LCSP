import {
  FileTextIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  SwatchBookIcon,
} from "lucide-react";

type NavigationDefinition = {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboardIcon;
  exact?: boolean;
  disabled?: boolean;
};

/**
 * Primary Platform navigation matching Figma LCSP Shell / Customer / Overview (1697:4893).
 */
export const primaryNavigation = [
  {
    href: "/workspace",
    labelKey: "pages.appShell.overview",
    icon: LayoutDashboardIcon,
    exact: true,
  },
  {
    href: "/assessments",
    labelKey: "pages.appShell.assessments",
    icon: ListChecksIcon,
  },
  {
    href: "/workspace/compliance",
    labelKey: "pages.appShell.followUpRequests",
    icon: ShieldCheckIcon,
  },
  {
    href: "/laws",
    labelKey: "pages.appShell.legalLibrary",
    icon: LibraryBigIcon,
  },
  {
    href: "/workspace/reports",
    labelKey: "pages.appShell.reports",
    icon: FileTextIcon,
  },
  {
    href: "/artifacts",
    labelKey: "pages.appShell.artifacts",
    icon: SwatchBookIcon,
  },
] as const satisfies readonly NavigationDefinition[];

export function getAssessmentNavigation(
  assessmentId?: string,
): readonly NavigationDefinition[] {
  const basePath = assessmentId
    ? `/assessments/${encodeURIComponent(assessmentId)}`
    : "/assessments";
  const disabled = !assessmentId;

  return [
    {
      href: basePath,
      labelKey: "pages.appShell.overview",
      icon: LayoutDashboardIcon,
      exact: true,
      disabled,
    },
  ];
}
