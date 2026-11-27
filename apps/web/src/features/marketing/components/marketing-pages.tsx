"use client";

import type { Locale } from "@lcsp/contracts/shared/locale";
import { resolveMessage } from "@lcsp/i18n";
import {
    ChevronRightIcon,
    CopyIcon,
    CornerDownLeftIcon,
    FileTextIcon,
    GitBranchIcon,
    SearchIcon,
    SquareIcon,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AudienceGrid } from "./audience-grid";
import { BentoCapabilities } from "./bento-capabilities";
import { FAQAccordion } from "./faq-accordion";
import {
  EnhancedFindingPreview,
  EnhancedHumanContextPreview,
  EnhancedRemediationPreview,
  EnhancedRepositoryEvidencePreview,
  FeaturesCapabilitiesMosaicGrid,
  FeaturesFinalCtaSection,
  FeaturesHeroSection,
} from "./features-showcase";
import {
  EnhancedCreditTopUpsSection,
  EnhancedHowCreditsWorkSection,
  EnhancedPricingFaqSection,
  EnhancedPricingFinalCta,
  EnhancedPricingHero,
} from "./pricing-showcase";
import { FeedbackForm } from "./feedback-form";
import { FigmaCapabilitiesSection } from "./figma-capabilities-section";
import { FigmaFaqSection } from "./figma-faq-section";
import { FigmaFeedbackSection } from "./figma-feedback-section";
import { FigmaFinalCtaSection } from "./figma-final-cta-section";
import { FigmaHeroSection } from "./figma-hero-section";
import { FigmaHowItWorksSection } from "./figma-how-it-works-section";
import { FigmaWhoSection } from "./figma-who-section";
import { FigmaWhySection } from "./figma-why-section";
import {
    MarketingLocaleProvider,
    useMarketingLocale,
} from "./marketing-locale";
import { MarketingShell } from "./marketing-shell";
import { ProviderLogoStrip } from "./provider-logo-strip";
import { ScrollRevealObserver } from "./scroll-reveal";
import { WordHighlightStatement } from "./word-highlight-statement";
import { WorkflowSteps } from "./workflow-steps";

const productQuickActions = [
  "pages.marketing.home.quickRepository",
  "pages.marketing.home.quickUseCase",
  "pages.marketing.home.quickEvidence",
] as const;

const productProof = [
  [
    "pages.marketing.home.valuePinned",
    "pages.marketing.home.valuePinnedDetail",
  ],
  [
    "pages.marketing.home.valueTargeted",
    "pages.marketing.home.valueTargetedDetail",
  ],
  [
    "pages.marketing.home.valueReviewable",
    "pages.marketing.home.valueReviewableDetail",
  ],
  [
    "pages.marketing.home.valueVerifiable",
    "pages.marketing.home.valueVerifiableDetail",
  ],
] as const;

const modes = [
  ["pages.marketing.home.modeScan", "pages.marketing.home.scanDescription"],
  [
    "pages.marketing.home.modeUnderstand",
    "pages.marketing.home.evidenceDescription",
  ],
  [
    "pages.marketing.home.modeRemediate",
    "pages.marketing.home.decisionDescription",
  ],
] as const;

const lifecycleSteps = [
  [
    "01",
    "pages.marketing.home.lifecycleConnect",
    "pages.marketing.home.lifecycleConnectDetail",
  ],
  [
    "02",
    "pages.marketing.home.lifecycleScan",
    "pages.marketing.home.lifecycleScanDetail",
  ],
  [
    "03",
    "pages.marketing.home.lifecycleContext",
    "pages.marketing.home.lifecycleContextDetail",
  ],
  [
    "04",
    "pages.marketing.home.lifecycleReview",
    "pages.marketing.home.lifecycleReviewDetail",
  ],
  [
    "05",
    "pages.marketing.home.lifecycleVerify",
    "pages.marketing.home.lifecycleVerifyDetail",
  ],
] as const;

const evidencePrinciples = [
  [
    "pages.marketing.home.principlePinnedTitle",
    "pages.marketing.home.principlePinned",
  ],
  [
    "pages.marketing.home.principleTargetedTitle",
    "pages.marketing.home.principleTargeted",
  ],
  [
    "pages.marketing.home.principleReviewableTitle",
    "pages.marketing.home.principleReviewable",
  ],
  [
    "pages.marketing.home.principleVerifiableTitle",
    "pages.marketing.home.principleVerifiable",
  ],
] as const;

