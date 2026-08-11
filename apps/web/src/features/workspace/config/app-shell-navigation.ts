import {
  ClipboardCheckIcon,
  ActivityIcon,
  FileCheck2Icon,
  FileTextIcon,
  GaugeIcon,
  UsersIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LibraryBigIcon,
  ScaleIcon,
  ShieldCheckIcon,
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

export const developerNavigation = [
  {
    href: "/developer/assessments",
    labelKey: "pages.appShell.developer",
    icon: ClipboardCheckIcon,
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
      href: `${basePath}/developers`,
      labelKey: "pages.appShell.developers",
      icon: UsersIcon,
      disabled,
    },
    {
      href: basePath,
      labelKey: "pages.appShell.overview",
      icon: LayoutDashboardIcon,
      exact: true,
      disabled,
    },
    {
      href: `${basePath}/wizard`,
      labelKey: "pages.appShell.wizard",
      icon: FileCheck2Icon,
      disabled,
    },
    {
      href: `${basePath}/readiness`,
      labelKey: "pages.appShell.readiness",
      icon: GaugeIcon,
      disabled,
    },
    {
      href: `${basePath}/technical-evidence`,
      labelKey: "pages.appShell.technicalEvidence",
      icon: ActivityIcon,
      disabled,
    },
    {
      href: `${basePath}/classification`,
      labelKey: "pages.appShell.classification",
      icon: ShieldCheckIcon,
      disabled,
    },
    {
      href: `${basePath}/documents`,
      labelKey: "pages.appShell.documents",
      icon: FileTextIcon,
      disabled,
    },
    {
      href: `${basePath}/conflicts`,
      labelKey: "pages.appShell.conflicts",
      icon: ScaleIcon,
      disabled,
    },
  ];
}
