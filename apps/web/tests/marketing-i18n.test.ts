import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { resolveMessage } from "@lcsp/i18n";
import { LOCALES } from "@lcsp/contracts/shared/locale";

import {
  getMarketingLocale,
  isMarketingLocale,
  localizedMarketingPath,
  MARKETING_LOCALE_COOKIE,
  stripMarketingLocale,
} from "../src/features/marketing/config/marketing-routing.ts";

const routeCases = [
  {
    path: "/en",
    source: new URL("../src/app/[locale]/page.tsx", import.meta.url),
    component: "ProductMarketingPage",
    titleKey: "pages.marketing.home.title",
  },
  {
    path: "/vi",
    source: new URL("../src/app/[locale]/page.tsx", import.meta.url),
    component: "ProductMarketingPage",
    titleKey: "pages.marketing.home.title",
  },
  {
    path: "/en/features",
    source: new URL("../src/app/[locale]/features/page.tsx", import.meta.url),
    component: "FeaturesMarketingPage",
    titleKey: "pages.marketing.features.title",
  },
  {
    path: "/vi/features",
    source: new URL("../src/app/[locale]/features/page.tsx", import.meta.url),
    component: "FeaturesMarketingPage",
    titleKey: "pages.marketing.features.title",
  },
  {
    path: "/en/pricing",
    source: new URL("../src/app/[locale]/pricing/page.tsx", import.meta.url),
    component: "PricingMarketingPage",
    titleKey: "pages.marketing.pricing.title",
  },
  {
    path: "/vi/pricing",
    source: new URL("../src/app/[locale]/pricing/page.tsx", import.meta.url),
    component: "PricingMarketingPage",
    titleKey: "pages.marketing.pricing.title",
  },
] as const;

const languageSwitcherPath = new URL(
  "../src/features/marketing/components/language-switcher.tsx",
  import.meta.url,
);
const marketingShellPath = new URL(
  "../src/features/marketing/components/marketing-shell.tsx",
  import.meta.url,
);
const marketingLayoutPath = new URL(
  "../src/app/[locale]/layout.tsx",
  import.meta.url,
);
const proxyPath = new URL("../src/proxy.ts", import.meta.url);

test("LCSP-291 exposes all localized public marketing routes with locale copy", async () => {
  assert.deepEqual(LOCALES, ["en", "vi"]);

  for (const route of routeCases) {
    const source = await readFile(route.source, "utf8");
    const locale = route.path.startsWith("/vi") ? "vi" : "en";

    assert.match(source, /LOCALES\.includes/);
    assert.match(source, /notFound\(\)/);
    assert.match(source, new RegExp(`<${route.component}`));
    assert.match(source, /locale as Locale/);
    assert.ok(resolveMessage(locale, route.titleKey));
  }

  assert.notEqual(
    resolveMessage("en", "pages.marketing.home.title"),
    resolveMessage("vi", "pages.marketing.home.title"),
  );
  assert.notEqual(
    resolveMessage("en", "pages.marketing.features.title"),
    resolveMessage("vi", "pages.marketing.features.title"),
  );
  assert.notEqual(
    resolveMessage("en", "pages.marketing.pricing.title"),
    resolveMessage("vi", "pages.marketing.pricing.title"),
  );
});

test("language switching preserves the current marketing page and locale nav", async () => {
  assert.equal(localizedMarketingPath("en", "/"), "/en");
  assert.equal(localizedMarketingPath("vi", "/features"), "/vi/features");
  assert.equal(localizedMarketingPath("en", "/pricing"), "/en/pricing");
  assert.equal(stripMarketingLocale("/en/features"), "/features");
  assert.equal(stripMarketingLocale("/vi/pricing"), "/pricing");

  const switcherSource = await readFile(languageSwitcherPath, "utf8");
  const shellSource = await readFile(marketingShellPath, "utf8");

  assert.match(switcherSource, /usePathname/);
  assert.match(switcherSource, /localizedMarketingPath/);
  assert.match(switcherSource, /onClick=\{\(\) => select\(option\)\}/);
  assert.match(shellSource, /href=\{localizedHref\(item\.href\)\}/);
  assert.match(shellSource, /href=\{`\/\$\{locale\}`\}/);
});

test("explicit marketing locale choices persist through the shared cookie", async () => {
  assert.equal(MARKETING_LOCALE_COOKIE, "lcsp_locale");
  assert.equal(getMarketingLocale("en"), "en");
  assert.equal(getMarketingLocale("vi"), "vi");
  assert.equal(getMarketingLocale(undefined), "vi");
  assert.equal(getMarketingLocale("fr"), "vi");

  const switcherSource = await readFile(languageSwitcherPath, "utf8");
  const proxySource = await readFile(proxyPath, "utf8");

  assert.match(switcherSource, /MARKETING_LOCALE_COOKIE/);
  assert.match(switcherSource, /document\.cookie/);
  assert.match(proxySource, /request\.cookies\.get\(MARKETING_LOCALE_COOKIE\)/);
  assert.match(proxySource, /getMarketingLocale/);
});

test("unsupported marketing locales use deterministic fallback or not-found handling", async () => {
  assert.equal(isMarketingLocale("en"), true);
  assert.equal(isMarketingLocale("vi"), true);
  assert.equal(isMarketingLocale("fr"), false);
  assert.equal(isMarketingLocale(undefined), false);

  const [layoutSource, productSource, featuresSource, pricingSource] =
    await Promise.all([
      readFile(marketingLayoutPath, "utf8"),
      readFile(routeCases[0].source, "utf8"),
      readFile(routeCases[2].source, "utf8"),
      readFile(routeCases[4].source, "utf8"),
    ]);

  for (const source of [
    layoutSource,
    productSource,
    featuresSource,
    pricingSource,
  ]) {
    assert.match(source, /notFound\(\)/);
    assert.match(source, /LOCALES\.includes/);
  }
});
