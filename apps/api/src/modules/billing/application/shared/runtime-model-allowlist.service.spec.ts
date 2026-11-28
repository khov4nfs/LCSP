import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelPricingUnlistedModelError } from "../../domain/billing.errors.js";
import { RuntimeModelAllowlistService } from "./runtime-model-allowlist.service.js";

describe("RuntimeModelAllowlistService", () => {
  const originalEnvPath = process.env.LCSP_MODEL_ROUTES_FILE;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalEnvPath === undefined) {
      delete process.env.LCSP_MODEL_ROUTES_FILE;
    } else {
      process.env.LCSP_MODEL_ROUTES_FILE = originalEnvPath;
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("loads the authoritative repository deepagents/config/model_routes.yaml via CONFIG_WORKSPACE_ROOT", () => {
    delete process.env.LCSP_MODEL_ROUTES_FILE;
    const service = new RuntimeModelAllowlistService();

    expect(service.isAllowlisted("anthropic", "claude-sonnet-4-6")).toBe(true);
    expect(service.isAllowlisted("ANTHROPIC", "claude-sonnet-4-6")).toBe(true);
    expect(service.listAllowlistedModels("anthropic")).toContain(
      "claude-sonnet-4-6",
    );
    expect(() =>
      service.assertAllowlisted("anthropic", "unlisted-model"),
    ).toThrow(ModelPricingUnlistedModelError);
  });

  it("supports LCSP_MODEL_ROUTES_FILE env override and fails closed if missing or malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "lcsp-model-routes-"));
    tempDirs.push(dir);
    const routesFile = join(dir, "custom-routes.yaml");
    writeFileSync(
      routesFile,
      `
version: 1
routes:
  google-primary:
    provider: google_genai
    model: gemini-2.5-pro
roles:
  default: google-primary
`,
      "utf8",
    );

    process.env.LCSP_MODEL_ROUTES_FILE = routesFile;
    const service = new RuntimeModelAllowlistService();
    expect(service.isAllowlisted("GOOGLE_GENAI", "gemini-2.5-pro")).toBe(true);
    expect(service.isAllowlisted("anthropic", "claude-sonnet-4-6")).toBe(false);

    process.env.LCSP_MODEL_ROUTES_FILE = join(dir, "does-not-exist.yaml");
    const missingService = new RuntimeModelAllowlistService();
    expect(() => missingService.listEntries()).toThrow();
    expect(() =>
      missingService.assertAllowlisted("anthropic", "claude-sonnet-4-6"),
    ).toThrow();
  });

  it("supports constructor entries, routesFilePath, and routesYaml overrides", () => {
    const entriesService = new RuntimeModelAllowlistService(undefined, {
      entries: [
        {
          routeId: "test-google",
          provider: "google",
          protocol: "google_genai",
          model: "gemini-2.5-pro",
        },
      ],
    });
    expect(entriesService.isAllowlisted("google", "gemini-2.5-pro")).toBe(true);
    expect(entriesService.listAllowlistedModels("GOOGLE")).toEqual([
      "gemini-2.5-pro",
    ]);

    const yamlService = new RuntimeModelAllowlistService(undefined, {
      routesYaml: `
version: 1
routes:
  primary:
    provider: openai
    model: gpt-5.2
roles:
  default: primary
`,
    });
    expect(yamlService.isAllowlisted("OPENAI", "gpt-5.2")).toBe(true);
  });
});
