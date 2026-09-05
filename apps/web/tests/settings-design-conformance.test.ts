import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("LCSP-269 modal shell preserves Figma desktop geometry", async () => {
  const [modal, sidebar, tab] = await Promise.all([
    read("../src/features/settings/components/organisms/settings-modal.tsx"),
    read("../src/features/settings/components/organisms/settings-sidebar.tsx"),
    read("../src/features/settings/components/molecules/settings-tab.tsx"),
  ]);

  assert.match(modal, /max-w-295/);
  assert.match(modal, /max-h-205/);
  assert.match(modal, /rounded-\[14px\]/);
  assert.match(modal, /data-slot=dialog-close/);
  assert.match(sidebar, /md:w-60/);
  assert.match(sidebar, /h-9\.5 w-52/);
  assert.match(sidebar, /mt-3\.5/);
  assert.match(sidebar, /ShieldCheckIcon/);
  assert.match(sidebar, /ChartNoAxesCombinedIcon/);
  assert.match(sidebar, /ToolCaseIcon/);
  assert.doesNotMatch(sidebar, /ShieldIcon/);
  assert.doesNotMatch(sidebar, /ChartNoAxesColumnIcon/);
  assert.doesNotMatch(sidebar, /BriefcaseBusinessIcon/);
  assert.match(tab, /h-9 w-52/);
  assert.match(tab, /text-\[13px\]/);
});

test("General settings panel uses compact Figma rows, not legacy cards", async () => {
  const [settings, theme] = await Promise.all([
    read("../src/features/settings/components/organisms/settings-page.tsx"),
    read("../src/components/molecules/theme-preference-control.tsx"),
  ]);

  assert.match(settings, /dataComponent="GeneralSettingsPanel"/);
  assert.match(settings, /id="settings-full-name"[\s\S]*?className="h-9 w-51/);
  assert.match(settings, /ThemePreferenceControl variant="compact"/);
  assert.match(theme, /data-component="CompactThemePreferenceControl"/);
  assert.match(theme, /h-9\.5 w-30/);
  assert.doesNotMatch(settings, /<Card[\s\S]*GeneralSettingsPanel/);
});

test("General settings panel wires language to the shared EN VI locale preference", async () => {
  const [settings, locale] = await Promise.all([
    read("../src/features/settings/components/organisms/settings-page.tsx"),
    read("../src/lib/locale.ts"),
  ]);

  assert.match(settings, /data-locale={settingsLocale}/);
  assert.match(settings, /SettingsLanguageSelect/);
  assert.match(settings, /DropdownMenuRadioGroup value={locale}/);
  assert.match(settings, /onValueChange={handleLocaleChange}/);
  assert.match(settings, /LOCALES\.map/);
  assert.match(settings, /languageEnglish/);
  assert.match(settings, /languageVietnamese/);
  assert.doesNotMatch(settings, /ReadonlySelectValue\s*[\r\n]+\s*id="settings-language"/);
  assert.doesNotMatch(settings, /<Select value={locale}/);
  assert.doesNotMatch(settings, /<SelectValue/);
  assert.doesNotMatch(settings, />\{locale\}</);
  assert.match(locale, /APP_LOCALE_COOKIE = "lcsp_locale"/);
  assert.match(locale, /export let appLocale: Locale = "vi"/);
  assert.doesNotMatch(
    locale,
    /export let appLocale: Locale = readCookieLocale\(\) \?\? "vi"/,
  );
  assert.doesNotMatch(
    locale,
    /getAppLocaleSnapshot\(\): Locale \{[\s\S]*appLocale = readCookieLocale/,
  );
  assert.match(locale, /hydrateAppLocaleFromCookie/);
  assert.match(locale, /setAppLocale/);
});

test("Settings language select matches Figma trigger and option selected state", async () => {
  const settings = await read(
    "../src/features/settings/components/organisms/settings-page.tsx",
  );

  assert.match(settings, /data-component="SettingsLanguageSelectTrigger"/);
  assert.match(settings, /selectedLanguageLabel/);
  assert.match(settings, /h-9 w-36/);
  assert.match(settings, /rounded-lg/);
  assert.match(settings, /px-3/);
  assert.match(settings, /text-\[13px\]/);
  assert.match(settings, /size-3\.5/);
  assert.match(settings, /data-component="SettingsLanguageSelectContent"/);
  assert.match(settings, /w-65/);
  assert.match(settings, /rounded-xl/);
  assert.match(settings, /p-\[7px\]/);
  assert.match(settings, /shadow-\[0_8px_18px_rgba\(0,0,0,0\.35\)\]/);
  assert.match(settings, /data-component="SettingsLanguageSelectOption"/);
  assert.match(settings, /h-9\.5 w-61/);
  assert.match(settings, /data-selected={selected \? "true" : undefined}/);
  assert.match(settings, /selected && "bg-accent font-medium text-accent-foreground"/);
  assert.doesNotMatch(
    settings,
    /Japanese|Korean|Chinese \(Simplified\)|French|German/,
  );
});

test("Account tab hides legacy account presentation and renders compact sessions", async () => {
  const settings = await read(
    "../src/features/settings/components/organisms/settings-page.tsx",
  );

  assert.match(settings, /dataComponent="AccountSettingsPanel"/);
  assert.match(settings, /logOutAllDevicesTitle/);
  assert.match(settings, /trustedDevicesDescription/);
  assert.match(settings, /data-component="CompactSessionRow"/);
  assert.match(settings, /group-hover:opacity-100/);
  assert.match(settings, /DropdownMenuTrigger/);
  assert.doesNotMatch(settings, /<AccountSettingsSection/);
  assert.doesNotMatch(settings, /<EmailSettingsSection/);
  assert.doesNotMatch(settings, /<PasswordAuthenticationSettingsSection/);
  assert.doesNotMatch(settings, /<SessionsSettingsSection/);
});

test("Connectors tab matches provider-list structure without inline repository form", async () => {
  const connectors = await read(
    "../src/features/settings/components/organisms/repositories-settings-section.tsx",
  );

  assert.match(connectors, /data-component="ConnectorProviderList"/);
  assert.match(connectors, /data-component="ConnectorProviderRow"/);
  assert.match(connectors, /githubPatAccessTitle/);
  assert.match(connectors, /ProviderCredentialDialog/);
  assert.doesNotMatch(connectors, /connectTitle/);
  assert.doesNotMatch(connectors, /repositoryUrl/);
  assert.doesNotMatch(connectors, /id="provider-credential"|type="password"/);
  assert.doesNotMatch(connectors, /unsupportedProviderDescription/);
});

test("Git credential dialog matches Figma mode shell instead of generic compact dialog", async () => {
  const dialog = await read(
    "../src/features/settings/components/molecules/provider-credential-dialog.tsx",
  );

  assert.match(dialog, /PROVIDER_CREDENTIAL_DIALOG_MODES/);
  assert.match(dialog, /data-component="ProviderCredentialDialog"/);
  assert.match(dialog, /data-mode={mode}/);
  assert.match(dialog, /h-\[430px\]/);
  assert.match(dialog, /max-w-140/);
  assert.match(dialog, /rounded-2xl p-6/);
  assert.match(dialog, /flex-row justify-end gap-2\.5/);
  assert.doesNotMatch(dialog, /max-w-md/);
  assert.doesNotMatch(dialog, /patDialogTitle|Provider credential/);
});
