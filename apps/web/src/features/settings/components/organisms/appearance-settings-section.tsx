"use client";

import { resolveMessage } from "@lcsp/i18n";
import { MonitorIcon } from "lucide-react";

import { SectionHeading } from "@/components/molecules/section-heading";
import { ThemePreferenceControl } from "@/components/molecules/theme-preference-control";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appLocale } from "@/lib/locale";

export function AppearanceSettingsSection() {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.appearance.title",
        )}
        description={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.appearance.description",
        )}
        icon={<MonitorIcon className="size-4" />}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.appearance.shellTitle",
            )}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.appearance.shellDescription",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemePreferenceControl />
        </CardContent>
      </Card>
    </section>
  );
}
