import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolveMessage } from "@lcsp/i18n";
import { feedbackFormSchema } from "../src/features/marketing/schemas/feedback.schema.ts";

const marketingPages = new URL(
  "../src/features/marketing/components/marketing-pages.tsx",
  import.meta.url,
);

test("Landing Home renders all core sections requested in LCSP-374", async () => {
  const source = await readFile(marketingPages, "utf8");

  // Core Figma node contract preserved
  assert.match(source, /data-figma-node="923:31255"/);
  assert.match(source, /data-figma-name="M01 Overview"/);

  // Mandatory sections from LCSP-374
  assert.match(source, /<ProviderLogoStrip \/>/);
  assert.match(source, /<BentoCapabilities \/>/);
  assert.match(source, /<WorkflowSteps \/>/);
  assert.match(source, /<AudienceGrid \/>/);
  assert.match(source, /<FAQAccordion \/>/);
  assert.match(source, /<FeedbackForm \/>/);
  assert.match(source, /data-section="hero"/);
  assert.match(source, /data-section="product-modes"/);
  assert.match(source, /data-section="assessment-lifecycle"/);
  assert.match(source, /data-section="evidence-principles"/);
  assert.match(source, /FinalCta/);
});

test("Feedback form schema validates input correctly", () => {
  // Invalid empty inputs
  const emptyResult = feedbackFormSchema.safeParse({
    name: "",
    email: "not-an-email",
    category: "invalid",
    rating: 0,
    message: "short",
  });
  assert.equal(emptyResult.success, false);

  // Valid input
  const validResult = feedbackFormSchema.safeParse({
    name: "Alex Rivera",
    email: "alex@example.com",
    category: "product",
    rating: 5,
    message: "This is a detailed feedback message with sufficient length.",
  });
  assert.equal(validResult.success, true);
});

test("Landing Home new copy keys are resolved for both EN and VI locales", () => {
  const keys = [
    "pages.marketing.home.providerStripTitle",
    "pages.marketing.home.bentoTitle",
    "pages.marketing.home.bentoCard1Title",
    "pages.marketing.home.workflowTitle",
    "pages.marketing.home.audienceTitle",
    "pages.marketing.home.faqTitle",
    "pages.marketing.home.feedbackTitle",
    "pages.marketing.home.feedbackSubmitButton",
    "pages.marketing.home.feedbackSuccessTitle",
  ] as const;

  for (const key of keys) {
    const enVal = resolveMessage("en", key);
    const viVal = resolveMessage("vi", key);
    assert.notEqual(enVal, key, `Missing EN key: ${key}`);
    assert.notEqual(viVal, key, `Missing VI key: ${key}`);
    assert.notEqual(enVal, viVal, `EN and VI should differ: ${key}`);
  }
});
