"use client";

import Link from "next/link";
import { useState } from "react";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";

export function FigmaFaqSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: t("pages.marketing.home.faqItem1Question"),
      a: t("pages.marketing.home.faqItem1Answer"),
    },
    {
      q: t("pages.marketing.home.faqItem2Question"),
      a: t("pages.marketing.home.faqItem2Answer"),
    },
    {
      q: t("pages.marketing.home.faqItem3Question"),
      a: t("pages.marketing.home.faqItem3Answer"),
    },
    {
      q: t("pages.marketing.home.faqItem4Question"),
      a: t("pages.marketing.home.faqItem4Answer"),
    },
    {
      q: t("pages.marketing.home.faqItem5Question"),
      a: t("pages.marketing.home.faqItem5Answer"),
    },
  ];

  return (
    <section
      id="faq"
      data-section="figma-faq"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px]"
    >
      <div className="grid gap-12 lg:grid-cols-[400px_1fr]">
        {/* Left Column: Title & CTA */}
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
            {t("pages.marketing.home.faqSectionTitle")}
          </h2>
          <p className="mt-3 text-base text-[#48586A]">
            {t("pages.marketing.home.faqSectionDescription")}
          </p>

          <div className="mt-8">
            <Link
              href={`/${locale}/pricing`}
              className="inline-flex h-10 items-center justify-center rounded-[7px] border border-slate-300 bg-white px-5 text-sm font-semibold text-[#101C29] shadow-xs transition-colors hover:bg-slate-50"
            >
              {t("pages.marketing.home.faqViewPricingCta")}
            </Link>
          </div>
        </div>

        {/* Right Column: Accordion */}
        <div className="space-y-3">
          {faqs.map(({ q, a }, index) => {
            const isOpen = openIndex === index;
            return (
              <Collapsible
                key={q}
                open={isOpen}
                onOpenChange={(open) => setOpenIndex(open ? index : null)}
                className="group rounded-xl border border-slate-200/90 bg-white p-5 transition-all duration-200 hover:border-[#31BDA7]/40 hover:shadow-xs"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm font-semibold text-[#101C29] transition-colors group-hover:text-[#11545B]">
                  <span className="pr-4">{q}</span>
                  <ChevronDownIcon
                    className={`size-4 shrink-0 text-[#48586A] transition-transform duration-300 ${
                      isOpen ? "rotate-180 text-[#31BDA7]" : "group-hover:text-[#31BDA7]"
                    }`}
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel className="pt-3 text-xs leading-relaxed text-[#48586A]">
                  <p>{a}</p>
                </CollapsiblePanel>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </section>
  );
}
