import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { CONFIG_WORKSPACE_ROOT } from "../../../../config/config.js";
import type { AppConfig } from "../../../../config/config.types.js";
import { ModelPricingDomainError } from "../../domain/billing.errors.js";
import {
  assertRuntimeModelAllowlisted,
  isRuntimeModelAllowlisted,
  parseRuntimeModelAllowlistYaml,
  type ParsedRuntimeModelRoutes,
  type RuntimeAllowlistEntry,
} from "../../domain/runtime-model-allowlist.js";

export type RuntimeModelAllowlistOptions = {
  routesFilePath?: string;
  routesYaml?: string;
  entries?: readonly RuntimeAllowlistEntry[];
};

const MODEL_ROUTES_OVERRIDE_ENV = "LCSP_MODEL_ROUTES_FILE";
const DEFAULT_MODEL_ROUTES_RELATIVE_PATH =
  "deepagents/config/model_routes.yaml";

@Injectable()
export class RuntimeModelAllowlistService {
  private cachedSourceKey: string | null = null;
  private cachedRoutes: ParsedRuntimeModelRoutes | null = null;

  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig, true>,
    @Optional() private readonly options?: RuntimeModelAllowlistOptions,
  ) {}

  /**
   * Business purpose: Clear the cached runtime model allowlist so subsequent lookups re-read configuration from disk.
   *
   * Business rules:
   * - Resetting cache affects only in-memory parsed routes and never relaxes fail-closed validation.
   *
   * Execution flow:
   * 1. Reset `cachedSourceKey` and `cachedRoutes` to `null`.
   *
   * Failure cases:
   * - None: resetting local cache references cannot fail.
   *
   * Side effects:
   * - Mutates in-memory cache fields on this service instance.
   */
  clearCache(): void {
    // Why: Tests and configuration reload hooks need to invalidate cached YAML allowlist entries deterministically.
    // How: Clears both the source key and parsed routes snapshot so the next query reloads cleanly.
    // Invariants: Never leaves partial cache state behind.
    this.cachedSourceKey = null;
    this.cachedRoutes = null;
  }

  /**
   * Business purpose: Return all runtime-allowlisted `(routeId, provider, protocol, model)` entries from the authoritative routing authority.
   *
   * Business rules:
   * - Fails closed if the routes file is missing, unreadable, or fails schema validation.
   *
   * Execution flow:
   * 1. Load or retrieve the cached parsed routes authority.
   * 2. Return a shallow copy of the allowlist entries array.
   *
   * Failure cases:
   * - Throws `ModelPricingDomainError` when the routes file is missing, unreadable, or malformed.
   *
   * Side effects:
   * - Reads the configured `model_routes.yaml` file once per source key on cache miss.
   */
  listEntries(): readonly RuntimeAllowlistEntry[] {
    return [...this.getParsedRoutes().entries];
  }

  /**
   * Business purpose: List distinct allowlisted model names, optionally filtered to a single normalized provider.
   *
   * Business rules:
   * - When `provider` is supplied, it must be a non-empty trimmed string and is matched case-insensitively.
   * - Model names retain their exact configured casing.
   *
   * Execution flow:
   * 1. Load parsed allowlist entries.
   * 2. If `provider` is omitted, return deduplicated `allowlistedModels`; otherwise validate and filter by lowercase `provider`.
   *
   * Failure cases:
   * - Throws `ModelPricingDomainError` if `provider` is empty/untrimmed or the underlying allowlist file cannot load.
   *
   * Side effects:
   * - Reads the configured `model_routes.yaml` file on first invocation if not cached.
   */
  listAllowlistedModels(provider?: string): readonly string[] {
    const parsed = this.getParsedRoutes();
    if (provider === undefined) {
      return [...parsed.allowlistedModels];
    }

    if (
      typeof provider !== "string" ||
      provider.length === 0 ||
      provider.trim() !== provider
    ) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        "provider filter must be a non-empty trimmed string",
      );
    }

    const normalizedProvider = provider.toLowerCase();
    const models = new Set<string>();
    for (const entry of parsed.entries) {
      if (entry.provider.toLowerCase() === normalizedProvider) {
        models.add(entry.model);
      }
    }
    return Array.from(models);
  }

  /**
   * Business purpose: Return parsed route, role, and fallback metadata for Admin overview projections.
   *
   * Business rules:
   * - Exposes read-only metadata derived strictly from the validated routing file.
   *
   * Execution flow:
   * 1. Load or retrieve the cached parsed routes structure.
   * 2. Return the validated `ParsedRuntimeModelRoutes` object.
   *
   * Failure cases:
   * - Throws `ModelPricingDomainError` when the underlying routes file cannot be read or fails validation.
   *
   * Side effects:
   * - Reads `model_routes.yaml` on first call if not already cached.
   */
  getParsedRoutes(): ParsedRuntimeModelRoutes {
    // Why: Centralizes loading and caching so every allowlist check shares one authoritative parsed representation.
    // How: Checks constructor overrides (`entries`, `routesYaml`), then resolves the routes file path and caches by source key.
    // Invariants: Always fails closed on missing or invalid YAML; never returns a fallback empty allowlist.
    if (this.options?.entries) {
      const models = Array.from(
        new Set(this.options.entries.map((entry) => entry.model)),
      );
      return {
        entries: [...this.options.entries],
        allowlistedModels: models,
        roles: {},
        fallbacks: {},
      };
    }

    if (this.options?.routesYaml !== undefined) {
      if (this.cachedSourceKey !== "__inline_yaml__" || !this.cachedRoutes) {
        this.cachedRoutes = parseRuntimeModelAllowlistYaml(
          this.options.routesYaml,
        );
        this.cachedSourceKey = "__inline_yaml__";
      }
      return this.cachedRoutes;
    }

    const resolvedPath = this.resolveRoutesFilePath();
    if (this.cachedSourceKey === resolvedPath && this.cachedRoutes) {
      return this.cachedRoutes;
    }

    if (!existsSync(resolvedPath)) {
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Model routes file does not exist at '${resolvedPath}'`,
      );
    }

    let yamlContent: string;
    try {
      yamlContent = readFileSync(resolvedPath, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ModelPricingDomainError(
        BILLING_ERROR_CODES.validationFailed,
        `Failed to read model routes file at '${resolvedPath}': ${detail}`,
      );
    }

    const parsed = parseRuntimeModelAllowlistYaml(yamlContent);
    this.cachedSourceKey = resolvedPath;
    this.cachedRoutes = parsed;
    return parsed;
  }

  /**
   * Business purpose: Check without throwing whether `(provider, resolvedModel)` is authorized in the runtime allowlist.
   *
   * Business rules:
   * - `provider` matches case-insensitively; `resolvedModel` matches case-sensitively; untrimmed values return `false`.
   * - Infrastructure failure loading the routes file still fails closed by throwing rather than returning `false` silently.
   *
   * Execution flow:
   * 1. Load validated allowlist entries.
   * 2. Delegate `(provider, resolvedModel)` matching to `isRuntimeModelAllowlisted`.
   *
   * Failure cases:
   * - Throws `ModelPricingDomainError` if the routes file itself is missing or corrupt.
   *
   * Side effects:
   * - Reads `model_routes.yaml` on first call if not cached.
   */
  isAllowlisted(provider: string, resolvedModel: string): boolean {
    const parsed = this.getParsedRoutes();
    return isRuntimeModelAllowlisted(parsed.entries, provider, resolvedModel);
  }

  /**
   * Business purpose: Enforce that `(provider, resolvedModel)` is allowlisted before pricing resolution, preview, or publication.
   *
   * Business rules:
   * - Rejects unlisted, mismatched-provider, blank, or untrimmed identifiers with `ModelPricingUnlistedModelError`.
   *
   * Execution flow:
   * 1. Load validated allowlist entries.
   * 2. Delegate assertion to `assertRuntimeModelAllowlisted` and return the matching route entry.
   *
   * Failure cases:
   * - Throws `ModelPricingUnlistedModelError` (`MODEL_PRICING_UNLISTED_MODEL`) when not allowlisted.
   * - Throws `ModelPricingDomainError` if the routes authority file is missing or malformed.
   *
   * Side effects:
   * - Reads `model_routes.yaml` on first call if not cached.
   */
  assertAllowlisted(
    provider: string,
    resolvedModel: string,
  ): RuntimeAllowlistEntry {
    const parsed = this.getParsedRoutes();
    return assertRuntimeModelAllowlisted(
      parsed.entries,
      provider,
      resolvedModel,
    );
  }

  /**
   * Business purpose: Resolve the filesystem path to the authoritative `model_routes.yaml` configuration.
   *
   * Business rules:
   * - Precedence: constructor `options.routesFilePath` -> `process.env.LCSP_MODEL_ROUTES_FILE` -> `CONFIG_WORKSPACE_ROOT/deepagents/config/model_routes.yaml`.
   * - Relative override paths are anchored to `CONFIG_WORKSPACE_ROOT` so execution from `apps/api` or repo root matches `scripts/run.mjs`.
   *
   * Execution flow:
   * 1. Inspect `options.routesFilePath` and `process.env.LCSP_MODEL_ROUTES_FILE`.
   * 2. Anchor relative paths to `CONFIG_WORKSPACE_ROOT` or fall back to the default repository YAML path.
   *
   * Failure cases:
   * - None: returns the resolved string path for downstream existence and read checks.
   *
   * Side effects:
   * - Reads `process.env.LCSP_MODEL_ROUTES_FILE` without modifying environment variables.
   */
  private resolveRoutesFilePath(): string {
    // Why: NestJS API processes run from `apps/api` or repo root; anchoring relative paths to `CONFIG_WORKSPACE_ROOT`
    // guarantees consistent resolution parity with `scripts/run.mjs` and `deepagents/model_policy.py`.
    // How: Evaluates constructor override, then `LCSP_MODEL_ROUTES_FILE` (or ConfigService fallback), then default repo path.
    // Invariants: Always returns an absolute filesystem path.
    const explicitPath = this.options?.routesFilePath?.trim();
    const envPath = process.env[MODEL_ROUTES_OVERRIDE_ENV]?.trim();
    const candidate =
      explicitPath && explicitPath.length > 0
        ? explicitPath
        : envPath && envPath.length > 0
          ? envPath
          : DEFAULT_MODEL_ROUTES_RELATIVE_PATH;

    // Touch configService reference safely if injected so DI contract remains meaningful.
    void this.configService;

    return isAbsolute(candidate)
      ? candidate
      : resolve(CONFIG_WORKSPACE_ROOT, candidate);
  }
}
