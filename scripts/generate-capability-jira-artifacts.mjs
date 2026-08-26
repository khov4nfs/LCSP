import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DEV_DIR = path.join(ROOT, "docs", "developer");
const MVP_START_DATE = "2026-07-06";
const REPO_TREE_BASE = "https://github.com/khovan123/LCSP/tree/main";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body
    .filter((r) => r.some((cell) => cell !== ""))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])));
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape(row[key] ?? "")).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function workdayDate(dayNumber) {
  const index = Number(dayNumber) - 1;
  if (!Number.isInteger(index) || index < 0) {
    return "";
  }

  const base = new Date(`${MVP_START_DATE}T00:00:00Z`);
  const weekOffset = Math.floor(index / 5) * 7;
  const weekdayOffset = index % 5;
  base.setUTCDate(base.getUTCDate() + weekOffset + weekdayOffset);
  return formatDate(base);
}

function deriveSchedule(targetWindow) {
  const windows = String(targetWindow ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^D(\d+)-D(\d+)$/);
      if (!match) {
        return null;
      }
      return {
        start: workdayDate(match[1]),
        due: workdayDate(match[2]),
      };
    })
    .filter((window) => window?.start && window?.due);

  if (windows.length === 0) {
    return { startDate: "", dueDate: "" };
  }

  return {
    startDate: windows[0].start,
    dueDate: windows[windows.length - 1].due,
  };
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactUnique(values) {
  return [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ];
}

function sortStoryRefs(storyRefs) {
  return [...storyRefs].sort((left, right) => {
    const [leftMajor, leftMinor] = left.split(".").map(Number);
    const [rightMajor, rightMinor] = right.split(".").map(Number);
    if (leftMajor !== rightMajor) {
      return leftMajor - rightMajor;
    }
    return leftMinor - rightMinor;
  });
}

function sortTargetWindows(windows) {
  return [...windows].sort((left, right) => {
    const leftMatch = left.match(/^D(\d+)-D(\d+)$/);
    const rightMatch = right.match(/^D(\d+)-D(\d+)$/);
    if (!leftMatch || !rightMatch) {
      return left.localeCompare(right);
    }
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  });
}

function slugFromArtifactPath(artifactPath) {
  return path.basename(artifactPath, path.extname(artifactPath));
}

function repoPathExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function toGithubReferenceUrl(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return REPO_TREE_BASE.replace("/tree/", "/blob/").concat(
      `/${normalizedPath}`,
    );
  }
  return `${REPO_TREE_BASE}/${normalizedPath}`;
}

