import { resolveMessage } from "@lcsp/i18n";
import {
  ChevronRightIcon,
  CopyIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  GitBranchIcon,
  PanelLeftIcon,
  SearchIcon,
  SquareIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { MarketingShell } from "./marketing-shell";

const productQuickActions = [
  "pages.marketing.home.quickRepository",
  "pages.marketing.home.quickUseCase",
  "pages.marketing.home.quickEvidence",
] as const;

const productProof = [
  ["pages.marketing.home.valuePinned", "pages.marketing.home.valuePinnedDetail"],
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
  ["01", "pages.marketing.home.lifecycleConnect", "pages.marketing.home.lifecycleConnectDetail"],
  ["02", "pages.marketing.home.lifecycleScan", "pages.marketing.home.lifecycleScanDetail"],
  ["03", "pages.marketing.home.lifecycleContext", "pages.marketing.home.lifecycleContextDetail"],
  ["04", "pages.marketing.home.lifecycleReview", "pages.marketing.home.lifecycleReviewDetail"],
  ["05", "pages.marketing.home.lifecycleVerify", "pages.marketing.home.lifecycleVerifyDetail"],
] as const;

const evidencePrinciples = [
  ["pages.marketing.home.principlePinnedTitle", "pages.marketing.home.principlePinned"],
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
  ["$50", "pages.marketing.pricing.save10", "pages.marketing.pricing.topUp50Description", "pages.marketing.pricing.topUp50Balance", "pages.marketing.pricing.topUp50Saving", "pages.marketing.pricing.add50"],
  ["$250", "pages.marketing.pricing.save20", "pages.marketing.pricing.topUp250Description", "pages.marketing.pricing.topUp250Balance", "pages.marketing.pricing.topUp250Saving", "pages.marketing.pricing.add250"],
  ["$1,000", "pages.marketing.pricing.save30", "pages.marketing.pricing.topUp1000Description", "pages.marketing.pricing.topUp1000Balance", "pages.marketing.pricing.topUp1000Saving", "pages.marketing.pricing.add1000"],
] as const;

const creditSteps = [
  ["01", "pages.marketing.pricing.stepTopUpTitle", "pages.marketing.pricing.stepTopUpDescription"],
  ["02", "pages.marketing.pricing.stepUseTitle", "pages.marketing.pricing.stepUseDescription"],
  ["03", "pages.marketing.pricing.stepReloadTitle", "pages.marketing.pricing.stepReloadDescription"],
] as const;

const faqItems = [
  ["pages.marketing.pricing.faqPayGoQuestion", "pages.marketing.pricing.faqPayGoAnswer"],
  ["pages.marketing.pricing.faqCustomQuestion", "pages.marketing.pricing.faqCustomAnswer"],
  ["pages.marketing.pricing.faqDiscountQuestion", "pages.marketing.pricing.faqDiscountAnswer"],
  ["pages.marketing.pricing.faqReloadQuestion", "pages.marketing.pricing.faqReloadAnswer"],
] as const;

export function ProductMarketingPage() {
  return (
    <MarketingShell active="product">
      <div data-figma-node="923:31255" data-figma-name="M01 Overview">
        <section
          data-section="hero"
          className="mx-auto min-h-[828px] w-full max-w-[1440px] px-8 pt-[92px] md:px-[120px]"
        >
          <div className="mx-auto max-w-[920px] text-center">
            <h1 className="whitespace-pre-line text-[44px] font-semibold leading-[48px] text-[#2d2d2a] md:text-[60px] md:leading-[64px]">
              {t("pages.marketing.home.title")}
            </h1>
            <p className="mx-auto mt-8 max-w-[720px] text-[18px] leading-[27px] text-[#5f5f5a]">
              {t("pages.marketing.home.description")}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <SmallPrimaryLink href="/sign-up">
                {t("pages.marketing.home.primaryCta")}
              </SmallPrimaryLink>
              <SmallSecondaryLink href="/features">
                {t("pages.marketing.home.secondaryCta")}
              </SmallSecondaryLink>
            </div>
          </div>

          <AssessmentPromptPreview />
          <ProofStrip />
        </section>

        <section
          data-section="product-modes"
          className="mx-auto min-h-[1150px] w-full max-w-[1440px] px-8 pt-[78px] md:px-[120px]"
        >
          <h2 className="max-w-[720px] whitespace-pre-line text-[36px] font-semibold leading-[44px] md:text-[44px] md:leading-[64px]">
            {t("pages.marketing.home.modesTitle")}
          </h2>
          <p className="mt-4 max-w-[660px] text-[17px] leading-[25px] text-[#5f5f5a]">
            {t("pages.marketing.home.modesDescription")}
          </p>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-[60px]">
            {modes.map(([title, description]) => (
              <div key={title}>
                <h3 className="text-[22px] font-semibold leading-[64px]">
                  {t(title)}
                </h3>
                <p className="max-w-[330px] text-xs font-medium leading-normal">
                  {t(description)}
                </p>
              </div>
            ))}
          </div>
          <AppShellPreview />
        </section>

        <section
          data-section="assessment-lifecycle"
          className="mx-auto grid min-h-[1000px] w-full max-w-[1440px] gap-16 px-8 pt-24 md:px-[120px] lg:grid-cols-[500px_1fr]"
        >
          <div>
            <h2 className="max-w-[560px] whitespace-pre-line text-[36px] font-semibold leading-[44px] md:text-[44px] md:leading-[64px]">
              {t("pages.marketing.home.lifecycleTitle")}
            </h2>
            <p className="mt-6 max-w-[500px] text-[17px] leading-[25px] text-[#5f5f5a]">
              {t("pages.marketing.home.lifecycleDescription")}
            </p>
          </div>
          <div className="pt-4">
            {lifecycleSteps.map(([number, title, description], index) => (
              <div
                key={number}
                className={cn(
                  "grid grid-cols-[36px_1fr] gap-0 border-[#e3e3de] pb-11",
                  index < lifecycleSteps.length - 1 && "border-b mb-[51px]",
                )}
              >
                <div className="flex items-start">
                  <span className="text-[11px] font-medium leading-5">{number}</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold leading-7">{t(title)}</h3>
                  <p className="mt-2 max-w-[400px] text-[13px] leading-[25px] text-[#5f5f5a]">
                    {t(description)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          data-section="evidence-principles"
          className="mx-auto min-h-[850px] w-full max-w-[1440px] px-8 pt-[92px] md:px-[120px]"
        >
          <h2 className="max-w-[700px] whitespace-pre-line text-[36px] font-semibold leading-[44px] md:text-[44px] md:leading-[64px]">
            {t("pages.marketing.home.principlesTitle")}
          </h2>
          <p className="mt-4 max-w-[610px] text-[17px] leading-[25px] text-[#5f5f5a]">
            {t("pages.marketing.home.principlesDescription")}
          </p>
          <div className="mt-16 grid border-t border-[#e3e3de] pt-14 md:grid-cols-2 md:gap-x-[76px]">
            {evidencePrinciples.map(([title, description]) => (
              <article key={title} className="border-b border-[#e3e3de] pb-8">
                <div className="flex gap-4">
                  <span className="mt-2 size-2 shrink-0 rounded-full bg-[#0e7c66]" />
                  <div>
                    <h3 className="text-xl font-semibold leading-7">
                      {t(title)}
                    </h3>
                    <p className="mt-2 max-w-[500px] text-[13px] leading-[25px] text-[#5f5f5a]">
                      {t(description)}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <FinalCta
          title={t("pages.marketing.home.ctaTitle")}
          description={t("pages.marketing.home.ctaDescription")}
          primaryHref="/sign-up"
          primaryLabel={t("pages.marketing.nav.getStarted")}
          secondaryHref="/sign-in"
          secondaryLabel={t("pages.marketing.nav.signIn")}
        />
      </div>
    </MarketingShell>
  );
}

export function FeaturesMarketingPage() {
  return (
    <MarketingShell active="features">
      <div data-figma-node="1042:31775" data-figma-name="M02 Features">
        <MarketingHero
          section="features-hero"
          title={t("pages.marketing.features.title")}
          description={t("pages.marketing.features.description")}
        />

        <FeatureBand
          section="repository-evidence"
          eyebrow={t("pages.marketing.features.repositoryEyebrow")}
          title={t("pages.marketing.features.repositoryTitle")}
          description={t("pages.marketing.features.repositoryDescription")}
          preview={<RepositoryEvidencePreview />}
        />
        <FeatureBand
          section="targeted-human-context"
          eyebrow={t("pages.marketing.features.humanEyebrow")}
          title={t("pages.marketing.features.humanContextTitle")}
          description={t("pages.marketing.features.interviewDescription")}
          preview={<HumanContextPreview />}
          reverse
        />
        <FeatureBand
          section="reviewable-findings"
          eyebrow={t("pages.marketing.features.findingEyebrow")}
          title={t("pages.marketing.features.findingsTitle")}
          description={t("pages.marketing.features.outputsDescription")}
          preview={<FindingPreview />}
        />
        <FeatureBand
          section="remediation-verification"
          eyebrow={t("pages.marketing.features.remediationEyebrow")}
          title={t("pages.marketing.features.verificationTitle")}
          description={t("pages.marketing.features.remediationDescription")}
          preview={<RemediationPreview />}
          reverse
        />

        <section
          data-section="workspace-capabilities"
          className="mx-auto min-h-[560px] w-full max-w-[1440px] px-8 pt-[54px] md:px-[120px]"
        >
          <h2 className="max-w-[760px] text-4xl font-semibold leading-[44px]">
            {t("pages.marketing.features.capabilitiesTitle")}
          </h2>
          <p className="mt-[14px] max-w-[780px] text-[17px] leading-[27px] text-[#5f5f5a]">
            {t("pages.marketing.features.capabilitiesDescription")}
          </p>
          <div className="mt-[46px] grid gap-6 lg:grid-cols-3">
            {workspaceCapabilities.map(([number, title, description, meta]) => (
              <article
                key={number}
                className="min-h-[280px] rounded-3xl border border-[#e3e3de] bg-[#f2f2ef] p-[22px]"
              >
                <p className="text-xs font-semibold leading-normal text-[#10a37f]">
                  {number}
                </p>
                <h3 className="mt-[14px] max-w-[330px] text-[22px] font-semibold leading-[30px]">
                  {t(title)}
                </h3>
                <p className="mt-[14px] max-w-[330px] text-sm leading-[22px] text-[#5f5f5a]">
                  {t(description)}
                </p>
                <div className="my-[14px] h-px w-full bg-[#e3e3de]" />
                <p className="max-w-[330px] text-xs font-medium leading-[18px]">
                  {t(meta)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          data-section="final-cta"
          className="mx-auto mb-10 min-h-[280px] w-full max-w-[1200px] rounded-[28px] border border-[#e3e3de] bg-[#f2f2ef] px-8 pt-[52px] text-center"
        >
          <h2 className="mx-auto max-w-[760px] text-[34px] font-semibold leading-[42px]">
            {t("pages.marketing.features.ctaTitle")}
          </h2>
          <p className="mx-auto mt-[18px] max-w-[700px] text-base leading-[25px] text-[#5f5f5a]">
            {t("pages.marketing.features.ctaDescription")}
          </p>
          <div className="mt-[18px] flex justify-center gap-3">
            <LargePrimaryLink href="/sign-up">
              {t("pages.marketing.nav.getStarted")}
            </LargePrimaryLink>
            <LargeSecondaryLink href="/pricing">
              {t("pages.marketing.features.viewPricing")}
            </LargeSecondaryLink>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}

export function PricingMarketingPage() {
  return (
    <MarketingShell active="pricing">
      <div data-figma-node="998:31472" data-figma-name="M03 Pricing">
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
          <h2 className="text-[28px] font-semibold leading-9">
            {t("pages.marketing.pricing.topUpsTitle")}
          </h2>
          <p className="mt-1 text-[15px] leading-[22px] text-[#5f5f5a]">
            {t("pages.marketing.pricing.topUpsDescription")}
          </p>
          <div className="mt-8 grid gap-9 lg:grid-cols-3">
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
            className="mt-[26px] flex min-h-[76px] flex-col gap-5 rounded-2xl border border-[#e3e3de] bg-[#f2f2ef] p-[22px] lg:flex-row lg:items-center lg:justify-between lg:px-[23px] lg:py-[15px]"
          >
            <div>
              <h3 className="text-[15px] font-medium leading-[22px]">
                {t("pages.marketing.pricing.customAmount")}
              </h3>
              <p className="mt-0.5 text-[13px] leading-[18px] text-[#5f5f5a]">
                {t("pages.marketing.pricing.customDetail")}
              </p>
            </div>
            <Link
              href="/sign-up"
              className="inline-flex h-11 w-44 items-center justify-center rounded-[10px] border border-[#e3e3de] bg-[#f7f7f5] text-sm font-medium"
            >
              {t("pages.marketing.pricing.customPlaceholder")}
            </Link>
          </div>
        </section>

        <section
          data-section="how-credits-work"
          className="mx-auto min-h-[620px] w-full max-w-[1440px] px-8 pt-[74px] md:px-[120px]"
        >
          <h2 className="text-[40px] font-semibold leading-[48px]">
            {t("pages.marketing.pricing.howCreditsTitle")}
          </h2>
          <p className="mt-4 max-w-[760px] text-base leading-6 text-[#5f5f5a]">
            {t("pages.marketing.pricing.howCreditsDescription")}
          </p>
          <div className="mt-[60px] grid gap-9 lg:grid-cols-3">
            {creditSteps.map(([number, title, description]) => (
              <article
                key={number}
                className="min-h-[220px] rounded-[18px] border border-[#e3e3de] bg-[#f7f7f5] p-[23px]"
              >
                <p className="text-[13px] font-medium text-[#10a37f]">
                  {number}
                </p>
                <h3 className="mt-6 text-[22px] font-semibold leading-7">
                  {t(title)}
                </h3>
                <p className="mt-[18px] max-w-[310px] text-sm leading-[21px] text-[#5f5f5a]">
                  {t(description)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          data-section="faq"
          className="mx-auto min-h-[850px] w-full max-w-[1440px] px-8 pt-[84px] md:px-[120px]"
        >
          <h2 className="text-[42px] font-semibold leading-[58px]">
            {t("pages.marketing.pricing.faqTitle")}
          </h2>
          <div className="mt-[46px] border-t border-[#e3e3de]">
            {faqItems.map(([question, answer]) => (
              <article
                key={question}
                className="grid border-b border-[#e3e3de] py-[30px] lg:grid-cols-[430px_590px] lg:gap-[70px]"
              >
                <h3 className="text-[19px] font-semibold leading-[30px]">
                  {t(question)}
                </h3>
                <p className="text-[13px] leading-6 text-[#5f5f5a]">
                  {t(answer)}
                </p>
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
    </MarketingShell>
  );
}

function AssessmentPromptPreview() {
  return (
    <div className="mx-auto mt-[33px] flex h-auto max-w-[800px] flex-col gap-3 rounded-[28px] border border-[#e3e3de] bg-white px-[22px] py-[18px] shadow-[0_8px_28px_rgba(0,0,0,0.05)] md:h-[156px]">
      <div className="flex min-h-[52px] items-center">
        <p className="flex-1 text-xl leading-7">
          {t("pages.marketing.home.promptTitle")}
        </p>
        <Link
          href="/sign-up"
          aria-label={t("pages.marketing.home.primaryCta")}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-[#292927] text-lg font-semibold text-white"
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
            className="rounded-full border border-[#e3e3de] bg-[#f7f7f5] px-4 py-2.5 text-[13px] font-medium leading-none text-[#5f5f5a]"
          >
            {t(label)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProofStrip() {
  return (
    <div className="mt-[139px] grid border-t border-[#e3e3de] pt-6 md:grid-cols-4">
      {productProof.map(([title, detail]) => (
        <article key={title} className="min-h-[110px]">
          <span className="block size-1.5 rounded-full bg-[#0e7c66]" />
          <h2 className="mt-2 text-[28px] font-semibold leading-normal">
            {t(title)}
          </h2>
          <p className="mt-1 max-w-[250px] text-xs font-medium leading-normal text-[#5f5f5a]">
            {t(detail)}
          </p>
        </article>
      ))}
    </div>
  );
}

function AppShellPreview() {
  const scannerSteps = [
    ["github", "pages.marketing.home.showcaseStepGithub"],
    ["github", "pages.marketing.home.showcaseStepClone"],
    ["search", "pages.marketing.home.showcaseStepScan"],
    ["branch", "pages.marketing.home.showcaseStepGraph"],
    ["file", "pages.marketing.home.showcaseStepEvidence"],
  ] as const;
  const workflowSteps = [
    [
      "pages.marketing.home.showcaseWorkflowScanner",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowInterview",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowRules",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowPlanner",
      "pages.marketing.home.showcaseStatusPassed",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowInvestigate",
      "pages.marketing.home.showcaseStatusRunning",
      true,
    ],
    [
      "pages.marketing.home.showcaseWorkflowGate",
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
    <div className="mt-12 overflow-hidden bg-[#f7f7f5] md:h-[860px]">
      <div className="grid h-full min-w-0 border border-[#e3e3de] bg-[#fbfbfa] lg:grid-cols-[228px_minmax(0,1fr)_388px]">
        <aside className="hidden min-w-0 border-r border-[#e3e3de] bg-[#f7f7f5] lg:flex lg:flex-col">
          <div className="flex-1 px-5 py-5 text-[13px] leading-5">
            <div className="flex items-center gap-2 font-medium">
              <GitBranchIcon className="size-4" strokeWidth={1.75} />
              {t("pages.marketing.home.showcaseArtifacts")}
            </div>
            <p className="mt-8 text-[13px] font-medium text-[#85857f]">
              {t("pages.marketing.home.showcaseRecents")}
            </p>
            <div className="mt-4 space-y-3 text-[13px] text-[#6a6a64]">
              {[
                "pages.marketing.home.showcaseRecentPayment",
                "pages.marketing.home.showcaseRecentRetention",
                "pages.marketing.home.showcaseRecentRemediation",
              ].map((item, index) => (
                <div
                  key={item}
                  className={cn(
                    "flex items-center gap-2 rounded-lg py-2",
                    index === 0 ? "bg-[#eeeeeb] px-3" : "px-1",
                  )}
                >
                  <span className="size-1.5 shrink-0 rounded-full border border-[#c9c9c3]" />
                  <span className="truncate">{t(item)}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
        <div className="min-w-0 border-r border-[#e3e3de] bg-[#fbfbfa]">
          <div className="flex h-[52px] items-center justify-between border-b border-[#e3e3de] px-7">
            <p className="text-[15px] font-semibold">
              {t("pages.marketing.home.showcaseReviewTitle")}
            </p>
            <span className="size-7 rounded-md bg-[#0e7c66]" />
          </div>
          <div className="relative mx-auto h-[806px] max-w-[680px] px-8 pt-9 text-[13px] leading-5 text-[#2d2d2a]">
            <p className="text-[12px] font-semibold">
              {t("pages.marketing.home.showcaseThoughtShort")}
            </p>
            <p className="mt-3 text-[15px] leading-6">
              {t("pages.marketing.home.showcaseConnected")}
            </p>
            <div className="mt-8 flex items-center gap-3 text-[13px] text-[#5f5f5a]">
              <span className="size-2 rounded-full bg-[#0e7c66]" />
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
              {t("pages.marketing.home.showcaseScannerComplete")}
            </p>
            <div className="mt-7 space-y-3">
              {scannerSteps.map(([icon, label]) => (
                <div key={label} className="grid grid-cols-[20px_1fr_52px] items-center gap-3">
                  {icon === "github" ? (
                    <GitBranchIcon className="size-4" strokeWidth={1.75} />
                  ) : icon === "search" ? (
                    <SearchIcon className="size-4" strokeWidth={1.75} />
                  ) : icon === "branch" ? (
                    <GitBranchIcon className="size-4" strokeWidth={1.75} />
                  ) : (
                    <FileTextIcon className="size-4" strokeWidth={1.75} />
                  )}
                  <span className="text-[#85857f]">{t(label)}</span>
                  <span className="text-[11px] font-medium text-[#10a37f]">
                    {t("pages.marketing.home.showcaseStatusDone")}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-[#e3e3de] bg-[#f7f7f5] px-5 py-4">
              <div className="flex items-start justify-between border-b border-[#e3e3de] pb-3">
                <div className="flex gap-4">
                  <GitBranchIcon className="mt-1 size-4" strokeWidth={1.75} />
                  <div>
                    <p className="font-semibold">
                      {t("pages.marketing.home.showcaseEvidenceTitle")}
                    </p>
                    <p className="mt-1 text-[12px] text-[#5f5f5a]">
                      {t("pages.marketing.home.showcaseEvidenceSubtitle")}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-[#edf6f3] px-4 py-2 text-[11px] font-medium text-[#10a37f]">
                  {t("pages.marketing.home.showcaseStatusReady")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-10 gap-y-4 pt-4">
                {[
                  ["27", "pages.marketing.home.showcaseMetricServices", "pages.marketing.home.showcaseMetricServicesDetail"],
                  ["148", "pages.marketing.home.showcaseMetricSymbols", "pages.marketing.home.showcaseMetricSymbolsDetail"],
                  ["9", "pages.marketing.home.showcaseMetricCalls", "pages.marketing.home.showcaseMetricCallsDetail"],
                  ["84%", "pages.marketing.home.showcaseMetricScope", "pages.marketing.home.showcaseMetricScopeDetail"],
                ].map(([value, label, detail]) => (
                  <div key={label} className="grid grid-cols-[64px_1fr] gap-3">
                    <span className="text-xl font-semibold">{value}</span>
                    <span className="text-[12px] leading-4">
                      <strong className="block font-medium">{t(label)}</strong>
                      <span className="text-[#5f5f5a]">{t(detail)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-[12px] font-medium text-[#0e7c66]">
                {t("pages.marketing.home.showcaseViewGraph")} -&gt;
              </p>
            </div>
            <p className="mt-3 text-[15px] leading-6">
              {t("pages.marketing.home.showcaseInterviewReady")}
            </p>
          </div>
        </div>
        <aside className="hidden min-w-0 bg-[#fbfbfa] lg:block">
          <div className="flex h-[52px] items-center border-b border-[#e3e3de] px-5">
            <p className="text-[15px] font-semibold">
              {t("pages.marketing.home.showcasePanelTitle")}
            </p>
          </div>
          <div className="px-5 py-5">
            <p className="text-[12px] font-semibold text-[#6a6a64]">
              {t("pages.marketing.home.showcaseRepositoryContext")}
            </p>
            <div className="mt-3 rounded-lg border border-[#e3e3de] bg-white p-4 text-[13px]">
              <p className="font-semibold">payment-service</p>
              <p className="mt-1 text-[11px] text-[#85857f]">
                feat/payment-risk-controls
              </p>
              <p className="mt-1 text-[11px] text-[#85857f]">
                Pinned commit - 9f31ca2
              </p>
            </div>
            <p className="mt-5 text-[12px] font-semibold text-[#6a6a64]">
              {t("pages.marketing.home.showcaseWorkflow")}
            </p>
            <div className="mt-2 rounded-lg border border-[#e3e3de] bg-white p-4">
              <div className="space-y-4">
                {workflowSteps.map(([label, status, active]) => (
                  <div key={label} className="grid grid-cols-[12px_1fr_70px] items-center gap-2 text-[12px]">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        active ? "bg-[#0e7c66]" : "bg-[#c9c9c3]",
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
                          ? "text-[#85857f]"
                          : "text-[#10a37f]",
                      )}
                    >
                      {t(status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between text-[12px]">
              <p className="font-semibold text-[#6a6a64]">
                {t("pages.marketing.home.showcaseArtifactsEvidence")}
              </p>
              <p className="text-[11px] text-[#85857f]">
                {t("pages.marketing.home.showcaseArtifactsMeta")}
              </p>
            </div>
            <div className="mt-3 space-y-3">
              {artifacts.map(([title, description, status]) => (
                <div
                  key={title}
                  className="grid grid-cols-[28px_1fr_64px_12px] items-center gap-3 rounded-lg border border-[#e3e3de] bg-white p-3"
                >
                  <span className="flex size-7 items-center justify-center rounded-md border border-[#e3e3de] bg-[#f2f2ef]">
                    <SquareIcon className="size-3" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-[12px] font-medium">
                      {t(title)}
                    </strong>
                    <span className="block truncate text-[11px] text-[#85857f]">
                      {t(description)}
                    </span>
                  </span>
                  <span className="text-[11px] text-[#10a37f]">{t(status)}</span>
                  <ChevronRightIcon className="size-4 text-[#85857f]" strokeWidth={1.75} />
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
        <p className="mb-[22px] text-xs font-semibold uppercase leading-normal text-[#10a37f]">
          {eyebrow}
        </p>
      ) : null}
      <h1
        className={cn(
          "mx-auto font-semibold text-[#2d2d2a]",
          compact
            ? "max-w-[920px] text-[44px] leading-[52px] md:text-[52px] md:leading-[58px]"
            : "max-w-[900px] text-[44px] leading-[50px] md:text-[56px] md:leading-[62px]",
        )}
      >
        {title}
      </h1>
      <p className="mx-auto mt-[22px] max-w-[800px] text-lg leading-7 text-[#5f5f5a]">
        {description}
      </p>
      {detail ? (
        <p className="mx-auto mt-4 max-w-[720px] text-xs font-medium leading-normal">
          {detail}
        </p>
      ) : null}
      {badge ? (
        <p className="mx-auto mt-[14px] w-max rounded-full border border-[#e3e3de] bg-[#f2f2ef] px-[14px] py-2 text-[12.5px] font-medium text-[#5f5f5a]">
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
      className="mx-auto flex min-h-[520px] w-full max-w-[1440px] flex-col items-center gap-10 px-8 py-14 md:px-[120px] lg:flex-row lg:gap-[72px]"
    >
      <div
        className={cn(
          "flex w-full max-w-[480px] flex-col items-start gap-[18px]",
          reverse && "lg:order-2",
        )}
      >
        <p className="w-[200px] rounded-full bg-[#f2f2ef] px-3 py-[7px] text-xs font-medium leading-normal text-[#10a37f]">
          {eyebrow}
        </p>
        <h2 className="text-4xl font-semibold leading-[44px]">{title}</h2>
        <p className="text-[17px] leading-[27px] text-[#5f5f5a]">
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
    <div className="min-h-[400px] rounded-3xl border border-[#e3e3de] bg-[#f2f2ef] p-6">
      {children}
    </div>
  );
}

function RepositoryEvidencePreview() {
  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-[#10a37f]">
        {t("pages.marketing.features.pinnedSource")}
      </p>
      <p className="mt-4 text-[13px] font-medium">
        {t("pages.marketing.features.pinnedRepo")}
      </p>
      <div className="mt-4 rounded-2xl border border-[#e3e3de] bg-[#f7f7f5] p-4 font-mono text-[13px] leading-normal">
        <p className="text-[#5f5f5a]">184&nbsp;&nbsp;if (riskScore &gt; threshold) {"{"}</p>
        <p>185&nbsp;&nbsp;&nbsp;&nbsp;decision = provider.score(tx)</p>
        <p className="text-[#5f5f5a]">186&nbsp;&nbsp;{"}"}</p>
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
              "rounded-[10px] bg-[#f7f7f5] px-3 py-[7px] text-xs font-medium",
              index === 0 ? "text-[#10a37f]" : "text-[#2d2d2a]",
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
  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-[#10a37f]">
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
                ? "border-[#10a37f] bg-[#f2f2ef]"
                : "border-[#e3e3de] bg-[#f7f7f5]",
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
  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-[#10a37f]">
        {t("pages.marketing.features.findingLabel")}
      </p>
      <h3 className="mt-4 text-xl font-semibold leading-7">
        {t("pages.marketing.features.findingPreviewTitle")}
      </h3>
      <p className="mt-2 text-[13px] text-[#5f5f5a]">
        {t("pages.marketing.features.findingMeta")}
      </p>
      <div className="mt-4 rounded-2xl border border-[#e3e3de] bg-[#f7f7f5] p-4">
        <p className="text-xs font-semibold">
          {t("pages.marketing.features.evidenceLabel")}
        </p>
        <p className="mt-2 text-[13px] leading-5 text-[#5f5f5a]">
          {t("pages.marketing.features.findingEvidence")}
        </p>
      </div>
      <div className="mt-4 flex gap-2.5">
        <span className="inline-flex h-10 w-[148px] items-center rounded-[10px] border border-[#e3e3de] bg-[#f7f7f5] px-3.5 text-xs font-medium">
          {t("pages.marketing.features.openSource")}
        </span>
        <span className="inline-flex h-10 w-[148px] items-center rounded-[10px] border border-[#2d2d2a] bg-[#2d2d2a] px-3.5 text-xs font-medium text-[#f7f7f5]">
          {t("pages.marketing.features.reviewFinding")}
        </span>
      </div>
    </PreviewPanel>
  );
}

function RemediationPreview() {
  return (
    <PreviewPanel>
      <p className="text-xs font-semibold text-[#10a37f]">
        {t("pages.marketing.features.proposedChange")}
      </p>
      <p className="mt-3 text-[13px] font-medium">risk-policy.ts</p>
      <div className="mt-4 rounded-2xl border border-[#e3e3de] bg-[#f7f7f5] p-3.5 font-mono text-[13px] leading-normal">
        <p className="text-[#5f5f5a]">- return blockPayment</p>
        <p className="text-[#10a37f]">
          + const review = await requireHumanReview(tx)
        </p>
        <p className="text-[#10a37f]">
          + return review.approved ? blockPayment : continueFlow
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["pages.marketing.features.verificationSource", "pages.marketing.features.verificationPinned"],
          ["pages.marketing.features.verificationFinding", "pages.marketing.features.verificationResolved"],
          ["pages.marketing.features.verificationGate", "pages.marketing.features.verificationPassed"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] font-medium text-[#5f5f5a]">{t(label)}</p>
            <p className="mt-1 text-[13px] font-semibold text-[#10a37f]">
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
  return (
    <article className="relative min-h-[560px] rounded-[18px] border border-[#e3e3de] bg-[#f7f7f5] p-[27px]">
      <p className="text-base font-semibold leading-[22px] text-[#5f5f5a]">
        {t("pages.marketing.pricing.creditTopUp")}
      </p>
      <span className="absolute right-[39px] top-[37px] rounded-full bg-[#f2f2ef] px-2.5 py-1.5 text-xs font-medium leading-4 text-[#10a37f]">
        {saving}
      </span>
      <p className="mt-3 text-[44px] font-semibold leading-[52px]">{amount}</p>
      <p className="text-xs leading-5 text-[#666661]">
        {t("pages.marketing.pricing.usdCredits")}
      </p>
      <p className="mt-3 max-w-[312px] text-[15px] leading-[22px] text-[#5f5f5a]">
        {description}
      </p>
      <div className="mt-10 border-t border-[#e3e3de]">
        {[balance, savingRow, t("pages.marketing.pricing.cardPayment")].map(
          (item) => (
            <p
              key={item}
              className="border-b border-[#e3e3de] py-5 text-sm leading-5"
            >
              {item}
            </p>
          ),
        )}
      </div>
      <Link
        href="/sign-up"
        className="absolute bottom-[29px] left-[27px] flex h-12 w-[calc(100%-54px)] items-center justify-center rounded-xl bg-[#2d2d2a] text-[15px] font-medium leading-5 text-[#f7f7f5]"
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
      <p className="mt-8 max-w-[650px] text-[17px] leading-6 text-[#5f5f5a]">
        {description}
      </p>
      <div className="mt-9 flex gap-3">
        <SmallPrimaryLink href={primaryHref}>{primaryLabel}</SmallPrimaryLink>
        <SmallSecondaryLink href={secondaryHref}>{secondaryLabel}</SmallSecondaryLink>
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
      className="inline-flex h-9 w-[126px] items-center justify-center rounded-lg border border-[#2d2d2a] bg-[#2d2d2a] text-[13px] font-medium text-white"
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
      className="inline-flex h-9 w-[136px] items-center justify-center rounded-lg border border-[#e3e3de] bg-[#e8e8e3] text-[13px] font-medium"
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
      className="inline-flex h-11 w-[166px] items-center justify-center rounded-xl border border-[#2d2d2a] bg-[#2d2d2a] text-[13px] font-medium text-[#f7f7f5]"
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
      className="inline-flex h-11 w-[166px] items-center justify-center rounded-xl border border-[#e3e3de] bg-[#f7f7f5] text-[13px] font-medium"
    >
      {children}
    </Link>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
