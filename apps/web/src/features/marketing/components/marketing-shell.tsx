import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";
import type { ReactNode } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

const navigation = [
  {
    key: "product" as const,
    href: "/",
    labelKey: "pages.marketing.nav.product",
  },
  {
    key: "features" as const,
    href: "/features",
    labelKey: "pages.marketing.nav.features",
  },
  {
    key: "pricing" as const,
    href: "/pricing",
    labelKey: "pages.marketing.nav.pricing",
  },
];

type MarketingPageKey = (typeof navigation)[number]["key"];

type MarketingShellProps = {
  active: MarketingPageKey;
  children: ReactNode;
};

export function MarketingShell({ active, children }: MarketingShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 h-18 border-b border-border bg-background">
        <div className="relative mx-auto h-18 w-full max-w-[1440px]">
          <Link
            href="/"
            aria-label={t("pages.marketing.brandHomeLabel")}
            className="absolute left-8 top-6 text-[15px] font-semibold leading-none"
          >
            LCSP
          </Link>

          <nav
            aria-label={t("pages.marketing.nav.label")}
            className="absolute left-1/2 top-4 hidden h-10 -translate-x-1/2 items-center md:flex"
          >
            {navigation.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active === item.key ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center px-4 text-xs font-medium text-foreground transition-colors hover:text-brand",
                  active === item.key && "text-brand",
                )}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>

          <div className="absolute right-8 top-[18px] flex h-9 items-center gap-2.5">
            <Link
              href="/sign-in"
              className="inline-flex h-9 w-24 items-center justify-center rounded-lg border border-border bg-secondary text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t("pages.marketing.nav.signIn")}
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex h-9 w-[122px] items-center justify-center rounded-lg border border-primary bg-primary text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-85"
            >
              {t("pages.marketing.nav.createAccount")}
            </Link>
          </div>
        </div>

        <nav
          aria-label={t("pages.marketing.nav.mobileLabel")}
          className="absolute inset-x-0 top-18 flex gap-1 overflow-x-auto border-b border-border bg-background px-5 py-2 md:hidden"
        >
          {navigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground",
                active === item.key && "bg-secondary text-foreground",
              )}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </header>

      {children}

      <MarketingFooter active={active} />
    </main>
  );
}

function MarketingFooter({ active }: { active: MarketingPageKey }) {
  const footer = t("pages.marketing.footer");

  return (
    <footer className="bg-background">
      <div className="relative mx-auto h-[220px] w-full max-w-[1440px] border-t border-border px-8 md:px-[120px]">
        <div className="pt-12">
          <p className="text-[15px] font-semibold leading-6">LCSP</p>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            {t("pages.marketing.footerTagline")}
          </p>
          {footer ? (
            <p className="mt-11 text-[10px] leading-5 text-muted-foreground">
              {footer}
            </p>
          ) : null}
        </div>
        <nav
          aria-label={t("pages.marketing.nav.label")}
          className="absolute right-8 top-11 flex h-10 items-center gap-4 md:right-[320px]"
        >
          {navigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={cn(
                "px-3 py-3 text-xs font-medium text-foreground transition-colors hover:text-brand",
                active === item.key && "text-brand",
              )}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
