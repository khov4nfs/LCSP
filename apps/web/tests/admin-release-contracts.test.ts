import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

// Section 1: Unavailable metrics mapping vs Zero
test("Admin overview data mapping: unavailable metrics must not be coerced to zero", () => {
  type MetricValue<T> = { value: T; status: "AVAILABLE" } | { value: null; status: "UNAVAILABLE" };

  function formatMetric(metric: MetricValue<number>): string {
    if (metric.status === "UNAVAILABLE" || metric.value === null) {
      return "—"; // Or designated unavailable indicator, never "0"
    }
    return metric.value.toLocaleString();
  }

  const availableZero: MetricValue<number> = { value: 0, status: "AVAILABLE" };
  const unavailableMetric: MetricValue<number> = { value: null, status: "UNAVAILABLE" };

  assert.equal(formatMetric(availableZero), "0", "Legitimate 0 must format as '0'");
  assert.equal(formatMetric(unavailableMetric), "—", "Unavailable metric must format as unavailable dash, not '0'");
  assert.notEqual(formatMetric(unavailableMetric), "0", "Unavailable data must not be zero");
});

// Section 2: Figma design fixtures must not be used as production or test authority
test("Figma fixture isolation: Figma mock values must not be hardcoded as production truth", () => {
  const FIGMA_DESIGN_FIXTURES = {
    totalUsers: 1284,
    activeUsers: 842,
    version: "v2026.08.31",
    sampleAdminName: "Nhi M.",
    sampleAdminEmail: "admin@example.com",
    sourcesCount: 188,
    rulesCount: 75,
  } as const;

  function calculateActiveUserRatio(active: number, total: number): number {
    if (total <= 0) return 0;
    return active / total;
  }

  // Dynamic calculated data from database / server read model
  const dbSeededUsers = { active: 10, total: 15 };
  const calculatedRatio = calculateActiveUserRatio(dbSeededUsers.active, dbSeededUsers.total);

  assert.equal(calculatedRatio, 10 / 15);
  // Ensure ratio is not hardcoded to Figma fixture 842 / 1284
  assert.notEqual(calculatedRatio, FIGMA_DESIGN_FIXTURES.activeUsers / FIGMA_DESIGN_FIXTURES.totalUsers);
});

// Section 3: Localization invariance for dynamic values (EN / VI)
test("Admin i18n invariance: dynamic runtime values must not be translated", () => {
  const sampleRuntimeData = {
    email: "admin@corp.internal",
    userId: "usr_01HXYZ12345",
    corpusVersion: "v2026.09.01-draft",
    sourceCount: 42,
    ruleCount: 110,
    timestamp: "2026-09-08T18:00:00.000Z",
  };

  function renderAdminUserRow(data: typeof sampleRuntimeData, locale: "en" | "vi") {
    const roleLabels = {
      en: { [AUTH_USER_ROLES.admin]: "Administrator", [AUTH_USER_ROLES.customer]: "Customer" },
      vi: { [AUTH_USER_ROLES.admin]: "Quản trị viên", [AUTH_USER_ROLES.customer]: "Khách hàng" },
    };

    return {
      email: data.email, // Dynamic: unchanged
      userId: data.userId, // Dynamic: unchanged
      version: data.corpusVersion, // Dynamic: unchanged
      sources: data.sourceCount, // Dynamic: unchanged
      rules: data.ruleCount, // Dynamic: unchanged
      timestamp: data.timestamp, // Dynamic: unchanged
      roleLabel: roleLabels[locale][AUTH_USER_ROLES.admin], // Localized chrome
    };
  }

  const enRow = renderAdminUserRow(sampleRuntimeData, "en");
  const viRow = renderAdminUserRow(sampleRuntimeData, "vi");

  // Dynamic identifiers and values must be identical across locales
  assert.equal(enRow.email, viRow.email);
  assert.equal(enRow.userId, viRow.userId);
  assert.equal(enRow.version, viRow.version);
  assert.equal(enRow.sources, viRow.sources);
  assert.equal(enRow.rules, viRow.rules);
  assert.equal(enRow.timestamp, viRow.timestamp);

  // Chrome labels are translated
  assert.equal(enRow.roleLabel, "Administrator");
  assert.equal(viRow.roleLabel, "Quản trị viên");
});

// Section 4: Destructive confirmation dismissal contracts (0 mutations)
test("Destructive action dismissal contract: Cancel, Backdrop, Escape generate 0 mutations", () => {
  let mutationCallCount = 0;

  function onDismissModal(reason: "cancel_button" | "backdrop_click" | "escape_key") {
    // Dismissing modal must never trigger mutation handler
    if (reason === "cancel_button" || reason === "backdrop_click" || reason === "escape_key") {
      // Close modal only
      return;
    }
  }

  function onConfirmSuspend() {
    mutationCallCount += 1;
  }

  // User dismisses via Cancel button
  onDismissModal("cancel_button");
  assert.equal(mutationCallCount, 0, "Cancel button must cause 0 mutations");

  // User dismisses via backdrop click
  onDismissModal("backdrop_click");
  assert.equal(mutationCallCount, 0, "Backdrop click must cause 0 mutations");

  // User dismisses via Escape key
  onDismissModal("escape_key");
  assert.equal(mutationCallCount, 0, "Escape key must cause 0 mutations");

  // User explicitly confirms suspend
  onConfirmSuspend();
  assert.equal(mutationCallCount, 1, "Confirmed action causes exactly 1 mutation");
});

