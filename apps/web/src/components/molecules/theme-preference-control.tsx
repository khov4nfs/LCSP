"use client";

import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import {
  THEME_PREFERENCES,
  type ThemePreference,
} from "@/components/types/theme-preference.types";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const themeOptions: {
  icon: LucideIcon;
  labelKey: MessageKey;
  value: ThemePreference;
}[] = [
  {
    icon: MonitorIcon,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.system",
    value: THEME_PREFERENCES.system,
  },
  {
    icon: SunIcon,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.light",
    value: THEME_PREFERENCES.light,
  },
  {
    icon: MoonIcon,
    labelKey: "pages.workspace.settingsHub.appearance.themeOptions.dark",
    value: THEME_PREFERENCES.dark,
  },
];

type ThemePreferenceControlProps = {
  variant?: "default" | "compact";
};

export function ThemePreferenceControl({
  variant = "default",
}: ThemePreferenceControlProps) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const currentTheme = isThemePreference(theme)
    ? theme
    : THEME_PREFERENCES.system;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (variant === "compact") {
    return (
      <TooltipProvider>
        <div
          aria-label={resolveAppMessage(
            "pages.workspace.settingsHub.appearance.themeControlLabel",
          )}
          className="grid h-9.5 w-30 grid-cols-3 rounded-[9px] border border-input bg-muted/35 p-0.5"
          data-component="CompactThemePreferenceControl"
          role="group"
        >
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const label = resolveAppMessage(option.labelKey);
            const selected = mounted && currentTheme === option.value;

            return (
              <Tooltip key={option.value}>
                <TooltipTrigger
                  render={
                    <button
                      aria-label={label}
                      aria-pressed={selected}
                      className={cn(
                        "flex h-8 w-9.5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                        selected && "bg-accent text-accent-foreground",
                      )}
                      disabled={!mounted}
                      onClick={() => setTheme(option.value)}
                      type="button"
                    >
                      <Icon aria-hidden="true" className="size-4" />
                    </button>
                  }
                />
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-label={resolveAppMessage(
          "pages.workspace.settingsHub.appearance.themeControlLabel",
        )}
        className="grid gap-2 sm:grid-cols-3"
        role="group"
      >
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const selected = mounted && currentTheme === option.value;

          return (
            <Button
              aria-pressed={selected}
              className={cn(
                "h-10 justify-start gap-2 border px-3 text-sm",
                selected
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-border bg-card text-card-foreground hover:bg-muted hover:text-foreground",
              )}
              disabled={!mounted}
              key={option.value}
              onClick={() => setTheme(option.value)}
              type="button"
              variant="outline"
            >
              <Icon aria-hidden="true" className="size-4" />
              {resolveAppMessage(option.labelKey)}
            </Button>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {resolveAppMessage(
          "pages.workspace.settingsHub.appearance.resolvedThemeLabel",
        )}
        {": "}
        {resolveAppMessage(
          resolvedTheme === THEME_PREFERENCES.dark
            ? "pages.workspace.settingsHub.appearance.resolvedThemeOptions.dark"
            : "pages.workspace.settingsHub.appearance.resolvedThemeOptions.light",
        )}
      </p>
    </div>
  );
}

function isThemePreference(
  value: string | undefined,
): value is ThemePreference {
  return (
    value === THEME_PREFERENCES.light ||
    value === THEME_PREFERENCES.dark ||
    value === THEME_PREFERENCES.system
  );
}
