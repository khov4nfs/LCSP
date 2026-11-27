"use client";

import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import { useAppLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setAppLocale } from "@/lib/locale";
import type { AuthShellProps } from "../../types/auth-shell.types";
import { AuthBrandPanel } from "../molecules/auth-brand-panel";

/**
 * AuthShell owns the shared visual frame while child forms retain their routes and state.
 * Locale changes use the existing provider/store so the cookie, document lang and subscribers stay aligned.
 */
export function AuthShell({ children, homeLabelKey }: AuthShellProps) {
  const locale = useAppLocale();
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const t = (key: Parameters<typeof resolveMessage>[1]) =>
    resolveMessage(locale, key);

  return (
    // Use canonical surface tokens so auth follows the application theme without changing its light-mode reference surface.
    <main className="min-h-dvh bg-background text-foreground">
      <header className="flex h-18 items-center justify-between border-b border-[#D6DFE7] px-6 sm:px-8 xl:px-11">
        <Link href="/" aria-label={t(homeLabelKey)} className="inline-flex items-center">
          <LCSPLogo variant="lockup" size="md" />
        </Link>
        <nav aria-label={t("pages.authShell.navigationLabel")} className="mr-0 flex items-center gap-6 xl:mr-9 xl:gap-24">
          <DropdownMenu open={languageMenuOpen} onOpenChange={setLanguageMenuOpen}>
            {/* Use the full semantic ring locally; the shared Button's default half-opacity ring is too faint on the light auth header. */}
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" aria-label={t("pages.authShell.languageLabel")} className="focus-visible:ring-ring" />}
            >
              {locale.toUpperCase()} <ChevronDownIcon className="size-3" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => {
                  if (value === "en" || value === "vi") {
                    // Close after a valid selection so keyboard focus returns to the trigger with the updated label.
                    setAppLocale(value);
                    setLanguageMenuOpen(false);
                  }
                }}
              >
                <DropdownMenuRadioItem value="en">{t("pages.authShell.english")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="vi">{t("pages.authShell.vietnamese")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link
            href="/"
            aria-label={t("pages.appShell.backToWebsite")}
            className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Compact the visible action on narrow screens while keeping its full accessible name. */}
            <span className="hidden sm:inline">
              {t("pages.appShell.backToWebsite")}
            </span>
            <span className="sm:hidden">
              {t("pages.authShell.backToWebsiteShort")}
            </span>
            <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
          </Link>
        </nav>
      </header>
      {/* Keep the two-column composition at xl so the audited panel and form can retain their readable widths on tablets. */}
      <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-1 gap-8 px-4 py-6 sm:px-8 xl:grid-cols-[minmax(0,590px)_minmax(0,1fr)] xl:gap-12">
        <AuthBrandPanel />
        <section className="flex min-w-0 flex-col items-center pt-6 xl:pt-14 xl:pr-14">
          <div className="flex w-full flex-1 items-start justify-center">
            {children}
          </div>
          <footer className="mt-10 w-full text-center text-xs leading-4 text-muted-foreground xl:mt-auto">
            {t("pages.authShell.footerLabel")}
          </footer>
        </section>
      </div>
    </main>
  );
}