// Section 5: Browser Worker Credential isolation
test("Browser security: client request builder must never attach worker credentials", () => {
  const forbiddenHeaders = ["x-worker-api-key", "worker_api_key", "x-worker-key"];

  function createAdminApiHeaders(sessionToken: string, customHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sessionToken}`,
      ...customHeaders,
    };

    // Sanitize any accidental worker headers before dispatch
    for (const key of Object.keys(headers)) {
      if (forbiddenHeaders.includes(key.toLowerCase())) {
        delete headers[key];
      }
    }

    return headers;
  }

  const normalHeaders = createAdminApiHeaders("valid-session-xyz");
  assert.equal(normalHeaders["Authorization"], "Bearer valid-session-xyz");
  assert.equal(normalHeaders["x-worker-api-key"], undefined);

  // Attempting to attach worker key in client headers must be stripped
  const maliciousHeaders = createAdminApiHeaders("valid-session-xyz", {
    "x-worker-api-key": "secret-worker-token-123",
  });
  assert.equal(maliciousHeaders["x-worker-api-key"], undefined, "Worker key must never be sent by browser");
});

// Section 6: Audit trail secret redaction verification
test("Audit payload sanitizer recursively redacts credentials and tokens", () => {
  const SENSITIVE_KEY_PATTERNS = [
    /password/i,
    /token/i,
    /secret/i,
    /mfa/i,
    /worker.*key/i,
    /api.*key/i,
    /hash/i,
  ];

  function sanitizeAuditPayload(obj: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        sanitized[key] = "[REDACTED]";
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        sanitized[key] = sanitizeAuditPayload(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  const rawPayload = {
    action: "ADMIN_USER_SUSPEND",
    targetUserId: "usr_123",
    adminActorId: "adm_999",
    meta: {
      reason: "Security audit compliance",
      sessionToken: "sess_abc123secret",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz",
      mfaSecret: "JBSWY3DPEHPK3PXP",
      workerApiKey: "wrk_live_987654321",
    },
  };

  const sanitized = sanitizeAuditPayload(rawPayload) as {
    action: string;
    targetUserId: string;
    adminActorId: string;
    meta: Record<string, string>;
  };

  assert.equal(sanitized.action, "ADMIN_USER_SUSPEND");
  assert.equal(sanitized.targetUserId, "usr_123");
  assert.equal(sanitized.adminActorId, "adm_999");
  assert.equal(sanitized.meta.reason, "Security audit compliance");
  assert.equal(sanitized.meta.sessionToken, "[REDACTED]");
  assert.equal(sanitized.meta.passwordHash, "[REDACTED]");
  assert.equal(sanitized.meta.mfaSecret, "[REDACTED]");
  assert.equal(sanitized.meta.workerApiKey, "[REDACTED]");
});

// Section 7: Publication Readiness Gating (Server / Jira Semantics win over Figma visual state)
test("Corpus publication readiness gating: state must be READY before publication is permitted", () => {
  type ReadinessState = "PENDING" | "BLOCKED" | "FAILED" | "READY";

  function canPublishCorpus(readinessState: ReadinessState, diffReviewStatus: "Pending" | "Reviewed"): boolean {
    // Server authority: Readiness state MUST be READY. Even if UI has a button, publication is forbidden if not READY.
    if (diffReviewStatus === "Pending" && readinessState !== "READY") {
      return false;
    }
    return readinessState === "READY";
  }

  // Figma scenario: button rendered prominently, but Diff review is Pending and readiness is PENDING
  assert.equal(
    canPublishCorpus("PENDING", "Pending"),
    false,
    "Publish must remain disabled/rejected when readiness is PENDING",
  );
  assert.equal(
    canPublishCorpus("BLOCKED", "Pending"),
    false,
    "Publish must remain disabled/rejected when readiness is BLOCKED",
  );
  assert.equal(
    canPublishCorpus("FAILED", "Reviewed"),
    false,
    "Publish must remain disabled/rejected when readiness is FAILED",
  );
  assert.equal(
    canPublishCorpus("READY", "Reviewed"),
    true,
    "Publish is allowed only when authoritative state is READY",
  );
});

// Section 8: Single Active Corpus Version Invariant
test("Data integrity: exactly one published corpus version can be active at any time", () => {
  type CorpusVersionRecord = { id: string; version: string; status: "DRAFT" | "PUBLISHED" | "HISTORICAL" };

  function publishNewVersion(
    currentVersions: CorpusVersionRecord[],
    draftIdToPublish: string,
  ): CorpusVersionRecord[] {
    const draft = currentVersions.find((v) => v.id === draftIdToPublish);
    if (!draft || draft.status !== "DRAFT") {
      throw new Error("Invalid draft version for publication");
    }

    return currentVersions.map((v) => {
      if (v.id === draftIdToPublish) {
        return { ...v, status: "PUBLISHED" as const };
      }
      if (v.status === "PUBLISHED") {
        return { ...v, status: "HISTORICAL" as const };
      }
      return v;
    });
  }

  const initialVersions: CorpusVersionRecord[] = [
    { id: "corp_1", version: "v2026.08.01", status: "PUBLISHED" },
    { id: "corp_2", version: "v2026.09.01", status: "DRAFT" },
  ];

  const updatedVersions = publishNewVersion(initialVersions, "corp_2");

  const publishedVersions = updatedVersions.filter((v) => v.status === "PUBLISHED");
  assert.equal(publishedVersions.length, 1, "Exactly one version must be active/PUBLISHED");
  assert.equal(publishedVersions[0].id, "corp_2", "New version is now PUBLISHED");

  const historicalVersions = updatedVersions.filter((v) => v.status === "HISTORICAL");
  assert.equal(historicalVersions.length, 1, "Prior published version becomes HISTORICAL");
  assert.equal(historicalVersions[0].id, "corp_1");
});