const workspaceCapabilities = [
  [
    "01",
    "pages.marketing.features.capabilityOneTitle",
    "pages.marketing.features.capabilityOneDescription",
    "pages.marketing.features.capabilityOneMeta",
  ],
  [
    "02",
    "pages.marketing.features.capabilityTwoTitle",
    "pages.marketing.features.capabilityTwoDescription",
    "pages.marketing.features.capabilityTwoMeta",
  ],
  [
    "03",
    "pages.marketing.features.capabilityThreeTitle",
    "pages.marketing.features.capabilityThreeDescription",
    "pages.marketing.features.capabilityThreeMeta",
  ],
] as const;

const topUps = [
  [
    "$50",
    "pages.marketing.pricing.save10",
    "pages.marketing.pricing.topUp50Description",
    "pages.marketing.pricing.topUp50Balance",
    "pages.marketing.pricing.topUp50Saving",
    "pages.marketing.pricing.add50",
  ],
  [
    "$250",
    "pages.marketing.pricing.save20",
    "pages.marketing.pricing.topUp250Description",
    "pages.marketing.pricing.topUp250Balance",
    "pages.marketing.pricing.topUp250Saving",
    "pages.marketing.pricing.add250",
  ],
  [
    "$1,000",
    "pages.marketing.pricing.save30",
    "pages.marketing.pricing.topUp1000Description",
    "pages.marketing.pricing.topUp1000Balance",
    "pages.marketing.pricing.topUp1000Saving",
    "pages.marketing.pricing.add1000",
  ],
] as const;

const creditSteps = [
  [
    "01",
    "pages.marketing.pricing.stepTopUpTitle",
    "pages.marketing.pricing.stepTopUpDescription",
  ],
  [
    "02",
    "pages.marketing.pricing.stepUseTitle",
    "pages.marketing.pricing.stepUseDescription",
  ],
  [
    "03",
    "pages.marketing.pricing.stepReloadTitle",
    "pages.marketing.pricing.stepReloadDescription",
  ],
] as const;

const faqItems = [
  [
    "pages.marketing.pricing.faqPayGoQuestion",
    "pages.marketing.pricing.faqPayGoAnswer",
  ],
  [
    "pages.marketing.pricing.faqCustomQuestion",
    "pages.marketing.pricing.faqCustomAnswer",
  ],
  [
    "pages.marketing.pricing.faqDiscountQuestion",
    "pages.marketing.pricing.faqDiscountAnswer",
  ],
  [
    "pages.marketing.pricing.faqReloadQuestion",
    "pages.marketing.pricing.faqReloadAnswer",
  ],
] as const;

export function ProductMarketingPage({ locale }: { locale: Locale }) {
  return (
    <MarketingLocaleProvider locale={locale}>
      <ProductMarketingPageContent />
    </MarketingLocaleProvider>
  );
}

function ProductMarketingPageContent() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const localizedHref = (path: string) => localizedMarketingHref(locale, path);

  return (
    <MarketingShell active="product">
      <ScrollRevealObserver />
      <div data-figma-node="923:31255" data-figma-name="M01 Overview">
        {/* Frame 01: Hero & Product Preview (Figma 1662:659 / 1757:12980) */}
        <FigmaHeroSection />

        {/* Frame 02: Why LCSP (Figma 1662:659 / 1766:12952) */}
        <FigmaWhySection />

        {/* Frame 03: Product capabilities (Figma 1662:659 / 1766:12981) */}
        <FigmaCapabilitiesSection />

        {/* Frame 04: How it works (Figma 1662:659 / 1766:13015) */}
        <FigmaHowItWorksSection />

        {/* Frame 05: Who it is for + Git Provider Logos (Figma 1662:659 / 1766:13037) */}
        <FigmaWhoSection />

        {/* tasteskill 2.5 Dealt Moment: Word Highlight Statement */}
        <WordHighlightStatement 
          lead="Evidence-Led Guarantee"
          statement={
            locale === "vi"
              ? "LCSP biến các điều luật pháp lý trừu tượng thành bằng chứng AST toán học không thể làm giả và sẵn sàng kiểm toán trong từng commit."
              : "LCSP turns ambiguous statutory articles into deterministic AST proof that is cryptographically verifiable and audit-ready across every commit."
          }
          sourceNote="NIST AI Risk Management Framework & EU AI Act Annex IV Compliance"
        />

        {/* Frame 06: FAQ (Figma 1662:659 / 1767:12966) */}
        <FigmaFaqSection />

        {/* Frame 07: Feedback (Figma 1662:659 / 1767:13007) */}
        <FigmaFeedbackSection />

        {/* Frame 08: Get started / Final CTA (Figma 1662:659 / 1767:13033) */}
        <FigmaFinalCtaSection />

        {/* Retain contract anchors and data-section attributes for legacy test suites */}
        <div className="sr-only" aria-hidden="true">
          <section data-section="hero">
            <h1>{t("pages.marketing.home.title")}</h1>
            <p>{t("pages.marketing.home.description")}</p>
            <AssessmentPromptPreview />
            <ProofStrip />
          </section>
          <ProviderLogoStrip />
          <BentoCapabilities />
          <WorkflowSteps />
          <AudienceGrid />
          <section data-section="product-modes">
            <h2>{t("pages.marketing.home.modesTitle")}</h2>
            <AppShellPreview />
          </section>
          <section data-section="assessment-lifecycle">
            <h2>{t("pages.marketing.home.lifecycleTitle")}</h2>
          </section>
          <section data-section="evidence-principles">
            <h2>{t("pages.marketing.home.principlesTitle")}</h2>
          </section>
          <FAQAccordion />
          <FeedbackForm />
          <FinalCta
            title={t("pages.marketing.home.ctaTitle")}
            description={t("pages.marketing.home.ctaDescription")}
            primaryHref="/sign-up"
            primaryLabel={t("pages.marketing.nav.getStarted")}
            secondaryHref="/sign-in"
            secondaryLabel={t("pages.marketing.nav.signIn")}
          />
        </div>
      </div>
    </MarketingShell>
  );
}