function normalizeRepoFolderToken(token) {
  const clean = String(token ?? "")
    .trim()
    .replace(/[`]/g, "");
  const mapped = {
    "apps/api": ["apps/api/src/modules"],
    "apps/web": ["apps/web/src"],
    "packages/*": ["packages/contracts/src", "packages/i18n/src"],
    "packages/contracts": ["packages/contracts/src"],
    "packages/i18n": ["packages/i18n/src"],
    tests: ["tests"],
    "tests/*": ["tests"],
    scripts: ["scripts"],
  }[clean];

  if (mapped) {
    return mapped.filter(repoPathExists);
  }

  if (clean && repoPathExists(clean)) {
    return [clean];
  }

  return [];
}

function preferredRepoFoldersForDomain(domain) {
  const folderMap = {
    auth: [
      "apps/api/src/modules/auth-workspace",
      "apps/web/src",
      "packages/contracts/src/auth",
      "packages/i18n/src",
    ],
    governance: [
      "apps/api/src/modules/auth-workspace",
      "apps/web/src",
      "packages/contracts/src/shared",
      "packages/i18n/src",
      "tests",
    ],
    assessment: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "packages/i18n/src",
    ],
    wizard: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "packages/i18n/src",
    ],
    repository: [
      "apps/api/src/modules/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    scanner: [
      "apps/api/src/modules/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    "technical-profile": [
      "apps/api/src/modules/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    "ai-usage": [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    reconciliation: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    legal: [
      "apps/api/src/modules/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    classification: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "scripts",
    ],
    llm: [
      "scripts",
      "apps/api/src/modules/app",
      "packages/contracts/src/shared",
    ],
    reporting: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
      "packages/i18n/src",
    ],
    audit: [
      "apps/api/src/modules/app",
      "apps/web/src/app",
      "packages/contracts/src/shared",
    ],
    platform: [
      "scripts",
      "apps/api/src/modules",
      "packages/contracts/src/shared",
    ],
  };

  return compactUnique(
    (
      folderMap[domain] ?? [
        "apps/api/src/modules",
        "packages/contracts/src/shared",
      ]
    ).filter(repoPathExists),
  );
}

function fallbackRepoFoldersForDomain(domain) {
  return preferredRepoFoldersForDomain(domain);
}

function useStrictPreferredRepoReferences(domain) {
  return new Set(["audit", "reporting"]).has(domain);
}

function refineAuthContractReferencePaths(text, artifactPath) {
  const lower = text.toLowerCase();
  const slug = slugFromArtifactPath(artifactPath).toLowerCase();
  const references = [];

  if (
    /(public exports only|public exports|import boundary|semantic auth\/workspace contracts|typescript-contract-localization)/.test(
      lower,
    ) ||
    slug.includes("typescript-contract-localization")
  ) {
    references.push(
      "packages/contracts/src/auth/index.ts",
      "packages/contracts/src/index.ts",
    );
  }

  if (/(redact|redaction|secret|token|password|audit)/.test(lower)) {
    references.push("packages/contracts/src/auth/redact.ts");
  }

  if (
    /(required action|contact owner|verify email|accept invite|wait and retry)/.test(
      lower,
    )
  ) {
    references.push("packages/contracts/src/auth/actions.ts");
  }

  if (
    /(problem|error code|error-code|invalid credentials|membership missing|policy unavailable|state gate|oauth|oidc|mfa|session|sign-in|sign in|register|invite|pbac|authz|authorization)/.test(
      lower,
    )
  ) {
    references.push(
      "packages/contracts/src/auth/problems.ts",
      "packages/contracts/src/auth/codes.ts",
      "packages/contracts/src/auth/safe.ts",
    );
  }

  return compactUnique(references.filter(repoPathExists));
}

function refineSharedContractReferencePaths(text, artifactPath, domain) {
  const lower = text.toLowerCase();
  const slug = slugFromArtifactPath(artifactPath).toLowerCase();
  const references = [];

  if (
    /(locale|localization|i18n|vi\/en|dictionary|typed .*dictionaries|typed `vi\/en` dictionaries|business language)/.test(
      lower,
    ) ||
    slug.includes("typescript-contract-localization")
  ) {
    references.push("packages/contracts/src/shared/locale.ts");
  }

  if (
    /(public exports only|public exports|import boundary|root `tsconfig|package `tsconfig|semantic auth\/workspace contracts)/.test(
      lower,
    ) ||
    slug.includes("typescript-contract-localization")
  ) {
    references.push("packages/contracts/src/index.ts");
  }

  if (
    domain !== "auth" &&
    (/(dto|schema|validation contract|read-model|read model|status projection|presentation contract|blocking reason contract|enums|enum|result|claim schema|citation|evidence|profile dto|match result|command\/event schemas|contracts)/.test(
      lower,
    ) ||
      !references.length)
  ) {
    references.push("packages/contracts/src/shared/result.ts");
  }

  return compactUnique(references.filter(repoPathExists));
}

function refineContractReferencePaths(paths, text, domain, artifactPath) {
  const refinedPaths = [];

  for (const pathValue of paths) {
    if (pathValue === "packages/contracts/src/auth") {
      const authRefs = refineAuthContractReferencePaths(text, artifactPath);
      refinedPaths.push(...(authRefs.length > 0 ? authRefs : [pathValue]));
      continue;
    }

    if (pathValue === "packages/contracts/src/shared") {
      const sharedRefs = refineSharedContractReferencePaths(
        text,
        artifactPath,
        domain,
      );
      refinedPaths.push(...(sharedRefs.length > 0 ? sharedRefs : [pathValue]));
      continue;
    }

    if (pathValue === "packages/contracts/src") {
      const rootRefs = compactUnique([
        ...refineAuthContractReferencePaths(text, artifactPath).filter((item) =>
          item.endsWith("/index.ts"),
        ),
        ...refineSharedContractReferencePaths(
          text,
          artifactPath,
          domain,
        ).filter((item) => item === "packages/contracts/src/index.ts"),
      ]);
      refinedPaths.push(...(rootRefs.length > 0 ? rootRefs : [pathValue]));
      continue;
    }

    refinedPaths.push(pathValue);
  }

  return compactUnique(refinedPaths.filter(repoPathExists));
}

function extractRepoReferencePaths(artifactPath, domain) {
  const preferredPaths = preferredRepoFoldersForDomain(domain);
  if (useStrictPreferredRepoReferences(domain) && preferredPaths.length > 0) {
    return refineContractReferencePaths(
      preferredPaths,
      "",
      domain,
      artifactPath,
    );
  }

  if (!artifactPath) {
    return fallbackRepoFoldersForDomain(domain);
  }

  const absolutePath = path.join(ROOT, artifactPath);
  if (!fs.existsSync(absolutePath)) {
    return fallbackRepoFoldersForDomain(domain);
  }

  const text = fs.readFileSync(absolutePath, "utf8");
  const runtimeLine = text.match(/^- Runtime ownership:\s*(.+)$/m)?.[1] ?? "";
  const runtimeTokens = [...runtimeLine.matchAll(/`([^`]+)`/g)].map(
    (match) => match[1],
  );

  let fileStructureSection = "";
  const fileStructureStart = text.indexOf("### File Structure Notes");
  if (fileStructureStart !== -1) {
    const nextSectionStart = text.indexOf("\n### ", fileStructureStart + 1);
    fileStructureSection = text.slice(
      fileStructureStart,
      nextSectionStart === -1 ? text.length : nextSectionStart,
    );
  }
  const fileStructureTokens = [
    ...fileStructureSection.matchAll(/`([^`]+)`/g),
  ].map((match) => match[1]);

  const paths = compactUnique(
    [...runtimeTokens, ...fileStructureTokens].flatMap((token) =>
      normalizeRepoFolderToken(token),
    ),
  );

  if (preferredPaths.length > 0) {
    const narrowedPaths = compactUnique(
      preferredPaths.filter((preferredPath) =>
        paths.some(
          (pathValue) =>
            preferredPath === pathValue ||
            preferredPath.startsWith(`${pathValue}/`) ||
            pathValue.startsWith(`${preferredPath}/`),
        ),
      ),
    );

    if (narrowedPaths.length > 0) {
      return refineContractReferencePaths(
        narrowedPaths,
        text,
        domain,
        artifactPath,
      );
    }
  }

  if (paths.length > 0) {
    return refineContractReferencePaths(paths, text, domain, artifactPath);
  }

  return refineContractReferencePaths(
    fallbackRepoFoldersForDomain(domain),
    text,
    domain,
    artifactPath,
  );
}

const epics = [
  {
    code: "E1",
    order: 1,
    name: "Epic 1 - Authentication and Access Control",
    shortName: "Authentication",
    description:
      "Approved account entry, MFA/session safety, collaboration access, PBAC enforcement, and audit/governance foundations.",
    labels: "epic,auth,access-control",
    domain: "auth",
  },
  {
    code: "E2",
    order: 2,
    name: "Epic 2 - Assessment and Wizard",
    shortName: "Assessment and Wizard",
    description:
      "Manager-owned assessment creation, WizardProfile completion, readiness projection, and readiness export.",
    labels: "epic,assessment,wizard",
    domain: "assessment",
  },
  {
    code: "E3",
    order: 3,
    name: "Epic 3 - Repository Scan and Technical Evidence",
    shortName: "Repository and Scan",
    description:
      "Repository connection, snapshot pinning, trusted scan execution, evidence gates, and TechnicalProfile output.",
    labels: "epic,repository,scanner,evidence",
    domain: "scanner",
  },
  {
    code: "E4",
    order: 4,
    name: "Epic 4 - AI Usage Analysis",
    shortName: "AI Usage Analysis",
    description:
      "AIUsageFlow construction, claim provenance, uncertainty handling, conflict candidate generation, and review surface.",
    labels: "epic,ai-usage",
    domain: "ai-usage",
  },
  {
    code: "E5",
    order: 5,
    name: "Epic 5 - Reconciliation and Verified Profile",
    shortName: "Reconciliation",
    description:
      "Conflict detection, resolution workflow, immutable source preservation, VerifiedProfile generation, and approval gate.",
    labels: "epic,reconciliation,verified-profile",
    domain: "reconciliation",
  },
  {
    code: "E6",
    order: 6,
    name: "Epic 6 - Legal Corpus and Matching",
    shortName: "Legal Corpus",
    description:
      "Legal source ingest, corpus approval, vectorless retrieval, citation allowlist enforcement, and LegalRuleMatch evidence.",
    labels: "epic,legal,matching",
    domain: "legal",
  },
  {
    code: "E7",
    order: 7,
    name: "Epic 7 - Classification",
    shortName: "Classification",
    description:
      "Classification request gate, hard-rule precedence, real LLM provider path, citation validation, and result state presentation.",
    labels: "epic,classification,llm",
    domain: "classification",
  },
  {
    code: "E8",
    order: 8,
    name: "Epic 8 - Reporting and Audit",
    shortName: "Reporting and Audit",
    description:
      "Gap analysis, guarded document generation, artifact download, immutable audit history, and redacted audit export.",
    labels: "epic,reporting,audit",
    domain: "reporting",
  },
];

const epicByCode = new Map(epics.map((epic) => [epic.code, epic]));

const legacyCapabilityTasks = [
  {
    code: "E1-T1",
    epic: "E1",
    summary: "Approved Account Entry and OAuth Login Isolation",
    stories: ["1.1", "1.3"],
    owner: "L",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "auth",
    targetWindow: "D1-D5",
    dependencies: [],
    externalDependencies: [],
  },
  {
    code: "E1-T2",
    epic: "E1",
    summary: "MFA, Session, Recovery, and Profile Safety",
    stories: ["1.2"],
    owner: "A",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "auth",
    targetWindow: "D1-D5",
    dependencies: ["E1-T1"],
    externalDependencies: [],
  },
  {
    code: "E1-T3",
    epic: "E1",
    summary: "Organization Membership and Manager Policy Scope",
    stories: ["1.4"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "auth",
    targetWindow: "D6-D10",
    dependencies: ["E1-T1"],
    externalDependencies: [],
  },
  {
    code: "E1-T5",
    epic: "E1",
    summary: "Manager-Only Enforcement and PBAC Fail-Closed Runtime",
    stories: ["1.6", "1.7"],
    owner: "C",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "auth",
    targetWindow: "D11-D15",
    dependencies: ["E1-T3", "E1-T4"],
    externalDependencies: [],
  },
  {
    code: "E1-T6",
    epic: "E1",
    summary: "Audit, Outbox, and Worker Event Contract",
    stories: ["1.8", "1.9"],
    owner: "L",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "audit",
    targetWindow: "D1-D10",
    dependencies: ["E1-T1"],
    externalDependencies: [],
    extraReferences: [
      "TASK-003",
      "TASK-004",
      "docs/implementation/tasks/README.md",
    ],
  },
  {
    code: "E1-T7",
    epic: "E1",
    summary: "TypeScript Contract, Localization, and Import Governance",
    stories: ["1.10"],
    owner: "A",
    priority: "Medium",
    points: 3,
    runtime: "shared",
    domain: "governance",
    targetWindow: "D1-D5",
    dependencies: ["E1-T1"],
    externalDependencies: [],
  },
  {
    code: "E2-T1",
    epic: "E2",
    summary: "Create Manager-Owned Assessment",
    stories: ["2.1"],
    owner: "L",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "assessment",
    targetWindow: "D6-D10",
    dependencies: ["E1-T3"],
    externalDependencies: [],
  },
  {
    code: "E2-T2",
    epic: "E2",
    summary: "Complete WizardProfile in Business Language",
    stories: ["2.2"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "wizard",
    targetWindow: "D6-D10",
    dependencies: ["E2-T1"],
    externalDependencies: [],
  },
  {
    code: "E2-T3",
    epic: "E2",
    summary: "Wizard-Only Readiness Projection",
    stories: ["2.3"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "wizard",
    targetWindow: "D11-D15",
    dependencies: ["E2-T2"],
    externalDependencies: [],
  },
  {
    code: "E2-T4",
    epic: "E2",
    summary: "Wizard Readiness Export",
    stories: ["2.4"],
    owner: "A",
    priority: "High",
    points: 3,
    runtime: "cross-runtime",
    domain: "wizard",
    targetWindow: "D11-D15",
    dependencies: ["E2-T3"],
    externalDependencies: [],
  },
  {
    code: "E3-T1",
    epic: "E3",
    summary: "Connect Read-Only GitHub Repository",
    stories: ["3.1"],
    owner: "L",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "repository",
    targetWindow: "D1-D5",
    dependencies: ["E2-T1"],
    externalDependencies: ["GitHub App credentials"],
    extraReferences: ["TASK-009", "TASK-002"],
  },
  {
    code: "E3-T2",
    epic: "E3",
    summary: "Pin Commit and Create RepositorySnapshot",
    stories: ["3.2"],
    owner: "L",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "repository",
    targetWindow: "D6-D10",
    dependencies: ["E3-T1"],
    externalDependencies: [],
  },
  {
    code: "E3-T3",
    epic: "E3",
    summary: "Trusted Scan Trigger and Scan Job Orchestration",
    stories: ["3.3"],
    owner: "B",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "scanner",
    targetWindow: "D6-D10",
    dependencies: ["E3-T2", "E1-T6"],
    externalDependencies: [],
    extraReferences: ["TASK-010", "TASK-011"],
  },
  {
    code: "E3-T4",
    epic: "E3",
    summary: "Static Scanner Workspace and Toolchain Execution",
    stories: ["3.4", "3.5"],
    owner: "B",
    priority: "High",
    points: 5,
    runtime: "worker",
    domain: "scanner",
    targetWindow: "D11-D15",
    dependencies: ["E3-T3"],
    externalDependencies: [],
    extraReferences: ["TASK-012", "TASK-013", "TASK-014"],
  },
  {
    code: "E3-T5",
    epic: "E3",
    summary: "Evidence Acceptance and TechnicalEvidenceReport Gates",
    stories: ["3.6", "3.7"],
    owner: "B",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "scanner",
    targetWindow: "D11-D15",
    dependencies: ["E3-T4"],
    externalDependencies: [],
    extraReferences: ["TASK-015"],
  },
  {
    code: "E3-T6",
    epic: "E3",
    summary: "TechnicalProfile Generation",
    stories: ["3.8"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "technical-profile",
    targetWindow: "D16-D20",
    dependencies: ["E3-T5"],
    externalDependencies: [],
    extraReferences: ["TASK-016"],
  },
  {
    code: "E3-T7",
    epic: "E3",
    summary: "Findings Review, Scan Rerun, and Historical Guardrails",
    stories: ["3.9", "3.10", "3.11"],
    owner: "B",
    priority: "Medium",
    points: 4,
    runtime: "cross-runtime",
    domain: "technical-profile",
    targetWindow: "D21-D25",
    dependencies: ["E3-T6"],
    externalDependencies: [],
  },
  {
    code: "E4-T1",
    epic: "E4",
    summary: "Build AIUsageFlow and Preserve Technical Separation",
    stories: ["4.1", "4.2"],
    owner: "C",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "ai-usage",
    targetWindow: "D16-D20",
    dependencies: ["E3-T6"],
    externalDependencies: [],
    extraReferences: ["TASK-017"],
  },
  {
    code: "E4-T2",
    epic: "E4",
    summary: "Evidence-Referenced AI Usage Claims",
    stories: ["4.3"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "ai-usage",
    targetWindow: "D16-D20",
    dependencies: ["E4-T1"],
    externalDependencies: [],
  },
  {
    code: "E4-T3",
    epic: "E4",
    summary: "Unknown, Unclear, and Low-Confidence Usage Handling",
    stories: ["4.4"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "ai-usage",
    targetWindow: "D16-D20",
    dependencies: ["E4-T2"],
    externalDependencies: [],
  },
  {
    code: "E4-T4",
    epic: "E4",
    summary: "Conflict Candidate Detection for Reconciliation",
    stories: ["4.5"],
    owner: "C",
    priority: "Medium",
    points: 3,
    runtime: "cross-runtime",
    domain: "ai-usage",
    targetWindow: "D21-D25",
    dependencies: ["E4-T3"],
    externalDependencies: [],
    extraReferences: ["TASK-018"],
  },
  {
    code: "E4-T5",
    epic: "E4",
    summary: "AIUsageFlow Review Surface Without Final Authority",
    stories: ["4.6"],
    owner: "A",
    priority: "Medium",
    points: 4,
    runtime: "cross-runtime",
    domain: "ai-usage",
    targetWindow: "D21-D25",
    dependencies: ["E4-T4"],
    externalDependencies: [],
  },
  {
    code: "E5-T1",
    epic: "E5",
    summary: "Detect and Explain Material Profile Conflicts",
    stories: ["5.1", "5.2"],
    owner: "C",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "reconciliation",
    targetWindow: "D16-D20",
    dependencies: ["E4-T4"],
    externalDependencies: [],
  },
  {
    code: "E5-T2",
    epic: "E5",
    summary: "Manager Resolution Flow and Immutable Source Preservation",
    stories: ["5.3", "5.4"],
    owner: "A",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "reconciliation",
    targetWindow: "D21-D25",
    dependencies: ["E5-T1"],
    externalDependencies: [],
  },
  {
    code: "E5-T3",
    epic: "E5",
    summary: "VerifiedProfile Generation",
    stories: ["5.5"],
    owner: "C",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "reconciliation",
    targetWindow: "D21-D25",
    dependencies: ["E5-T2"],
    externalDependencies: [],
  },
  {
    code: "E5-T4",
    epic: "E5",
    summary: "VerifiedProfile Approval Gate",
    stories: ["5.6"],
    owner: "L",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "reconciliation",
    targetWindow: "D21-D25",
    dependencies: ["E5-T3"],
    externalDependencies: [],
  },
  {
    code: "E6-T1",
    epic: "E6",
    summary: "Ingest and Approve Legal Corpus Version",
    stories: ["6.1", "6.2", "6.3"],
    owner: "D",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "legal",
    targetWindow: "D1-D10",
    dependencies: ["E1-T6"],
    externalDependencies: ["Object storage"],
    extraReferences: ["TASK-020", "TASK-021"],
  },
  {
    code: "E6-T2",
    epic: "E6",
    summary: "Build Vectorless Legal Index",
    stories: ["6.4"],
    owner: "D",
    priority: "High",
    points: 4,
    runtime: "worker",
    domain: "legal",
    targetWindow: "D11-D15",
    dependencies: ["E6-T1"],
    externalDependencies: ["ChromaDB config"],
    extraReferences: ["TASK-022"],
  },
  {
    code: "E6-T3",
    epic: "E6",
    summary: "Retrieve and Allowlist Legal Context",
    stories: ["6.5", "6.6"],
    owner: "D",
    priority: "High",
    points: 5,
    runtime: "worker",
    domain: "legal",
    targetWindow: "D16-D20",
    dependencies: ["E6-T2"],
    externalDependencies: [],
    extraReferences: ["TASK-023"],
  },
  {
    code: "E6-T4",
    epic: "E6",
    summary: "Create LegalMatchingResult and LegalRuleMatch Evidence",
    stories: ["6.7"],
    owner: "D",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "legal",
    targetWindow: "D21-D25",
    dependencies: ["E6-T3", "E5-T4"],
    externalDependencies: [],
    extraReferences: ["TASK-024"],
  },
  {
    code: "E7-T1",
    epic: "E7",
    summary: "Submit Classification Request From Approved VerifiedProfile",
    stories: ["7.1"],
    owner: "L",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "classification",
    targetWindow: "D21-D25",
    dependencies: ["E5-T4", "E6-T4"],
    externalDependencies: [],
    extraReferences: ["TASK-026"],
  },
  {
    code: "E7-T2",
    epic: "E7",
    summary: "Apply Hard-Rule and LegalRuleMatch Precedence",
    stories: ["7.2"],
    owner: "D",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "classification",
    targetWindow: "D21-D25",
    dependencies: ["E7-T1", "E6-T4"],
    externalDependencies: [],
  },
  {
    code: "E7-T3",
    epic: "E7",
    summary: "Use Real LLM Provider With Schema and Budget Guardrails",
    stories: ["7.3"],
    owner: "L",
    priority: "High",
    points: 5,
    runtime: "shared",
    domain: "llm",
    targetWindow: "D1-D5; D16-D20",
    dependencies: [],
    externalDependencies: ["Provider credentials", "Provider SDK access"],
    extraReferences: [
      "TASK-025",
      "docs/implementation/llm-gateway-implementation.md",
    ],
  },
  {
    code: "E7-T4",
    epic: "E7",
    summary: "Reject Provider-Only or Unsupported Classification",
    stories: ["7.4"],
    owner: "D",
    priority: "Medium",
    points: 3,
    runtime: "cross-runtime",
    domain: "classification",
    targetWindow: "D21-D25",
    dependencies: ["E7-T2", "E7-T3"],
    externalDependencies: [],
  },
  {
    code: "E7-T5",
    epic: "E7",
    summary: "Validate Classification Citations and Present Result State",
    stories: ["7.5", "7.6"],
    owner: "A",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "classification",
    targetWindow: "D21-D30",
    dependencies: ["E7-T4", "E6-T3"],
    externalDependencies: [],
  },
  {
    code: "E8-T1",
    epic: "E8",
    summary: "Generate and Display Gap Analysis",
    stories: ["8.1", "8.2"],
    owner: "D",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "reporting",
    targetWindow: "D21-D25",
    dependencies: ["E7-T5"],
    externalDependencies: [],
    extraReferences: ["TASK-027"],
  },
  {
    code: "E8-T2",
    epic: "E8",
    summary: "Generate Guarded Final Report",
    stories: ["8.3"],
    owner: "D",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "reporting",
    targetWindow: "D21-D30",
    dependencies: ["E8-T1", "E7-T3"],
    externalDependencies: [],
    extraReferences: ["TASK-028"],
  },
  {
    code: "E8-T3",
    epic: "E8",
    summary: "Generate Evidence Readiness Report",
    stories: ["8.4"],
    owner: "D",
    priority: "High",
    points: 4,
    runtime: "cross-runtime",
    domain: "reporting",
    targetWindow: "D21-D30",
    dependencies: ["E8-T1"],
    externalDependencies: [],
    extraReferences: ["TASK-028"],
  },
  {
    code: "E8-T4",
    epic: "E8",
    summary: "Download Versioned Artifacts",
    stories: ["8.5"],
    owner: "A",
    priority: "Medium",
    points: 3,
    runtime: "cross-runtime",
    domain: "reporting",
    targetWindow: "D26-D30",
    dependencies: ["E8-T2", "E8-T3"],
    externalDependencies: [],
  },
  {
    code: "E8-T5",
    epic: "E8",
    summary: "Immutable Assessment Audit Trail and Redacted Export",
    stories: ["8.6", "8.7"],
    owner: "L",
    priority: "High",
    points: 5,
    runtime: "cross-runtime",
    domain: "audit",
    targetWindow: "D26-D30",
    dependencies: ["E1-T6", "E8-T4"],
    externalDependencies: [],
    extraReferences: ["TASK-029", "TASK-033", "TASK-034"],
  },
];

const storyRows = parseCsv(
  fs.readFileSync(path.join(DEV_DIR, "jira-lcsp-stories-import.csv"), "utf8"),
);

const storyByRef = new Map();
const storyRefBySlug = new Map();

for (const row of storyRows) {
  const refMatch = String(row.Summary).match(/Story\s+(\d+\.\d+)/);
  if (!refMatch) {
    continue;
  }
  const storyRef = refMatch[1];
  storyByRef.set(storyRef, row);
  if (row["Artifact Path"]) {
    storyRefBySlug.set(slugFromArtifactPath(row["Artifact Path"]), storyRef);
  }
}

const legacyTaskByCode = new Map(
  legacyCapabilityTasks.map((task) => [task.code, task]),
);
const storyLegacyDefaults = new Map();
for (const task of legacyCapabilityTasks) {
  for (const storyRef of task.stories) {
    storyLegacyDefaults.set(storyRef, {
      owner: task.owner,
      priority: task.priority,
      runtime: task.runtime,
      domain: task.domain,
      externalDependencies: compactUnique(task.externalDependencies ?? []),
      extraReferences: compactUnique(task.extraReferences ?? []),
      legacyTaskCode: task.code,
      legacyTaskSummary: task.summary,
    });
  }
}

function storyTargetWindows(storyRefs) {
  return compactUnique(
    storyRefs.flatMap((storyRef) =>
      splitList(storyByRef.get(storyRef)?.["Target Window"]),
    ),
  );
}

function storyArtifactPaths(storyRefs) {
  return compactUnique(
    storyRefs
      .map((storyRef) => storyByRef.get(storyRef)?.["Artifact Path"])
      .filter(Boolean),
  );
}

function storyDependencies(storyRefs) {
  const deps = [];
  for (const storyRef of storyRefs) {
    const row = storyByRef.get(storyRef);
    const depValue = String(row?.Dependency ?? "").trim();
    if (!depValue) {
      continue;
    }
    const depStoryRef =
      storyRefBySlug.get(depValue) ??
      depValue.match(/^(\d+\.\d+)/)?.[1] ??
      depValue
        .match(/^(\d+)-(\d+)/)
        ?.slice(1, 3)
        .join(".");
    if (depStoryRef) {
      deps.push(depStoryRef);
    }
  }
  return compactUnique(deps);
}

function normalizeStoryDependency(value) {
  const depValue = String(value ?? "").trim();
  if (!depValue) {
    return "";
  }

  const normalized = compactUnique(
    splitList(depValue)
      .map((part) => {
        const fromSlug = storyRefBySlug.get(part);
        if (fromSlug) {
          return fromSlug;
        }

        const dotRef = part.match(/^(\d+\.\d+)$/)?.[1];
        if (dotRef) {
          return dotRef;
        }

        const dashRef = part.match(/^(\d+)-(\d+)/);
        if (dashRef) {
          return `${dashRef[1]}.${dashRef[2]}`;
        }

        return part;
      })
      .filter(Boolean),
  );

  return sortStoryRefs(normalized.filter((item) => /^\d+\.\d+$/.test(item)))
    .concat(normalized.filter((item) => !/^\d+\.\d+$/.test(item)))
    .join("; ");
}

function extractStoryChecklistTasks(artifactPath) {
  if (!artifactPath) {
    return [];
  }

  const absolutePath = path.join(ROOT, artifactPath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const text = fs.readFileSync(absolutePath, "utf8");
  const startMarker = "## Tasks / Subtasks";
  const endMarker = "\n## Dev Notes";
  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) {
    return [];
  }

  const sectionStart = startIndex + startMarker.length;
  const endIndex = text.indexOf(endMarker, sectionStart);
  const section = text.slice(
    sectionStart,
    endIndex === -1 ? text.length : endIndex,
  );

  const rawLines = section.split("\n");
  const normalizeChecklistLine = (line) =>
    line
      .trim()
      .replace(/^- \[ \]\s*/, "")
      .replace(/\s*\(AC:[^)]+\)\s*$/i, "")
      .replace(/\.$/, "")
      .trim();

  const subtaskStart = rawLines.findIndex((line) =>
    /^\s*- \[ \]\s*story-specific subtasks/i.test(line),
  );

  if (subtaskStart !== -1) {
    const subtaskLines = rawLines
      .slice(subtaskStart + 1)
      .filter((line) => /^\s+- \[ \]/.test(line))
      .map(normalizeChecklistLine)
      .filter(Boolean);

    if (subtaskLines.length > 0) {
      return subtaskLines;
    }
  }

  return rawLines
    .filter((line) => /^- \[ \]/.test(line))
    .map(normalizeChecklistLine)
    .filter((line) => line && !/story-specific subtasks/i.test(line));
}

function storyTaskCode(epicCode, storyRef, index) {
  return `${epicCode}-S${storyRef.replace(".", "")}-F${index + 1}`;
}

function estimateFeaturePoints(text, index, total) {
  const base = index === 0 ? 2 : 1;
  if (total === 1) {
    return 3;
  }

  if (
    /orchestrat|provider|gateway|schema|aggregate|execution plan|claim set|policy runtime|index|vectorless|classification request/i.test(
      text,
    )
  ) {
    return Math.min(2, base + 1);
  }

  return base;
}

function fallbackStoryTaskText(row, storyRef) {
  return (
    String(row.Deliverable || row.Summary || "")
      .replace(new RegExp(`^Story\\s+${storyRef.replace(".", "\\.")}\\s+`), "")
      .trim() || `Implement story ${storyRef}`
  );
}

const storyImportRows = [];
const taskImportRows = [];
const storyTaskMapRows = [];
const featureTasks = [];
const featureTasksByStory = new Map();
const storyLastFeatureCode = new Map();
const storyRepoReferenceUrls = new Map();

for (const row of storyRows) {
  const refMatch = String(row.Summary).match(/Story\s+(\d+\.\d+)/);
  if (!refMatch) {
    continue;
  }
  const storyRef = refMatch[1];
  const epicCode = `E${storyRef.split(".")[0]}`;
  const epic = epicByCode.get(epicCode);
  const legacyDefaults = storyLegacyDefaults.get(storyRef);
  const targetWindow = String(row["Target Window"] || "").trim();
  const schedule = deriveSchedule(targetWindow);
  const repoReferenceUrls = extractRepoReferencePaths(
    row["Artifact Path"],
    row.Domain,
  ).map(toGithubReferenceUrl);
  storyRepoReferenceUrls.set(storyRef, repoReferenceUrls);

  storyImportRows.push({
    "Issue Type": row["Issue Type"],
    Summary: row.Summary,
    Description: row.Description,
    Status: "Ready for Dev",
    Assignee: "",
    "Owner Hint": row["Owner Hint"] || row.Assignee || "",
    Priority: row.Priority,
    "Story Points": row["Story Points"],
    "Epic Link": "",
    "Epic Ref": epic?.name ?? "",
    Labels: row.Labels,
    Runtime: row.Runtime,
    Domain: row.Domain,
    Deliverable: row.Deliverable,
    Reference: repoReferenceUrls.join("; "),
    "Artifact Path": row["Artifact Path"],
    Dependency: normalizeStoryDependency(row.Dependency),
    "External Dependency": row["External Dependency"] || "",
    "Start date": schedule.startDate,
    "Due date": schedule.dueDate,
    "Target Window": targetWindow,
    "Block Reason": row["Block Reason"] || "",
    "Story Ref": storyRef,
  });

  const checklistTasks = extractStoryChecklistTasks(row["Artifact Path"]);
  const featureTexts =
    checklistTasks.length > 0
      ? checklistTasks
      : [fallbackStoryTaskText(row, storyRef)];
  const taskRowsForStory = [];

  for (const [index, featureText] of featureTexts.entries()) {
    const code = storyTaskCode(epicCode, storyRef, index);
    const points = estimateFeaturePoints(
      featureText,
      index,
      featureTexts.length,
    );
    const summary = featureText;
    const dependencies = [];
    const references = repoReferenceUrls;

    const task = {
      code,
      epic: epicCode,
      storyRef,
      summary,
      owner: row["Owner Hint"] || legacyDefaults?.owner || "",
      priority: row.Priority || legacyDefaults?.priority || "Medium",
      points,
      runtime:
        row.Runtime ||
        legacyDefaults?.runtime ||
        epic?.domain ||
        "cross-runtime",
      domain: row.Domain || legacyDefaults?.domain || epic?.domain || "",
      targetWindow,
      dependencies,
      externalDependencies:
        index === 0
          ? compactUnique(legacyDefaults?.externalDependencies ?? [])
          : [],
      references,
      artifactPath: row["Artifact Path"],
      storySummary: row.Summary,
      deliverable: summary,
    };

    taskRowsForStory.push(task);
    featureTasks.push(task);
  }

  featureTasksByStory.set(storyRef, taskRowsForStory);
  storyLastFeatureCode.set(
    storyRef,
    taskRowsForStory[taskRowsForStory.length - 1]?.code ?? "",
  );
}

for (const [storyRef, tasks] of featureTasksByStory.entries()) {
  const storyRow = storyByRef.get(storyRef);
  const upstreamStoryRefs = splitList(
    normalizeStoryDependency(storyRow?.Dependency ?? ""),
  )
    .map((value) => {
      const exact = value.match(/^(\d+\.\d+)$/)?.[1];
      if (exact) {
        return exact;
      }
      const dash = value.match(/^(\d+)-(\d+)$/);
      if (dash) {
        return `${dash[1]}.${dash[2]}`;
      }
      return "";
    })
    .filter(Boolean);
  const upstreamTaskCodes = compactUnique(
    upstreamStoryRefs
      .map((value) => storyLastFeatureCode.get(value))
      .filter(Boolean),
  );

  for (const [index, task] of tasks.entries()) {
    task.dependencies =
      index === 0 ? upstreamTaskCodes : [tasks[index - 1].code].filter(Boolean);
  }
}

const epicRows = [];
for (const epic of epics) {
  const epicTasks = featureTasks.filter((task) => task.epic === epic.code);
  const windows = sortTargetWindows(
    compactUnique(epicTasks.flatMap((task) => splitList(task.targetWindow))),
  );
  const firstWindow = windows[0] ?? "";
  const lastWindow = windows[windows.length - 1] ?? "";
  const epicSchedule = deriveSchedule(
    [firstWindow, lastWindow].filter(Boolean).join("; "),
  );

  epicRows.push({
    "Issue Type": "Epic",
    Summary: epic.name,
    Description: epic.description,
    Status: "In Progress",
    Priority: "High",
    "Epic Name": epic.name,
    Labels: epic.labels,
    Reference: "docs/planning-artifacts/epics.md",
    "Start date": epicSchedule.startDate,
    "Due date": epicSchedule.dueDate,
    "Target Window": windows.join("; "),
  });
}

for (const task of featureTasks) {
  const epic = epicByCode.get(task.epic);
  const storyRefs = [task.storyRef];
  const references = compactUnique(task.references);
  const dependencyCodes = compactUnique(task.dependencies ?? []);
  const targetWindow =
    task.targetWindow ||
    String(storyByRef.get(task.storyRef)?.["Target Window"] || "");
  const schedule = deriveSchedule(targetWindow);
  const labels = compactUnique([
    "task",
    "feature",
    "story-slice",
    `module-${task.epic.toLowerCase()}`,
    task.domain,
  ]);
  const deliverable = task.summary;

  taskImportRows.push({
    "Issue Type": "Task",
    Summary: `${task.code} ${task.summary}`,
    Description: `${task.summary}. Feature task under ${epic.name}, anchored to Story ${task.storyRef}. This task is one implementation slice of the story acceptance criteria and should be completed independently with its own verification evidence.`,
    Status: "Ready for Dev",
    Assignee: "",
    "Owner Hint": task.owner,
    Priority: task.priority,
    "Story Points": task.points,
    "Epic Link": "",
    "Epic Ref": epic.name,
    Labels: labels.join(","),
    Runtime: task.runtime,
    Domain: task.domain,
    Deliverable: deliverable,
    Reference: references.join("; "),
    "Artifact Path": task.artifactPath,
    Dependency: dependencyCodes.join("; "),
    "External Dependency": compactUnique(task.externalDependencies ?? []).join(
      "; ",
    ),
    "Start date": schedule.startDate,
    "Due date": schedule.dueDate,
    "Target Window": targetWindow,
    "Block Reason": "",
    "Task Code": task.code,
    Module: epic.name,
  });

  const story = storyByRef.get(task.storyRef);
  storyTaskMapRows.push({
    "Story Ref": task.storyRef,
    "Story Summary": story?.Summary ?? "",
    "Epic Code": epic.code,
    "Epic Name": epic.name,
    "Task Code": task.code,
    "Task Summary": task.summary,
    Owner: task.owner,
    Point: task.points,
    Dependency: dependencyCodes.join("; "),
    "Target Window": targetWindow,
    Reference: references.join("; "),
  });
}

const epicHeader = [
  "Issue Type",
  "Summary",
  "Description",
  "Status",
  "Priority",
  "Epic Name",
  "Labels",
  "Reference",
  "Start date",
  "Due date",
  "Target Window",
];

const workItemHeader = [
  "Issue Type",
  "Summary",
  "Description",
  "Status",
  "Assignee",
  "Owner Hint",
  "Priority",
  "Story Points",
  "Epic Link",
  "Epic Ref",
  "Labels",
  "Runtime",
  "Domain",
  "Deliverable",
  "Reference",
  "Artifact Path",
  "Dependency",
  "External Dependency",
  "Start date",
  "Due date",
  "Target Window",
  "Block Reason",
];

writeCsv(
  path.join(DEV_DIR, "jira-lcsp-epics-import.csv"),
  epicHeader,
  epicRows,
);
writeCsv(
  path.join(DEV_DIR, "jira-lcsp-stories-import.csv"),
  [...workItemHeader, "Story Ref"],
  storyImportRows,
);
writeCsv(
  path.join(DEV_DIR, "jira-lcsp-tasks-import.csv"),
  [...workItemHeader, "Task Code", "Module"],
  taskImportRows,
);
writeCsv(
  path.join(DEV_DIR, "jira-lcsp-story-task-mapping.csv"),
  [
    "Story Ref",
    "Story Summary",
    "Epic Code",
    "Epic Name",
    "Task Code",
    "Task Summary",
    "Owner",
    "Point",
    "Dependency",
    "Target Window",
    "Reference",
  ],
  storyTaskMapRows,
);

const ownerTotals = new Map();
for (const task of featureTasks) {
  ownerTotals.set(
    task.owner,
    (ownerTotals.get(task.owner) ?? 0) + Number(task.points),
  );
}

const lines = [];
lines.push("# LCSP Story-Task Breakdown");
lines.push("");
lines.push("Regenerated backlog model for the next Jira project.");
lines.push("");
lines.push("## Operating Model");
lines.push("");
lines.push("- `Epic` = business module.");
lines.push(
  "- `Story` = acceptance and traceability anchor linked to an implementation artifact.",
);
lines.push(
  "- `Task` = smallest shippable feature slice under one story, assigned directly to a dev owner.",
);
lines.push("- `Sub-task` = removed from this operating model.");
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push("| Epic | Feature Tasks | Story Refs | Points | Primary Owners |");
lines.push("|---|---:|---|---:|---|");

for (const epic of epics) {
  const epicTasks = featureTasks.filter((task) => task.epic === epic.code);
  const storyRefs = sortStoryRefs(
    compactUnique(epicTasks.map((task) => task.storyRef)),
  );
  const owners = compactUnique(epicTasks.map((task) => task.owner));
  const points = epicTasks.reduce((sum, task) => sum + Number(task.points), 0);
  lines.push(
    `| ${epic.name} | ${epicTasks.length} | \`${storyRefs.join(
      ", ",
    )}\` | ${points} | \`${owners.join("`, `")}\` |`,
  );
}

lines.push("");
lines.push("## Owner Totals");
lines.push("");
lines.push("| Owner | Task Points |");
lines.push("|---|---:|");

for (const owner of [...ownerTotals.keys()].sort()) {
  lines.push(`| \`${owner}\` | ${ownerTotals.get(owner)} |`);
}

for (const epic of epics) {
  const epicTasks = featureTasks.filter((task) => task.epic === epic.code);
  lines.push("");
  lines.push(`## ${epic.name}`);
  lines.push("");
  lines.push(
    `Stories: \`${sortStoryRefs(
      compactUnique(epicTasks.map((task) => task.storyRef)),
    ).join("`, `")}\``,
  );
  lines.push("");
  lines.push("| Task | Pts | Owner | Story | Dependency | Window |");
  lines.push("|---|---:|---|---|---|---|");
  for (const task of epicTasks) {
    lines.push(
      `| \`${task.code} ${task.summary}\` | ${task.points} | \`${task.owner || "-"}\` | \`${task.storyRef}\` | \`${(task.dependencies ?? []).join("; ") || "none"}\` | \`${task.targetWindow}\` |`,
    );
  }
}

lines.push("");
lines.push("## Practical Jira Rule");
lines.push("");
lines.push("- Import `Epic` first, then `Story`, then `Task`.");
lines.push(
  "- Fill `Epic Link` in story/task CSV after Jira returns new epic issue keys.",
);
lines.push("- Use `Task` as the only dev-assigned implementation item.");
lines.push(
  "- Keep `Story` open until all mapped `Task` items are done and acceptance passes.",
);
lines.push("- Do not create `Sub-task` items in the new project.");

fs.writeFileSync(
  path.join(DEV_DIR, "lcsp-story-task-breakdown.md"),
  `${lines.join("\n")}\n`,
  "utf8",
);

const notes = [
  "# Jira LCSP Import Notes",
  "",
  "## Files",
  "",
  "- `jira-lcsp-epics-import.csv`",
  "- `jira-lcsp-stories-import.csv`",
  "- `jira-lcsp-tasks-import.csv`",
  "- `jira-lcsp-story-task-mapping.csv`",
  "- `lcsp-story-task-breakdown.md`",
  "",
  "## Operating Model",
  "",
  "- `Epic` = module lớn / business module.",
  "- `Story` = acceptance anchor từ implementation artifact.",
  "- `Task` = feature nhỏ nhất có thể ship/verify dưới một story, giao trực tiếp cho dev.",
  "- `Sub-task` = không dùng.",
  "",
  "## Import Order",
  "",
  "1. Import epics.",
  "2. Điền `Epic Link` trong story/task CSV bằng issue key của epic tương ứng.",
  "3. Import stories.",
  "4. Import tasks.",
  "5. Dùng `jira-lcsp-story-task-mapping.csv` để verify traceability story -> task.",
  "",
  "## Sprint / Scheduling",
  "",
  "- `Target Window` là source of truth cho phase D1-D5 .. D26-D30.",
  "- `Start date` và `Due date` đã được generate để dễ bulk-assign sprint sau import.",
  "",
  "## Assignment Rule",
  "",
  "- `Owner Hint` là owner capability đề xuất.",
  "- `Assignee` để trống mặc định cho toàn bộ issue.",
  "- `Reporter` là review owner mặc định, không cần custom field riêng.",
  "- Khi project Jira mới có user thật, map `Owner Hint` sang assignee account tương ứng nếu muốn phân công sau import.",
];

fs.writeFileSync(
  path.join(DEV_DIR, "jira-lcsp-import-notes.md"),
  `${notes.join("\n")}\n`,
  "utf8",
);

console.log("Generated:");
console.log("- docs/developer/jira-lcsp-epics-import.csv");
console.log("- docs/developer/jira-lcsp-stories-import.csv");
console.log("- docs/developer/jira-lcsp-tasks-import.csv");
console.log("- docs/developer/jira-lcsp-story-task-mapping.csv");
console.log("- docs/developer/lcsp-story-task-breakdown.md");
console.log("- docs/developer/jira-lcsp-import-notes.md");
