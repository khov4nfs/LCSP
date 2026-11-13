import { z } from "zod";
import { createHash } from "node:crypto";
import {
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
} from "./constants.ts";
import { repositorySourcePathPrefixSchema } from "../github-integration/source-scope.ts";

export const REPOSITORY_SCANNER_VERSIONS = {
  v1: "LCSP_PRE_SCAN_V1",
} as const;
export type RepositoryScannerVersion =
  (typeof REPOSITORY_SCANNER_VERSIONS)[keyof typeof REPOSITORY_SCANNER_VERSIONS];

export const REPOSITORY_MANIFEST_TYPES = {
  packageJson: "PACKAGE_JSON",
  pnpmLock: "PNPM_LOCK",
  packageLock: "PACKAGE_LOCK",
  yarnLock: "YARN_LOCK",
  requirementsTxt: "REQUIREMENTS_TXT",
  pyprojectToml: "PYPROJECT_TOML",
  pipfile: "PIPFILE",
  poetryLock: "POETRY_LOCK",
  cargoToml: "CARGO_TOML",
  cargoLock: "CARGO_LOCK",
  goMod: "GO_MOD",
  goSum: "GO_SUM",
  pomXml: "POM_XML",
  buildGradle: "BUILD_GRADLE",
  dockerfile: "DOCKERFILE",
  dockerCompose: "DOCKER_COMPOSE",
  githubWorkflow: "GITHUB_WORKFLOW",
  unknown: "UNKNOWN",
} as const;
export type RepositoryManifestType =
  (typeof REPOSITORY_MANIFEST_TYPES)[keyof typeof REPOSITORY_MANIFEST_TYPES];

export const PRE_SCAN_DEPENDENCY_KINDS = {
  production: "PRODUCTION",
  development: "DEVELOPMENT",
  peer: "PEER",
  optional: "OPTIONAL",
} as const;
export type PreScanDependencyKind =
  (typeof PRE_SCAN_DEPENDENCY_KINDS)[keyof typeof PRE_SCAN_DEPENDENCY_KINDS];

export const PRE_SCAN_FRAMEWORK_CATEGORIES = {
  webFramework: "WEB_FRAMEWORK",
  databaseClient: "DATABASE_CLIENT",
  orm: "ORM",
  authentication: "AUTHENTICATION",
  testing: "TESTING",
  messaging: "MESSAGING",
  logging: "LOGGING",
  utility: "UTILITY",
  containerization: "CONTAINERIZATION",
  infrastructure: "INFRASTRUCTURE",
} as const;
export type PreScanFrameworkCategory =
  (typeof PRE_SCAN_FRAMEWORK_CATEGORIES)[keyof typeof PRE_SCAN_FRAMEWORK_CATEGORIES];

export const PRE_SCAN_CONTAINERIZATION_KINDS = {
  dockerfile: "DOCKERFILE",
  dockerCompose: "DOCKER_COMPOSE",
  containerConfig: "CONTAINER_CONFIG",
} as const;
export type PreScanContainerizationKind =
  (typeof PRE_SCAN_CONTAINERIZATION_KINDS)[keyof typeof PRE_SCAN_CONTAINERIZATION_KINDS];

export const PRE_SCAN_GAP_REASONS = {
  fileSizeLimitExceeded: "FILE_SIZE_LIMIT_EXCEEDED",
  fileCountLimitReached: "FILE_COUNT_LIMIT_REACHED",
  unreadableOrMalformed: "UNREADABLE_OR_MALFORMED",
  binaryFile: "BINARY_FILE",
  unsupportedSyntax: "UNSUPPORTED_SYNTAX",
  traversalRejected: "TRAVERSAL_REJECTED",
  secretRedacted: "SECRET_REDACTED",
} as const;
export type PreScanGapReason =
  (typeof PRE_SCAN_GAP_REASONS)[keyof typeof PRE_SCAN_GAP_REASONS];

const pathSchema = z
  .string()
  .min(1)
  .max(ASSESSMENT_DOMAIN_LIMITS.MAX_PATH_LENGTH)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\0") &&
      !value.split("/").includes(".."),
    { message: "Path must be repository-relative without traversal" },
  );

export const manifestDependencySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  versionRange: z.string().trim().max(100).nullable(),
  kind: z.enum(PRE_SCAN_DEPENDENCY_KINDS),
  line: z.number().int().min(1),
});
export type ManifestDependency = z.infer<typeof manifestDependencySchema>;

export const repositoryManifestObservationSchema = z.strictObject({
  path: pathSchema,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  manifestType: z.enum(REPOSITORY_MANIFEST_TYPES),
  name: z.string().trim().max(200).nullable(),
  version: z.string().trim().max(100).nullable(),
  dependencies: z.array(manifestDependencySchema).max(5000),
});
export type RepositoryManifestObservation = z.infer<
  typeof repositoryManifestObservationSchema
>;

export const repositoryLanguageObservationSchema = z.strictObject({
  language: z.string().trim().min(1).max(50),
  fileCount: z.number().int().nonnegative(),
  samplePaths: z.array(pathSchema).max(50),
});
export type RepositoryLanguageObservation = z.infer<
  typeof repositoryLanguageObservationSchema