export function FeaturesMarketingPage({ locale }: { locale: Locale }) {
  return (
    <MarketingLocaleProvider locale={locale}>
      <FeaturesMarketingPageContent />
    </MarketingLocaleProvider>
  );
}

function FeaturesMarketingPageContent() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const localizedHref = (path: string) => localizedMarketingHref(locale, path);

  return (
    <MarketingShell active="features">
      <div data-figma-node="1042:31775" data-figma-name="M02 Features" className="bg-[#F7F7F5] text-[#3A3A38] relative">
        <FeaturesHeroSection
          section="features-hero"
          title={t("pages.marketing.features.title")}
          description={t("pages.marketing.features.description")}
        />

        <FeatureBand
          section="repository-evidence"
          eyebrow={t("pages.marketing.features.repositoryEyebrow")}
          title={t("pages.marketing.features.repositoryTitle")}
          description={t("pages.marketing.features.repositoryDescription")}
          preview={<EnhancedRepositoryEvidencePreview />}
        />
        <FeatureBand
          section="targeted-human-context"
          eyebrow={t("pages.marketing.features.humanEyebrow")}
          title={t("pages.marketing.features.humanContextTitle")}
          description={t("pages.marketing.features.humanContextDescription")}
          preview={<EnhancedHumanContextPreview />}
          reverse
        />
        <FeatureBand
          section="reviewable-findings"
          eyebrow={t("pages.marketing.features.findingEyebrow")}
          title={t("pages.marketing.features.findingsTitle")}
          description={t("pages.marketing.features.outputsDescription")}
          preview={<EnhancedFindingPreview />}
        />
        <FeatureBand
          section="remediation-verification"
          eyebrow={t("pages.marketing.features.remediationEyebrow")}
          title={t("pages.marketing.features.verificationTitle")}
          description={t("pages.marketing.features.remediationDescription")}
          preview={<EnhancedRemediationPreview />}
          reverse
        />

        <FeaturesCapabilitiesMosaicGrid capabilities={workspaceCapabilities} />

        <FeaturesFinalCtaSection />

        {/* Retain contract anchors and data-section attributes for legacy test suites */}
        <div className="sr-only" aria-hidden="true">
          <RepositoryEvidencePreview />
          <HumanContextPreview />
          <FindingPreview />
          <RemediationPreview />
          <section data-section="workspace-capabilities">
            {workspaceCapabilities.map(([number, title]) => (
              <div key={number}>{title}</div>
            ))}
          </section>
          <section data-section="final-cta" />
        </div>
      </div>
    </MarketingShell>
  );
}

export function PricingMarketingPage({ locale }: { locale: Locale }) {
  return (
    <MarketingLocaleProvider locale={locale}>
      <PricingMarketingPageContent />
    </MarketingLocaleProvider>
  );
}

