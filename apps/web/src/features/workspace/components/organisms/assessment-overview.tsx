import { resolveMessage } from "@lcsp/i18n";
import {
  FileCheck2Icon,
  FileTextIcon,
  GaugeIcon,
  ScaleIcon,
  ShieldCheckIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appLocale } from "@/lib/locale";

import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";

const modules = [
  {
    segment: "wizard",
    labelKey: "pages.appShell.wizard",
    descriptionKey: "pages.assessment.modules.wizard",
    icon: FileCheck2Icon,
  },
  {
    segment: "readiness",
    labelKey: "pages.appShell.readiness",
    descriptionKey: "pages.assessment.modules.readiness",
    icon: GaugeIcon,
  },
  {
    segment: "classification",
    labelKey: "pages.appShell.classification",
    descriptionKey: "pages.assessment.modules.classification",
    icon: ShieldCheckIcon,
  },
  {
    segment: "documents",
    labelKey: "pages.appShell.documents",
    descriptionKey: "pages.assessment.modules.documents",
    icon: FileTextIcon,
  },
  {
    segment: "conflicts",
    labelKey: "pages.appShell.conflicts",
    descriptionKey: "pages.assessment.modules.conflicts",
    icon: ScaleIcon,
  },
] as const;

export function AssessmentOverview({ assessmentId }: AssessmentOverviewProps) {
  return (
    <main
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6"
      data-assessment-id={assessmentId}
    >
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">
          {resolveMessage(appLocale, "pages.assessment.eyebrow")}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {resolveMessage(appLocale, "pages.assessment.pageTitle")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {resolveMessage(appLocale, "pages.assessment.pageDescription")}
        </p>
      </header>

      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label={resolveMessage(
          appLocale,
          "pages.assessment.moduleNavigation",
        )}
      >
        {modules.map(({ segment, labelKey, descriptionKey, icon: Icon }) => (
          <Card key={segment} className="h-full">
            <CardHeader>
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <CardTitle>{resolveMessage(appLocale, labelKey)}</CardTitle>
              <CardDescription>
                {resolveMessage(appLocale, descriptionKey)}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm font-medium text-muted-foreground">
              {resolveMessage(appLocale, "pages.assessment.openModule")}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
