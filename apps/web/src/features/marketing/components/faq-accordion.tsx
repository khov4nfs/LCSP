"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

export function FAQAccordion() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: t("pages.marketing.home.faq1Question"),
      a: t("pages.marketing.home.faq1Answer"),
    },
    {
      q: t("pages.marketing.home.faq2Question"),
      a: t("pages.marketing.home.faq2Answer"),
    },
    {
      q: t("pages.marketing.home.faq3Question"),
      a: t("pages.marketing.home.faq3Answer"),
    },
    {
      q: t("pages.marketing.home.faq4Question"),
      a: t("pages.marketing.home.faq4Answer"),
    },
    {
      q: t("pages.marketing.home.faq5Question"),
      a: t("pages.marketing.home.faq5Answer"),
    },
  ];

  return (
    <section
      data-section="faq-accordion"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[120px]"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {t("pages.marketing.home.faqEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("pages.marketing.home.faqTitle")}
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          {t("pages.marketing.home.faqDescription")}
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-3xl divide-y divide-border rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
        {faqs.map(({ q, a }, index) => {
          const isOpen = openIndex === index;
          return (
            <Collapsible
              key={q}
              open={isOpen}
              onOpenChange={(open) => setOpenIndex(open ? index : null)}
              className="py-5 first:pt-0 last:pb-0"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-base font-medium text-foreground transition-colors hover:text-brand">
                <span className="pr-4">{q}</span>
                <ChevronDownIcon
                  className={`size-4 shrink-0 transition-transform duration-200 text-muted-foreground ${
                    isOpen ? "rotate-180 text-brand" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsiblePanel className="pt-3 text-sm leading-relaxed text-muted-foreground">
                <p>{a}</p>
              </CollapsiblePanel>
            </Collapsible>
          );
        })}
      </div>
    </section>
  );
}
