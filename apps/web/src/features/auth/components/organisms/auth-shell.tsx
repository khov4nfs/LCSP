import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";

import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import { appLocale } from "@/lib/locale";
import type { AuthShellProps } from "../../types/auth-shell.types";

export function AuthShell({ children, homeLabel }: AuthShellProps) {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Link
        href="/"
        aria-label={homeLabel}
        className="absolute left-1/2 top-6 inline-flex h-8 -translate-x-1/2 items-center"
      >
        <LCSPLogo variant="lockup" size="md" />
      </Link>
      <Link
        href="/"
        className="absolute right-[60px] top-[22px] text-right text-[11px] font-medium leading-4 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline max-sm:right-6"
      >
        {t("pages.appShell.backToWebsite")}
      </Link>
      <div className="mx-auto flex min-h-svh w-full flex-col items-center px-6">
        {children}
      </div>
    </main>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
