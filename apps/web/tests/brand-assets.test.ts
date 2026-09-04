import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const logoComponentPath = new URL(
  "../src/components/atoms/lcsp-logo.tsx",
  import.meta.url,
);
const logoTypesPath = new URL(
  "../src/components/types/lcsp-logo.types.ts",
  import.meta.url,
);
const marketingShellPath = new URL(
  "../src/features/marketing/components/marketing-shell.tsx",
  import.meta.url,
);
const marketingPagesPath = new URL(
  "../src/features/marketing/components/marketing-pages.tsx",
  import.meta.url,
);
const authShellPath = new URL(
  "../src/features/auth/components/organisms/auth-shell.tsx",
  import.meta.url,
);
const workspaceSelectPath = new URL(
  "../src/app/workspace/select/page.tsx",
  import.meta.url,
);
const rootLayoutPath = new URL("../src/app/layout.tsx", import.meta.url);
const appRootPath = new URL("../src/app", import.meta.url);
const brandAssetPath = new URL("../public/brand", import.meta.url);
const webSourcePath = new URL("../src", import.meta.url);
const webPublicPath = new URL("../public", import.meta.url);

test("shared brand component renders approved mark and lockup assets", async () => {
  const [componentSource, typeSource] = await Promise.all([
    readFile(logoComponentPath, "utf8"),
    readFile(logoTypesPath, "utf8"),
  ]);

  assert.match(typeSource, /LCSP_LOGO_VARIANTS/);
  assert.match(typeSource, /mark: "mark"/);
  assert.match(typeSource, /lockup: "lockup"/);
  assert.match(typeSource, /LCSP_LOGO_SIZES/);
  assert.match(componentSource, /data-brand-logo=\{variant\}/);
  assert.match(componentSource, /\/brand\/lcsp-mark-light\.svg/);
  assert.match(componentSource, /\/brand\/lcsp-mark-dark\.svg/);
  assert.match(componentSource, /\/brand\/lcsp-lockup-light\.svg/);
  assert.match(componentSource, /\/brand\/lcsp-lockup-dark\.svg/);
  assert.doesNotMatch(componentSource, /filter:|invert|brightness|contrast/);
});

test("marketing product features and pricing share the lockup header", async () => {
  const [shellSource, pagesSource] = await Promise.all([
    readFile(marketingShellPath, "utf8"),
    readFile(marketingPagesPath, "utf8"),
  ]);

  assert.match(shellSource, /import \{ LCSPLogo \}/);
  assert.match(
    shellSource,
    /aria-label=\{t\("pages\.marketing\.brandHomeLabel"\)\}/,
  );
  assert.match(shellSource, /href="\/"/);
  assert.match(shellSource, /<LCSPLogo variant="lockup" size="md" \/>/);
  assert.match(shellSource, /<LCSPLogo variant="lockup" size="sm" \/>/);
  assert.doesNotMatch(shellSource, />\s*LCSP\s*</);
  for (const route of [
    '<MarketingShell active="product">',
    '<MarketingShell active="features">',
    '<MarketingShell active="pricing">',
  ]) {
    assert.match(pagesSource, new RegExp(escapeRegExp(route)));
  }
});

test("auth and workspace selection reuse the shared lockup component", async () => {
  const [authSource, workspaceSource] = await Promise.all([
    readFile(authShellPath, "utf8"),
    readFile(workspaceSelectPath, "utf8"),
  ]);

  assert.match(authSource, /import \{ LCSPLogo \}/);
  assert.match(authSource, /<LCSPLogo variant="lockup" size="md" \/>/);
  assert.match(authSource, /aria-label=\{homeLabel\}/);
  assert.doesNotMatch(authSource, /pages\.appShell\.productName\}\s*<\/Link>/);
  assert.match(workspaceSource, /import \{ LCSPLogo \}/);
  assert.match(workspaceSource, /variant="lockup"/);
  assert.match(workspaceSource, /decorative=\{false\}/);
  assert.doesNotMatch(workspaceSource, /ShieldCheckIcon|rounded-md bg-primary/);
});