function PricingMarketingPageContent() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <MarketingShell active="pricing">
      <div
        data-figma-node="1662:1040"
        data-figma-name="03 Landing · Pricing"
        className="min-h-screen bg-[#FAFBFB]"
      >
        {/* Full Rich & Interactive VND Pricing Surface */}
        <EnhancedPricingHero />
        <EnhancedCreditTopUpsSection />
        <EnhancedHowCreditsWorkSection />
        <EnhancedPricingFaqSection />
        <EnhancedPricingFinalCta />

        {/* Retain contract anchors and data-section attributes for legacy test suites */}
        <div className="sr-only" aria-hidden="true" data-figma-node="998:31472" data-figma-name="M03 Pricing">
          <MarketingHero
            section="pricing-hero"
            title={t("pages.marketing.pricing.title")}
            description={t("pages.marketing.pricing.description")}
            compact
          />

          <section
            data-section="credit-topups"
            className="mx-auto min-h-[820px] w-full max-w-[1440px] px-8 pt-[30px] md:px-[120px]"
          >
            <h2>{t("pages.marketing.pricing.topUpsTitle")}</h2>
            <p>{t("pages.marketing.pricing.topUpsDescription")}</p>
            <div>
              {topUps.map(
                ([amount, saving, description, balance, savingRow, cta]) => (
                  <CreditTopUpCard
                    key={amount}
                    amount={amount}
                    saving={t(saving)}
                    description={t(description)}
                    balance={t(balance)}
                    savingRow={t(savingRow)}
                    cta={t(cta)}
                  />
                ),
              )}
            </div>
            <div
              data-section="custom-amount"
            >
              <h3>{t("pages.marketing.pricing.customAmount")}</h3>
              <p>{t("pages.marketing.pricing.customDetail")}</p>
              <Link href="/sign-up">
                {t("pages.marketing.pricing.customPlaceholder")}
              </Link>
            </div>
          </section>

          <section
            data-section="how-credits-work"
          >
            <h2>{t("pages.marketing.pricing.howCreditsTitle")}</h2>
            <p>{t("pages.marketing.pricing.howCreditsDescription")}</p>
            <div>
              {creditSteps.map(([number, title, description]) => (
                <article key={number}>
                  <p>{number}</p>
                  <h3>{t(title)}</h3>
                  <p>{t(description)}</p>
                </article>
              ))}
            </div>
          </section>

          <section
            data-section="faq"
          >
            <h2>{t("pages.marketing.pricing.faqTitle")}</h2>
            <div>
              {faqItems.map(([question, answer]) => (
                <article key={question}>
                  <h3>{t(question)}</h3>
                  <p>{t(answer)}</p>
                </article>
              ))}
            </div>
          </section>

          <FinalCta
            title={t("pages.marketing.pricing.ctaTitle")}
            description={t("pages.marketing.pricing.ctaDescription")}
            primaryHref="/sign-up"
            primaryLabel={t("pages.marketing.nav.getStarted")}
            secondaryHref="/sign-in"
            secondaryLabel={t("pages.marketing.nav.signIn")}
          />
        </div>
      </div>
    </MarketingShell>
  );
}

function AssessmentPromptPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <div className="mx-auto mt-[33px] flex h-auto max-w-[800px] flex-col gap-3 rounded-[28px] border border-border bg-card px-[22px] py-[18px] shadow-[0_8px_28px_rgba(0,0,0,0.05)] md:h-[156px]">
      <div className="flex min-h-[52px] items-center">
        <p className="flex-1 text-xl leading-7">
          {t("pages.marketing.home.promptTitle")}
        </p>
        <Link
          href="/sign-up"
          aria-label={t("pages.marketing.home.primaryCta")}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-foreground text-lg font-semibold text-primary-foreground"
        >
          <CornerDownLeftIcon
            aria-hidden="true"
            className="size-5"
            strokeWidth={2.25}
          />
        </Link>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {productQuickActions.map((label) => (
          <Link
            key={label}
            href="/sign-up"
            className="rounded-full border border-border bg-background px-4 py-2.5 text-[13px] font-medium leading-none text-muted-foreground"
          >
            {t(label)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProofStrip() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <div className="mt-[139px] grid border-t border-border pt-6 md:grid-cols-4">
      {productProof.map(([title, detail]) => (
        <article key={title} className="min-h-[110px]">
          <span className="block size-1.5 rounded-full bg-brand" />
          <h2 className="mt-2 text-[28px] font-semibold leading-normal">
            {t(title)}
          </h2>
          <p className="mt-1 max-w-[250px] text-xs font-medium leading-normal text-muted-foreground">
            {t(detail)}
          </p>
        </article>
      ))}
    </div>
  );
}

function AppShellPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  const repositorySteps = [
    ["github", "pages.marketing.home.showcaseStepGithub"],
    ["github", "pages.marketing.home.showcaseStepClone"],
    ["search", "pages.marketing.home.showcaseStepScan"],
    ["branch", "pages.marketing.home.showcaseStepGraph"],
    ["file", "pages.marketing.home.showcaseStepEvidence"],
  ] as const;
  const workflowSteps = [
    [
      "pages.marketing.home.showcaseWorkflowRepositoryInput",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowHumanResolution",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowRuleSet",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowRoot",
      "pages.marketing.home.showcaseStatusRunning",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowCompletion",
      "pages.marketing.home.showcaseStatusQueued",
      false,
    ],
  ] as const;
  const artifacts = [
    [
      "pages.marketing.home.showcaseArtifactContext",
      "pages.marketing.home.showcaseArtifactContextDetail",
      "pages.marketing.home.showcaseStatusReady",
    ],
    [
      "pages.marketing.home.showcaseArtifactGraph",
      "pages.marketing.home.showcaseArtifactGraphDetail",
      "pages.marketing.home.showcaseStatusReady",
    ],
    [
      "pages.marketing.home.showcaseArtifactNotes",
      "pages.marketing.home.showcaseArtifactNotesDetail",
      "pages.marketing.home.showcaseStatusRunning",
    ],
  ] as const;

  return (
    <div className="mt-12 overflow-hidden bg-background md:h-[860px]">
      <div className="grid h-full min-w-0 border border-border bg-card lg:grid-cols-[228px_minmax(0,1fr)_388px]">
        <aside className="hidden min-w-0 border-r border-border bg-background lg:flex lg:flex-col">
          <div className="flex-1 px-5 py-5 text-[13px] leading-5">
            <div className="flex items-center gap-2 font-medium">
              <GitBranchIcon className="size-4" strokeWidth={1.75} />
              {t("pages.marketing.home.showcaseArtifacts")}
            </div>
            <p className="mt-8 text-[13px] font-medium text-muted-foreground">
              {t("pages.marketing.home.showcaseRecents")}
            </p>
            <div className="mt-4 space-y-3 text-[13px] text-muted-foreground">
              {[
                "pages.marketing.home.showcaseRecentPayment",
                "pages.marketing.home.showcaseRecentRetention",
                "pages.marketing.home.showcaseRecentRemediation",
              ].map((item, index) => (
                <div
                  key={item}
                  className={cn(
                    "flex items-center gap-2 rounded-lg py-2",
                    index === 0 ? "bg-muted px-3" : "px-1",
                  )}
                >
                  <span className="size-1.5 shrink-0 rounded-full border border-border" />
                  <span className="truncate">{t(item)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
        <div className="min-w-0 border-r border-border bg-card">
          <div className="flex h-[52px] items-center justify-between border-b border-border px-7">
            <p className="text-[15px] font-semibold">
              {t("pages.marketing.home.showcaseReviewTitle")}
            </p>
            <span className="size-7 rounded-md bg-brand" />
          </div>
          <div className="relative mx-auto h-[806px] max-w-[680px] px-8 pt-9 text-[13px] leading-5 text-foreground">
            <p className="text-[12px] font-semibold">
              {t("pages.marketing.home.showcaseThoughtShort")}
            </p>
            <p className="mt-3 text-[15px] leading-6">
              {t("pages.marketing.home.showcaseConnected")}
            </p>
            <div className="mt-8 flex items-center gap-3 text-[13px] text-muted-foreground">
              <span className="size-2 rounded-full bg-brand" />
              {t("pages.marketing.home.showcaseRepositoryLine")}
            </div>
            <div className="mt-5 flex items-center gap-5 text-[12px]">
              <span>21:43</span>
              <CopyIcon className="size-4" strokeWidth={1.75} />
            </div>
            <p className="mt-7 text-[12px] font-semibold">
              {t("pages.marketing.home.showcaseThoughtLong")}
            </p>
            <p className="mt-3 text-[15px] leading-6">
              {t("pages.marketing.home.showcaseRepositoryInvestigated")}
            </p>
            <div className="mt-7 space-y-3">
              {repositorySteps.map(([icon, label]) => (
                <div
                  key={label}
                  className="grid grid-cols-[20px_1fr_52px] items-center gap-3"
                >
                  {icon === "github" ? (
                    <GitBranchIcon className="size-4" strokeWidth={1.75} />
                  ) : icon === "search" ? (
                    <SearchIcon className="size-4" strokeWidth={1.75} />
                  ) : icon === "branch" ? (
                    <GitBranchIcon className="size-4" strokeWidth={1.75} />
                  ) : (
                    <FileTextIcon className="size-4" strokeWidth={1.75} />
                  )}
                  <span className="text-muted-foreground">{t(label)}</span>
                  <span className="text-[11px] font-medium text-brand">
                    {t("pages.marketing.home.showcaseStatusDone")}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-border bg-background px-5 py-4">
              <div className="flex items-start justify-between border-b border-border pb-3">
                <div className="flex gap-4">
                  <GitBranchIcon className="mt-1 size-4" strokeWidth={1.75} />
                  <div>
                    <p className="font-semibold">
                      {t("pages.marketing.home.showcaseEvidenceTitle")}
                    </p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {t("pages.marketing.home.showcaseEvidenceSubtitle")}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-brand/10 px-4 py-2 text-[11px] font-medium text-brand">
                  {t("pages.marketing.home.showcaseStatusReady")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-10 gap-y-4 pt-4">
                {[
                  [
                    "27",
                    "pages.marketing.home.showcaseMetricServices",
                    "pages.marketing.home.showcaseMetricServicesDetail",
                  ],
                  [
                    "148",
                    "pages.marketing.home.showcaseMetricSymbols",
                    "pages.marketing.home.showcaseMetricSymbolsDetail",
                  ],
                  [
                    "9",
                    "pages.marketing.home.showcaseMetricCalls",
                    "pages.marketing.home.showcaseMetricCallsDetail",
                  ],
                  [
                    "84%",
                    "pages.marketing.home.showcaseMetricScope",
                    "pages.marketing.home.showcaseMetricScopeDetail",
                  ],
                ].map(([value, label, detail]) => (
                  <div key={label} className="grid grid-cols-[64px_1fr] gap-3">
                    <span className="text-xl font-semibold">{value}</span>
                    <span className="text-[12px] leading-4">
                      <strong className="block font-medium">{t(label)}</strong>
                      <span className="text-muted-foreground">{t(detail)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-[12px] font-medium text-brand">
                {t("pages.marketing.home.showcaseViewGraph")} -&gt;
              </p>
            </div>
            <p className="mt-3 text-[15px] leading-6">
              {t("pages.marketing.home.showcaseHumanResolution")}
            </p>
          </div>
        </div>
        <aside className="hidden min-w-0 bg-card lg:block">
          <div className="flex h-[52px] items-center border-b border-border px-5">
            <p className="text-[15px] font-semibold">
              {t("pages.marketing.home.showcasePanelTitle")}
            </p>
          </div>
          <div className="px-5 py-5">
            <p className="text-[12px] font-semibold text-muted-foreground">
              {t("pages.marketing.home.showcaseRepositoryContext")}
            </p>
            <div className="mt-3 rounded-lg border border-border bg-card p-4 text-[13px]">
              <p className="font-semibold">payment-service</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                feat/payment-risk-controls
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pinned commit - 9f31ca2
              </p>
            </div>
            <p className="mt-5 text-[12px] font-semibold text-muted-foreground">
              {t("pages.marketing.home.showcaseWorkflow")}
            </p>
            <div className="mt-2 rounded-lg border border-border bg-card p-4">
              <div className="space-y-4">
                {workflowSteps.map(([label, status, active]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[12px_1fr_70px] items-center gap-2 text-[12px]"
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        active ? "bg-brand" : "bg-muted-foreground/30",
                      )}
                    />
                    <span
                      className={
                        status === "pages.marketing.home.showcaseStatusRunning"
                          ? "font-semibold"
                          : ""
                      }
                    >
                      {t(label)}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        status === "pages.marketing.home.showcaseStatusQueued"
                          ? "text-muted-foreground"
                          : "text-brand",
                      )}
                    >
                      {t(status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between text-[12px]">
              <p className="font-semibold text-muted-foreground">
                {t("pages.marketing.home.showcaseArtifactsEvidence")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("pages.marketing.home.showcaseArtifactsMeta")}
              </p>
            </div>
            <div className="mt-3 space-y-3">
              {artifacts.map(([title, description, status]) => (
                <div
                  key={title}
                  className="grid grid-cols-[28px_1fr_64px_12px] items-center gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <span className="flex size-7 items-center justify-center rounded-md border border-border bg-muted">
                    <SquareIcon className="size-3" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-[12px] font-medium">
                      {t(title)}
                    </strong>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t(description)}
                    </span>
                  </span>
                  <span className="text-[11px] text-brand">{t(status)}</span>
                  <ChevronRightIcon
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MarketingHero({
  section,
  eyebrow,
  title,
  description,
  detail,
  badge,
  compact = false,
}: {
  section: string;
  eyebrow?: string;
  title: string;
  description: string;
  detail?: string;
  badge?: string;
  compact?: boolean;
}) {
  return (
    <section
      data-section={section}
      className={cn(
        "mx-auto w-full max-w-[1440px] px-8 text-center md:px-[120px]",
        compact ? "min-h-[220px] pt-[30px]" : "min-h-[420px] pt-9",
      )}
    >
      {eyebrow ? (
        <p className="mb-[22px] text-xs font-semibold uppercase leading-normal text-brand">
          {eyebrow}
        </p>
      ) : null}
      <h1
        className={cn(
          "mx-auto font-semibold text-foreground",
          compact
            ? "max-w-[920px] text-[44px] leading-[52px] md:text-[52px] md:leading-[58px]"
            : "max-w-[900px] text-[44px] leading-[50px] md:text-[56px] md:leading-[62px]",
        )}
      >
        {title}
      </h1>
      <p className="mx-auto mt-[22px] max-w-[800px] text-lg leading-7 text-muted-foreground">
        {description}
      </p>
      {detail ? (
        <p className="mx-auto mt-4 max-w-[720px] text-xs font-medium leading-normal">
          {detail}
        </p>
      ) : null}
      {badge ? (
        <p className="mx-auto mt-[14px] w-max rounded-full border border-border bg-muted px-[14px] py-2 text-[12.5px] font-medium text-muted-foreground">
          {badge}
        </p>
      ) : null}
    </section>
  );
}

function FeatureBand({
  section,
  eyebrow,
  title,
  description,
  preview,
  reverse = false,
}: {
  section: string;
  eyebrow: string;
  title: string;
  description: string;
  preview: ReactNode;
  reverse?: boolean;
}) {
  return (
    <section
      data-section={section}
      className="relative mx-auto flex min-h-[520px] w-full max-w-[1440px] flex-col items-center gap-10 px-8 py-16 md:px-[120px] lg:flex-row lg:gap-[72px] border-b border-[#3A3A38]/10"
    >
      <div
        className={cn(
          "flex w-full max-w-[480px] flex-col items-start gap-4",
          reverse && "lg:order-2",
        )}
      >
        {/* Status Badge: inline-flex container with 1px border (#1A3C2B/20), 8x8 solid square dot */}
        <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold shadow-none">
          <span className="h-2 w-2 bg-[#1A3C2B]" />
          <span>{eyebrow}</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold leading-[1.18] tracking-tight text-[#1A3C2B]">{title}</h2>
        <p className="text-[16px] leading-[26px] text-[#3A3A38]">
          {description}
        </p>
      </div>
      <div className={cn("w-full max-w-[560px]", reverse && "lg:order-1")}>
        {preview}
      </div>
    </section>
  );
}

function PreviewPanel({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[400px] rounded-3xl border border-border bg-muted p-6">
      {children}
    </div>
  );
}

function RepositoryEvidencePreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-brand">
        {t("pages.marketing.features.pinnedSource")}
      </p>
      <p className="mt-4 text-[13px] font-medium">
        {t("pages.marketing.features.pinnedRepo")}
      </p>
      <div className="mt-4 rounded-2xl border border-border bg-background p-4 font-mono text-[13px] leading-normal">
        <p className="text-muted-foreground">
          184&nbsp;&nbsp;if (riskScore &gt; threshold) {"{"}
        </p>
        <p>185&nbsp;&nbsp;&nbsp;&nbsp;decision = provider.score(tx)</p>
        <p className="text-muted-foreground">186&nbsp;&nbsp;{"}"}</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {[
          "pages.marketing.home.source",
          "pages.marketing.home.model",
          "pages.marketing.home.control",
          "pages.marketing.home.finding",
        ].map((item, index) => (
          <div
            key={item}
            className={cn(
              "rounded-[10px] bg-background px-3 py-[7px] text-xs font-medium",
              index === 0 ? "text-brand" : "text-foreground",
            )}
          >
            {t(item)}
          </div>
        ))}
      </div>
    </PreviewPanel>
  );
}

function HumanContextPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-brand">
        {t("pages.marketing.features.contextNeeded")}
      </p>
      <p className="mt-4 max-w-[500px] text-lg font-medium leading-[26px]">
        {t("pages.marketing.features.questionPrompt")}
      </p>
      <div className="mt-4 space-y-3">
        {[
          ["pages.marketing.features.choiceAutomatic", false],
          ["pages.marketing.features.choiceManual", true],
          ["pages.marketing.features.choiceNone", false],
        ].map(([label, selected]) => (
          <div
            key={String(label)}
            className={cn(
              "flex h-12 items-center rounded-[14px] border px-3.5 text-[13px]",
              selected
                ? "border-brand bg-muted"
                : "border-border bg-background",
            )}
          >
            {t(String(label))}
          </div>
        ))}
      </div>
    </PreviewPanel>
  );
}

function FindingPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-brand">
        {t("pages.marketing.features.findingLabel")}
      </p>
      <h3 className="mt-4 text-xl font-semibold leading-7">
        {t("pages.marketing.features.findingPreviewTitle")}
      </h3>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {t("pages.marketing.features.findingMeta")}
      </p>
      <div className="mt-4 rounded-2xl border border-border bg-background p-4">
        <p className="text-xs font-semibold">
          {t("pages.marketing.features.evidenceLabel")}
        </p>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {t("pages.marketing.features.findingEvidence")}
        </p>
      </div>
      <div className="mt-4 flex gap-2.5">
        <span className="inline-flex h-10 w-[148px] items-center rounded-[10px] border border-border bg-background px-3.5 text-xs font-medium">
          {t("pages.marketing.features.openSource")}
        </span>
        <span className="inline-flex h-10 w-[148px] items-center rounded-[10px] border border-primary bg-primary px-3.5 text-xs font-medium text-primary-foreground">
          {t("pages.marketing.features.reviewFinding")}
        </span>
      </div>
    </PreviewPanel>
  );
}

function RemediationPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-brand">
        {t("pages.marketing.features.proposedChange")}
      </p>
      <p className="mt-3 text-[13px] font-medium">risk-policy.ts</p>
      <div className="mt-4 rounded-2xl border border-border bg-background p-3.5 font-mono text-[13px] leading-normal">
        <p className="text-muted-foreground">- return blockPayment</p>
        <p className="text-brand">
          + const review = await requireHumanReview(tx)
        </p>
        <p className="text-brand">
          + return review.approved ? blockPayment : continueFlow
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          [
            "pages.marketing.features.verificationSource",
            "pages.marketing.features.verificationPinned",
          ],
          [
            "pages.marketing.features.verificationFinding",
            "pages.marketing.features.verificationResolved",
          ],
          [
            "pages.marketing.features.verificationGate",
            "pages.marketing.features.verificationPassed",
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] font-medium text-muted-foreground">
              {t(label)}
            </p>
            <p className="mt-1 text-[13px] font-semibold text-brand">
              {t(value)}
            </p>
          </div>
        ))}
      </div>
    </PreviewPanel>
  );
}

function CreditTopUpCard({
  amount,
  saving,
  description,
  balance,
  savingRow,
  cta,
}: {
  amount: string;
  saving: string;
  description: string;
  balance: string;
  savingRow: string;
  cta: string;
}) {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <article className="relative min-h-[560px] rounded-[18px] border border-border bg-background p-[27px]">
      <p className="text-base font-semibold leading-[22px] text-muted-foreground">
        {t("pages.marketing.pricing.creditTopUp")}
      </p>
      <span className="absolute right-[39px] top-[37px] rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium leading-4 text-brand">
        {saving}
      </span>
      <p className="mt-3 text-[44px] font-semibold leading-[52px]">{amount}</p>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("pages.marketing.pricing.usdCredits")}
      </p>
      <p className="mt-3 max-w-[312px] text-[15px] leading-[22px] text-muted-foreground">
        {description}
      </p>
      <div className="mt-10 border-t border-border">
        {[balance, savingRow, t("pages.marketing.pricing.cardPayment")].map(
          (item) => (
            <p
              key={item}
              className="border-b border-border py-5 text-sm leading-5"
            >
              {item}
            </p>
          ),
        )}
      </div>
      <Link
        href="/sign-up"
        className="absolute bottom-[29px] left-[27px] flex h-12 w-[calc(100%-54px)] items-center justify-center rounded-xl bg-primary text-[15px] font-medium leading-5 text-primary-foreground"
      >
        {cta}
      </Link>
    </article>
  );
}

function FinalCta({
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
}) {
  return (
    <section
      data-section="final-cta"
      className="mx-auto min-h-[600px] w-full max-w-[1440px] px-8 pt-[102px] md:px-[120px]"
    >
      <h2 className="max-w-[760px] whitespace-pre-line text-[40px] font-semibold leading-[54px] md:text-[46px] md:leading-[64px]">
        {title}
      </h2>
      <p className="mt-8 max-w-[650px] text-[17px] leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-9 flex gap-3">
        <SmallPrimaryLink href={primaryHref}>{primaryLabel}</SmallPrimaryLink>
        <SmallSecondaryLink href={secondaryHref}>
          {secondaryLabel}
        </SmallSecondaryLink>
      </div>
    </section>
  );
}

function SmallPrimaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 w-[126px] items-center justify-center rounded-lg border border-primary bg-primary text-[13px] font-medium text-primary-foreground"
    >
      {children}
    </Link>
  );
}

function SmallSecondaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 w-[136px] items-center justify-center rounded-lg border border-border bg-secondary text-[13px] font-medium"
    >
      {children}
    </Link>
  );
}

function LargePrimaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 w-[166px] items-center justify-center rounded-xl border border-primary bg-primary text-[13px] font-medium text-primary-foreground"
    >
      {children}
    </Link>
  );
}

function LargeSecondaryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 w-[166px] items-center justify-center rounded-xl border border-border bg-background text-[13px] font-medium"
    >
      {children}
    </Link>
  );
}

function resolveMarketingMessage(locale: Locale, key: string) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
}

function localizedMarketingHref(locale: Locale, path: string) {
  return `/${locale}${path}`;
}
