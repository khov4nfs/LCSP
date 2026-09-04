import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const rootLayoutPath = new URL("../src/app/layout.tsx", import.meta.url);
const themeProviderPath = new URL(
  "../src/components/providers/theme-provider.tsx",
  import.meta.url,
);
const themeControlPath = new URL(
  "../src/components/molecules/theme-preference-control.tsx",
  import.meta.url,
);
const themeTypesPath = new URL(
  "../src/components/types/theme-preference.types.ts",
  import.meta.url,
);
const globalsPath = new URL("../src/app/globals.css", import.meta.url);
const settingsAppearancePath = new URL(
  "../src/features/settings/components/organisms/appearance-settings-section.tsx",
  import.meta.url,
);
const toasterPath = new URL("../src/components/ui/sonner.tsx", import.meta.url);
const shellPath = new URL(
  "../src/features/workspace/components/organisms/assessment-app-shell.tsx",
  import.meta.url,
);
const sidebarSlotPath = new URL(
  "../src/features/workspace/components/organisms/assessment-shell-slots.tsx",
  import.meta.url,
);
const sidebarPath = new URL(
  "../src/features/workspace/components/organisms/app-sidebar.tsx",
  import.meta.url,
);
const recentFilterPopoverPath = new URL(
  "../src/features/workspace/components/molecules/recent-filter-popover.tsx",
  import.meta.url,
);
const authShellPath = new URL(
  "../src/features/auth/components/organisms/auth-shell.tsx",
  import.meta.url,
);
const marketingShellPath = new URL(
  "../src/features/marketing/components/marketing-shell.tsx",
  import.meta.url,
);

test("root layout mounts one next-themes provider for the full app tree", async () => {
  const [layoutSource, providerSource] = await Promise.all([
    readFile(rootLayoutPath, "utf8"),
    readFile(themeProviderPath, "utf8"),
  ]);

  assert.match(providerSource, /from "next-themes"/);
  assert.match(providerSource, /NextThemesProvider/);
  assert.match(layoutSource, /suppressHydrationWarning/);
  assert.match(layoutSource, /<ThemeProvider/);
  assert.match(layoutSource, /attribute="class"/);
  assert.match(layoutSource, /defaultTheme="system"/);
  assert.match(layoutSource, /enableSystem/);
  assert.match(layoutSource, /disableTransitionOnChange/);
  assert.ok(
    layoutSource.indexOf("<ThemeProvider") <
      layoutSource.indexOf("<QueryProvider"),
  );
  assert.equal(layoutSource.split("<ThemeProvider").length - 1, 1);
});

test("theme preferences support light dark and system without a parallel store", async () => {
  const [typesSource, controlSource] = await Promise.all([
    readFile(themeTypesPath, "utf8"),
    readFile(themeControlPath, "utf8"),
  ]);

  assert.match(typesSource, /THEME_PREFERENCES/);
  assert.match(typesSource, /light: "light"/);
  assert.match(typesSource, /dark: "dark"/);
  assert.match(typesSource, /system: "system"/);
  assert.match(typesSource, /export type ThemePreference/);
  assert.match(controlSource, /useTheme\(\)/);
  assert.match(controlSource, /setTheme\(option\.value\)/);
  assert.match(controlSource, /resolvedTheme/);
  assert.match(controlSource, /aria-pressed=\{selected\}/);
  assert.doesNotMatch(controlSource, /localStorage|sessionStorage/);
});

test("settings owns the reusable theme preference control", async () => {
  const settingsSource = await readFile(settingsAppearancePath, "utf8");

  assert.match(settingsSource, /ThemePreferenceControl/);
  assert.match(settingsSource, /pages\.workspace\.settingsHub\.appearance/);
});

test("semantic tokens define light and dark palettes plus brand role", async () => {
  const globalsSource = await readFile(globalsPath, "utf8");

  assert.match(globalsSource, /:root \{/);
  assert.match(globalsSource, /\.dark \{/);
  assert.match(globalsSource, /--brand:/);
  assert.match(globalsSource, /--color-brand: var\(--brand\)/);
  assert.match(globalsSource, /--sidebar:/);
  assert.match(globalsSource, /--popover:/);
  assert.match(globalsSource, /background-image:/);
  assert.doesNotMatch(globalsSource, /var\(--primary\) 10%/);
});

test("portaled toaster and recent filters inherit the root theme tokens", async () => {
  const [toasterSource, filterSource] = await Promise.all([
    readFile(toasterPath, "utf8"),
    readFile(recentFilterPopoverPath, "utf8"),
  ]);

  assert.match(toasterSource, /useTheme/);
  assert.match(toasterSource, /resolvedTheme/);
  assert.match(toasterSource, /toasterTheme as ToasterProps\["theme"\]/);
  assert.match(toasterSource, /var\(--popover\)/);
  assert.match(filterSource, /bg-popover/);
  assert.match(filterSource, /text-popover-foreground/);
  assert.match(filterSource, /border-border/);
});

test("theme changes do not introduce shell state ownership or collapsed sidebar regressions", async () => {
  const [shellSource, slotSource, sidebarSource] = await Promise.all([
    readFile(shellPath, "utf8"),
    readFile(sidebarSlotPath, "utf8"),
    readFile(sidebarPath, "utf8"),
  ]);

  assert.doesNotMatch(shellSource, /useTheme|setTheme|theme=/);
  assert.match(shellSource, /const \[shellState, setShellState\]/);
  assert.match(slotSource, /if \(collapsed\) return null/);
  assert.doesNotMatch(slotSource, /w-14/);
  assert.match(sidebarSource, /bg-sidebar/);
  assert.match(sidebarSource, /text-sidebar-foreground/);
});

test("major public and auth shells no longer pin one visual theme", async () => {
  const [marketingSource, authSource] = await Promise.all([
    readFile(marketingShellPath, "utf8"),
    readFile(authShellPath, "utf8"),
  ]);
  const combined = `${marketingSource}\n${authSource}`;

  assert.match(marketingSource, /bg-background text-foreground/);
  assert.match(authSource, /bg-background text-foreground/);
  assert.doesNotMatch(
    combined,
    /bg-\[#f7f7f5\]|text-\[#2d2d2a\]|bg-white|text-white/,
  );
});

test("theme retrofit does not duplicate light or dark component trees", async () => {
  const [layoutSource, shellSource, sidebarSource, marketingSource] =
    await Promise.all([
      readFile(rootLayoutPath, "utf8"),
      readFile(shellPath, "utf8"),
      readFile(sidebarPath, "utf8"),
      readFile(marketingShellPath, "utf8"),
    ]);
  const combined = [
    layoutSource,
    shellSource,
    sidebarSource,
    marketingSource,
  ].join("\n");

  assert.doesNotMatch(
    combined,
    /\b(Light|Dark)(AppShell|Sidebar|Marketing|Auth|Settings|Admin)/,
  );
});