>;

export const repositoryFrameworkObservationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  category: z.enum(PRE_SCAN_FRAMEWORK_CATEGORIES),
  path: pathSchema,
  line: z.number().int().min(1),
  evidenceExcerpt: z.string().trim().min(1).max(1000),
});
export type RepositoryFrameworkObservation = z.infer<
  typeof repositoryFrameworkObservationSchema
>;

export const repositoryBuildSystemObservationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  path: pathSchema,
  line: z.number().int().min(1),
});
export type RepositoryBuildSystemObservation = z.infer<
  typeof repositoryBuildSystemObservationSchema
>;

export const repositoryCiWorkflowObservationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  path: pathSchema,
  line: z.number().int().min(1),
});
export type RepositoryCiWorkflowObservation = z.infer<
  typeof repositoryCiWorkflowObservationSchema
>;

export const repositoryContainerObservationSchema = z.strictObject({
  kind: z.enum(PRE_SCAN_CONTAINERIZATION_KINDS),
  path: pathSchema,
  line: z.number().int().min(1),
});
export type RepositoryContainerObservation = z.infer<
  typeof repositoryContainerObservationSchema
>;

export const repositoryCandidateFactSchema = z.strictObject({
  statement: z
    .string()
    .trim()
    .min(1)
    .max(ASSESSMENT_DOMAIN_LIMITS.MAX_STATEMENT_LENGTH),
  kind: z.literal(ASSESSMENT_FACT_KINDS.FACT),
  authority: z.literal(ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED),
  evidence: z.strictObject({
    path: pathSchema,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    excerptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
});
export type RepositoryCandidateFact = z.infer<
  typeof repositoryCandidateFactSchema
>;

export const repositoryPreScanGapSchema = z.strictObject({
  path: z.string().trim().max(1024),
  reason: z.enum(PRE_SCAN_GAP_REASONS),
  detail: z.string().trim().max(500).optional(),
});
export type RepositoryPreScanGap = z.infer<typeof repositoryPreScanGapSchema>;

export const repositoryProfileSchema = z.strictObject({
  repositoryId: z.string().trim().min(1).max(200),
  commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  sourcePathPrefix: repositorySourcePathPrefixSchema,
  scannerVersion: z.enum(REPOSITORY_SCANNER_VERSIONS),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  languages: z.array(repositoryLanguageObservationSchema).max(100),
  manifests: z.array(repositoryManifestObservationSchema).max(500),
  frameworks: z.array(repositoryFrameworkObservationSchema).max(500),
  buildSystems: z.array(repositoryBuildSystemObservationSchema).max(100),
  ciWorkflows: z.array(repositoryCiWorkflowObservationSchema).max(200),
  containerization: z.array(repositoryContainerObservationSchema).max(100),
  candidateFacts: z.array(repositoryCandidateFactSchema).max(500),
  knownGaps: z.array(repositoryPreScanGapSchema).max(1000),
  scannedFileCount: z.number().int().nonnegative(),
  scannedAt: z.iso.datetime(),
});
export type RepositoryProfile = z.infer<typeof repositoryProfileSchema>;

/**
 * Business purpose:
 * Compute a deterministic SHA-256 content digest over the canonical JSON representation
 * of repository profile observations.
 *
 * Business rules:
 * - Excludes volatile properties (scannedAt) and self-referential contentDigest.
 * - Sorts collections (languages, manifests, frameworks, etc.) to guarantee reproducibility across scans.
 *
 * Execution flow:
 * 1. Normalize repository coordinates (commitSha lowercase, source prefix canonical).
 * 2. Sort observations deterministically.
 * 3. Serialize to canonical JSON string and compute SHA-256 hash formatted as sha256:hex.
 *
 * Failure cases:
 * - None: pure deterministic serialization and hashing.
 *
 * Side effects:
 * - Pure calculation with no I/O or state modification.
 */
export function computeRepositoryProfileDigest(
  profile: Omit<RepositoryProfile, "contentDigest" | "scannedAt">,
): string {
  const canonical = JSON.stringify(
    {
      repositoryId: profile.repositoryId,
      commitSha: profile.commitSha.toLowerCase(),
      sourcePathPrefix: profile.sourcePathPrefix,
      scannerVersion: profile.scannerVersion,
      languages: [...profile.languages].sort((a, b) =>
        a.language.localeCompare(b.language),
      ),
      manifests: [...profile.manifests].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
      frameworks: [...profile.frameworks].sort((a, b) =>
        a.name === b.name ? a.path.localeCompare(b.path) : a.name.localeCompare(b.name),
      ),
      buildSystems: [...profile.buildSystems].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      ciWorkflows: [...profile.ciWorkflows].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
      containerization: [...profile.containerization].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
      candidateFacts: [...profile.candidateFacts].sort((a, b) =>
        a.statement.localeCompare(b.statement),
      ),
      knownGaps: [...profile.knownGaps].sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
      scannedFileCount: profile.scannedFileCount,
    },
    Object.keys,
  );
  return `sha256:${createHash("sha256").update(canonical, "utf-8").digest("hex")}`;
}