test("admin routes do not carry a separate brand implementation", async () => {
  const files = await listFiles(new URL("../src", import.meta.url));
  const adminFiles = files.filter((file) => /\/admin\/|admin/i.test(file));

  if (adminFiles.length === 0) {
    assert.equal(adminFiles.length, 0);
    return;
  }

  const sources = await Promise.all(
    adminFiles
      .filter((file) => /\.(tsx|ts)$/.test(file))
      .map((file) => readFile(file, "utf8")),
  );
  const combined = sources.join("\n");

  assert.doesNotMatch(combined, /ShieldCheckIcon|Lucide|>\s*LCSP\s*</);
  assert.match(combined, /LCSPLogo/);
});

test("metadata favicon and apple icon use mark-only brand assets", async () => {
  const [layoutSource, appFiles] = await Promise.all([
    readFile(rootLayoutPath, "utf8"),
    readdir(appRootPath),
  ]);

  assert.match(layoutSource, /icons:/);
  assert.match(layoutSource, /\/brand\/lcsp-mark-light\.svg/);
  assert.match(layoutSource, /\/brand\/lcsp-mark-dark\.svg/);
  assert.match(layoutSource, /\/brand\/lcsp-apple-touch-icon\.png/);
  assert.doesNotMatch(layoutSource, /lcsp-lockup.*icon|favicon\.ico/);
  assert.ok(!appFiles.some((file) => /^favicon\.(ico|png|svg)$/.test(file)));
});

test("brand assets are stable local files without temporary Figma URLs", async () => {
  const assetFiles = await readdir(brandAssetPath);

  for (const asset of [
    "lcsp-mark-light.svg",
    "lcsp-mark-dark.svg",
    "lcsp-lockup-light.svg",
    "lcsp-lockup-dark.svg",
    "lcsp-apple-touch-icon.png",
  ]) {
    assert.ok(assetFiles.includes(asset), `${asset} is missing`);
    assert.ok(
      (await stat(new URL(`../public/brand/${asset}`, import.meta.url))).size >
        0,
    );
  }

  const svgSources = await Promise.all(
    assetFiles
      .filter((asset) => asset.endsWith(".svg"))
      .map((asset) =>
        readFile(new URL(`../public/brand/${asset}`, import.meta.url), "utf8"),
      ),
  );
  const combined = svgSources.join("\n");

  assert.doesNotMatch(combined, /figma\.com\/api\/mcp\/asset/);
  assert.doesNotMatch(combined, /<text|ShieldCheckIcon|lucide/i);
  assert.match(combined, /#2D2D2A/);
  assert.match(combined, /#E8E5DF/);
});

test("light dark and system theme behavior stays class based", async () => {
  const [componentSource, layoutSource] = await Promise.all([
    readFile(logoComponentPath, "utf8"),
    readFile(rootLayoutPath, "utf8"),
  ]);

  assert.match(componentSource, /dark:hidden/);
  assert.match(componentSource, /dark:block/);
  assert.doesNotMatch(
    componentSource,
    /useTheme|setTheme|localStorage|sessionStorage/,
  );
  assert.match(layoutSource, /defaultTheme="system"/);
  assert.match(layoutSource, /enableSystem/);
});

test("logo navigation has no unrelated side effects", async () => {
  const [marketingSource, authSource] = await Promise.all([
    readFile(marketingShellPath, "utf8"),
    readFile(authShellPath, "utf8"),
  ]);
  const combined = `${marketingSource}\n${authSource}`;

  assert.doesNotMatch(
    combined,
    /onClick=\{|handleSignOut|setTheme|setSelectedWorkspace|router\.replace\("\/workspace"\)/,
  );
});

test("production source does not retain temporary Figma asset URLs", async () => {
  const files = await listFiles(webSourcePath);
  const publicFiles = await listFiles(webPublicPath);
  const sources = await Promise.all(
    [...files, ...publicFiles]
      .filter((file) => /\.(tsx|ts|svg|json|css|md)$/.test(file))
      .map((file) => readFile(file, "utf8")),
  );

  assert.doesNotMatch(sources.join("\n"), /figma\.com\/api\/mcp\/asset/);
});

async function listFiles(root: URL | string): Promise<string[]> {
  const rootPath = root instanceof URL ? root.pathname : root;
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootPath, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
