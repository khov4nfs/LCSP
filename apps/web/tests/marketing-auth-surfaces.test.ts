import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const rootPage = new URL("../src/app/page.tsx", import.meta.url);
const featuresPage = new URL("../src/app/features/page.tsx", import.meta.url);
const pricingPage = new URL("../src/app/pricing/page.tsx", import.meta.url);
const marketingShell = new URL(
  "../src/features/marketing/components/marketing-shell.tsx",
  import.meta.url,
);
const marketingPages = new URL(
  "../src/features/marketing/components/marketing-pages.tsx",
  import.meta.url,
);
const authShell = new URL(
  "../src/features/auth/components/organisms/auth-shell.tsx",
  import.meta.url,
);
const authPrimitives = new URL(
  "../src/features/auth/components/molecules/auth-form-primitives.tsx",
  import.meta.url,
);
const signInForm = new URL(
  "../src/features/auth/components/organisms/sign-in-form.tsx",
  import.meta.url,
);
const mfaVerifyForm = new URL(
  "../src/features/auth/components/organisms/mfa-verify-form.tsx",
  import.meta.url,
);

test("marketing routes render real Product, Features, and Pricing pages", async () => {
  assert.match(await readFile(rootPage, "utf8"), /ProductMarketingPage/);
  assert.match(await readFile(featuresPage, "utf8"), /FeaturesMarketingPage/);
  assert.match(await readFile(pricingPage, "utf8"), /PricingMarketingPage/);
});

test("shared marketing header is 72px on desktop and routes across marketing plus auth", async () => {
  const source = await readFile(marketingShell, "utf8");
  assert.match(source, /h-18/);
  for (const href of [
    'href: "/"',
    'href: "/features"',
    'href: "/pricing"',
    'href="/sign-in"',
    'href="/sign-up"',
  ]) {
    assert.match(source, new RegExp(href.replace(/["/]/g, "\\$&")));
  }
  assert.match(source, /aria-current=/);
  assert.doesNotMatch(source, /\/business/);
});

test("Product implements the complete M01 Overview long-page structure", async () => {
  const source = await readFile(marketingPages, "utf8");
  assert.match(source, /data-figma-node="923:31255"/);
  assert.match(source, /data-figma-name="M01 Overview"/);
  for (const section of [
    "hero",
    "product-modes",
    "assessment-lifecycle",
    "evidence-principles",
    "final-cta",
  ]) {
    assert.match(source, new RegExp(`data-section="${section}"`));
  }
  assert.match(source, /AssessmentPromptPreview/);
  assert.match(source, /AppShellPreview/);
  assert.match(source, /productQuickActions/);
  assert.match(source, /productProof/);
  assert.match(source, /modeScan/);
  assert.match(source, /modeUnderstand/);
  assert.match(source, /modeRemediate/);
  assert.doesNotMatch(source, /h-\[900px\]|max-h-\[900px\]|overflow-y-hidden/);
});

test("Features implements every required M02 section below the fold", async () => {
  const source = await readFile(marketingPages, "utf8");
  assert.match(source, /data-figma-node="1042:31775"/);
  assert.match(source, /data-figma-name="M02 Features"/);
  for (const section of [
    "features-hero",
    "repository-evidence",
    "targeted-human-context",
    "reviewable-findings",
    "remediation-verification",
    "workspace-capabilities",
    "final-cta",
  ]) {
    assert.match(source, new RegExp(`(?:section=|data-section=)"${section}"`));
  }
  assert.match(source, /RepositoryEvidencePreview/);
  assert.match(source, /HumanContextPreview/);
  assert.match(source, /FindingPreview/);
  assert.match(source, /RemediationPreview/);
  for (const evidenceKey of [
    "pages.marketing.home.source",
    "pages.marketing.home.model",
    "pages.marketing.home.control",
    "pages.marketing.home.finding",
  ]) {
    assert.match(source, new RegExp(evidenceKey));
  }
  assert.match(source, /workspaceCapabilities/);
});

test("Pricing implements the full M03 prepaid-credit model", async () => {
  const source = await readFile(marketingPages, "utf8");
  assert.match(source, /data-figma-node="998:31472"/);
  assert.match(source, /data-figma-name="M03 Pricing"/);
  for (const section of [
    "pricing-hero",
    "credit-topups",
    "custom-amount",
    "how-credits-work",
    "faq",
    "final-cta",
  ]) {
    assert.match(source, new RegExp(`(?:section=|data-section=)"${section}"`));
  }
  assert.match(source, /\$50/);
  assert.match(source, /\$250/);
  assert.match(source, /\$1,000/);
  assert.match(source, /customPlaceholder/);
  assert.match(source, /stepTopUpTitle/);
  assert.match(source, /stepUseTitle/);
  assert.match(source, /stepReloadTitle/);
  assert.doesNotMatch(
    source,
    /Enterprise|Starter|Pro plan|\/month|\/year|subscription/i,
  );
});

test("auth uses the Figma centered surface instead of the old split visual", async () => {
  const shellSource = await readFile(authShell, "utf8");
  const primitiveSource = await readFile(authPrimitives, "utf8");

  assert.match(shellSource, /bg-\[#f7f7f5\]/);
  assert.match(shellSource, /backToWebsite/);
  assert.match(shellSource, /href="\/"/);
  assert.doesNotMatch(
    shellSource,
    /lg:grid-cols-2|auth-visual|backdrop-blur-sm/,
  );
  assert.match(primitiveSource, /max-w-\[360px\]/);
  assert.match(primitiveSource, /h-10 rounded-lg/);
  assert.match(primitiveSource, /h-9 w-full/);
  assert.doesNotMatch(shellSource, /FormCard/);
});

test("login keeps Google first and auth navigation routes alive", async () => {
  const source = await readFile(signInForm, "utf8");
  assert.match(source, /data-figma-node="924:31258"/);
  assert.ok(source.indexOf("<OAuthButton") < source.indexOf("<AuthDivider"));
  assert.ok(source.indexOf("<AuthDivider") < source.indexOf("<form"));
  assert.match(source, /API_REDIRECT_LOCATIONS\.recoveryRequest/);
  assert.match(source, /API_REDIRECT_LOCATIONS\.signUp/);
  assert.match(source, /API_REDIRECT_LOCATIONS\.mfaVerify/);
});

test("MFA exposes authenticator and recovery-code Figma states", async () => {
  const source = await readFile(mfaVerifyForm, "utf8");
  assert.match(
    source,
    /data-figma-node=\{isRecoveryCode \? "926:31359" : "925:31355"\}/,
  );
  assert.match(source, /API_REDIRECT_LOCATIONS\.mfaRecoveryCode/);
  assert.match(source, /InputOTPSlot/);
  assert.match(source, /InputOTPSeparator/);
  assert.match(source, /pages\.mfaVerify\.recoveryCodeAccessHelp/);
});
