import {
  LayoutDashboardIcon,
  ListChecksIcon,
  LibraryBigIcon,
} from "lucide-react";

type NavigationDefinition = {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboardIcon;
  exact?: boolean;
  disabled?: boolean;
};

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
    href: "/laws",
    labelKey: "pages.appShell.legalLibrary",
    icon: LibraryBigIcon,
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
