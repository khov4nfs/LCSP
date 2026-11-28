import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { PROVIDER_CREDENTIAL_STATUSES } from "@lcsp/contracts/github-integration";

import { readMockJson } from "./response";
import type {
  UpstreamBinaryResult,
  UpstreamRequestInit,
  UpstreamRequestResult,
} from "../upstream-request";

/**
 * Business purpose: Supply deterministic upstream responses for explicitly enabled mock sessions.
 * Business rules:
 * - The caller must gate fixture dispatch on mock mode; these responses do not prove live state.
 * - Use canonical account, audit and provider credential values for their respective payloads.
 * Execution flow:
 * 1. Match the upstream path and select its fixture projection, including the mock actor role.
 * 2. Return a success envelope for a matching fixture or null for an unhandled path.
 * Failure cases:
 * - Missing or invalid JSON fixtures reject the request; unhandled paths remain available to upstream fetch.
 * Side effects:
 * - Read-only fixture loading; no accounts, sessions or other backend state are changed.
 */
export async function getMockUpstreamResponse(
  path: string | URL,
  init: UpstreamRequestInit = {},
): Promise<UpstreamRequestResult | null> {
  const pathStr = typeof path === "string" ? path : path.pathname + path.search;
  const pathname =
    typeof path === "string" ? path.split("?")[0] : path.pathname;

  // 1. Auth Profile
  if (pathname === "/auth/profile") {
    const bearer = init.bearerToken ?? "";
    const isAdmin = bearer.includes("admin");
    const profile = {
      user_id: isAdmin ? "usr_admin_mock" : "usr_customer_mock",
      email: isAdmin ? "admin@example.com" : "customer@example.com",
      email_verified: true,
      display_name: isAdmin ? "System Administrator" : "Phan Nguyen Quoc Minh",
      recovery_email: "minhpnq1807@gmail.com",
      primary_email_address_policy: "ACCOUNT_EMAIL",
      backup_recovery_email_policy: "RECOVERY_EMAIL",
      created_at: "2026-01-01T08:00:00.000Z",
      updated_at: "2026-09-01T20:00:00.000Z",
      role: isAdmin ? "ADMIN" : "CUSTOMER",
      mfa_enrolled: true,
      mfa_enrolled_at: "2026-01-01T08:00:00.000Z",
      mfa_verified: true,
      mfa_verified_at: "2026-01-01T08:00:00.000Z",
      current_session_id: "mock-session-id",
      current_session_created_at: "2026-09-01T08:00:00.000Z",
      current_session_updated_at: "2026-09-01T08:00:00.000Z",
      current_session_expires_at: "2026-12-31T20:00:00.000Z",
    };
    return okResult(profile);
  }

  // 2. Admin Overview
  if (pathname === "/admin/overview") {
    const overviewData = {
      period: "30D",
      periodDays: 30,
      summary: {
        totalUsers: { count: 876, periodChange: 38 },
        activeUsers: { count: 842, percentageOfTotal: 96.1 },
        assessments: { totalCount: 2417, periodCompletedCount: 312 },
        currentLegalSource: {
          version: "v2026.08.31",
          sourceCount: 184,
          ruleCount: null,
        },
      },
      assessmentActivity: {
        points: [
          {
            date: "2026-08-20",
            timestamp: "2026-08-20T00:00:00.000Z",
            startedCount: 12,
            completedCount: 10,
          },
          {
            date: "2026-09-02",
            timestamp: "2026-09-02T00:00:00.000Z",
            startedCount: 24,
            completedCount: 18,
          },
        ],
        totalStarted: 36,
        totalCompleted: 312,
        startDate: "2026-08-20T00:00:00.000Z",
        endDate: "2026-09-02T00:00:00.000Z",
      },
      accountDistribution: {
        activeCount: 842,
        invitedCount: 64,
        suspendedCount: 34,
        deactivatedCount: 0,
        totalCount: 940,
      },
      recentActivity: [
        {
          id: "evt-1",
          eventType: AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended,
          actionKey: "pages.admin.overview.recentActivity.suspendedAccount",
          occurredAt: "2026-09-11T10:24:00.000Z",
          adminEmail: "admin@example.com",
          adminName: "Admin",
          target: "linh@example.com",
        },
        {
          id: "evt-2",
          eventType: "LEGAL_SOURCE_VERSION_ACTIVATED",
          actionKey: "pages.admin.overview.recentActivity.activatedLegalSource",
          occurredAt: "2026-09-11T09:05:00.000Z",
          adminEmail: "admin@example.com",
          adminName: "Admin",
          target: "v2026.08.31",
        },
      ],
      legalSourceStatus: {
        current: {
          version: "v2026.08.31",
          sourceCount: 184,
          ruleCount: null,
          activatedAt: "2026-08-31T00:00:00.000Z",
        },
        draft: {
          version: "v2026.09.02-draft",
          sourceCount: 188,
          ruleCount: null,
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      },
    };
    return okResult(overviewData);
  }

  // 3. Admin Users
  if (pathname === "/admin/users") {
    const usersData = {
      totalCount: 3,
      totalPages: 1,
      users: [
        {
          id: "usr_1",
          fullName: "Alice Admin",
          email: "alice@company.com",
          role: "ADMIN",
          status: AUTH_ACCOUNT_STATUSES.active,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-09-09T00:00:00.000Z",
          assessmentCount: 10,
        },
        {
          id: "usr_2",
          fullName: "Bob Customer",
          email: "bob@client.io",
          role: "CUSTOMER",
          status: AUTH_ACCOUNT_STATUSES.active,
          createdAt: "2026-02-01T00:00:00.000Z",
          lastActiveAt: "2026-11-10T00:00:00.000Z",
          assessmentCount: 3,
        },
        {
          id: "usr_3",
          fullName: "Lifecycle Test User",
          email: "lcsp299@example.com",
          role: "CUSTOMER",
          status: AUTH_ACCOUNT_STATUSES.active,
          createdAt: "2026-09-01T00:00:00.000Z",
          lastActiveAt: null,
          assessmentCount: 0,
        },
      ],
    };
    return okResult(usersData);
  }

  if (pathname.startsWith("/admin/users/")) {
    const userDetail = await readMockJson("account-lifecycle.json");
    return okResult(userDetail);
  }

  // Why: The Admin case UI needs a deterministic local read-only fixture for browser inspection.
  // How: Expose only an Admin mock actor's queue and exact case detail from one JSON asset.
  // Invariant: Mock data is never a real provider receipt and never authorizes a decision or debit.
  if (
    pathname.startsWith("/admin/billing/reconciliation/cases") &&
    init.bearerToken?.includes("admin")
  ) {
    const mock = await readMockJson<{
      items: unknown[];
      detail: { caseId: string } & Record<string, unknown>;
    }>("admin-model-reconciliation.json");
    const base = "/admin/billing/reconciliation/cases";
    if (pathname === base) {
      const params = new URLSearchParams(pathStr.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      const pageSize = Number(params.get("pageSize") ?? "20");
      return okResult({
        items: page === 1 ? mock.items.slice(0, pageSize) : [],
        total: mock.items.length,
        page,
        pageSize,
      });
    }
    if (pathname === `${base}/${mock.detail.caseId}`) {
      return okResult(mock.detail);
    }
  }

  // 4. Admin Model Pricing (Read-Only Overview)
  // Why: Enables deterministic local mock-mode inspection of /admin/pricing without live backend settlement cutover.
  // How: Reads the schema-validated fixture asset and applies optional query filters identically to the backend overview query.
  // Invariants: Keeps debitMode=OFF and never exposes mutation handlers in mock mode.
  if (pathname === "/admin/billing/model-pricing") {
    const mockPricing = await readMockJson<{
      debitMode: string;
      dbUtcNow: string;
      allowlistedModels: Array<{
        role: string;
        routeKey: string;
        provider: string;
        resolvedModel: string;
      }>;
      coverage: Array<{
        provider: string;
        resolvedModel: string;
        normalizedScopeKey: string;
        hasCoverage: boolean;
        resolvedScope: string | null;
        fallbackSource: string | null;
        assignmentId: string | null;
        snapshotId: string | null;
        snapshotVersion: number | null;
        effectiveFrom: string | null;
        effectiveTo: string | null;
        rates: unknown;
      }>;
      assignments: Array<{
        id: string;
        tariffSnapshotId: string;
        scope: string;
        normalizedScopeKey: string;
        status: string;
        version: number;
        effectiveFrom: string;
        effectiveTo: string | null;
        supersededByAssignmentId: string | null;
        supersededBy: string | null;
        supersededAt: string | null;
        cancelledAt: string | null;
        auditReason: string | null;
        createdBy: string;
        createdAt: string;
      }>;
      drafts: Array<{
        id: string;
        scope: string;
        provider: string | null;
        resolvedModel: string | null;
        normalizedScopeKey: string;
        [key: string]: unknown;
      }>;
      snapshots: Array<{
        id: string;
        scope: string;
        provider: string | null;
        resolvedModel: string | null;
        normalizedScopeKey: string;
        [key: string]: unknown;
      }>;
    }>("admin-model-pricing.json");

    const queryIndex = pathStr.indexOf("?");
    const params =
      queryIndex >= 0
        ? new URLSearchParams(pathStr.slice(queryIndex + 1))
        : new URLSearchParams();
    const provider = params.get("provider")?.trim().toLowerCase() ?? "";
    const resolvedModel =
      params.get("resolvedModel")?.trim().toLowerCase() ?? "";
    const scope = params.get("scope")?.trim() ?? "";
    const status = params.get("status")?.trim() ?? "";

    const matchesScopeKey = (
      normalizedScopeKey: string,
      rowProvider?: string | null,
      rowModel?: string | null,
    ) => {
      const p = (rowProvider ?? "").toLowerCase();
      const m = (rowModel ?? "").toLowerCase();
      const key = normalizedScopeKey.toLowerCase();
      const providerOk =
        !provider || p.includes(provider) || key.includes(provider);
      const modelOk =
        !resolvedModel ||
        m.includes(resolvedModel) ||
        key.includes(resolvedModel);
      return providerOk && modelOk;
    };

    const filteredCoverage = mockPricing.coverage.filter((row) => {
      if (provider && !row.provider.toLowerCase().includes(provider))
        return false;
      if (
        resolvedModel &&
        !row.resolvedModel.toLowerCase().includes(resolvedModel)
      )
        return false;
      if (scope && (row.fallbackSource ?? row.resolvedScope) !== scope)
        return false;
      return true;
    });

    const filteredAssignments = mockPricing.assignments.filter((item) => {
      if (scope && item.scope !== scope) return false;
      if (status && item.status !== status) return false;
      return matchesScopeKey(item.normalizedScopeKey);
    });

    const filteredDrafts = mockPricing.drafts.filter((draft) => {
      if (scope && draft.scope !== scope) return false;
      return matchesScopeKey(
        draft.normalizedScopeKey,
        draft.provider,
        draft.resolvedModel,
      );
    });

    const filteredSnapshots = mockPricing.snapshots.filter((snapshot) => {
      if (scope && snapshot.scope !== scope) return false;
      return matchesScopeKey(
        snapshot.normalizedScopeKey,
        snapshot.provider,
        snapshot.resolvedModel,
      );
    });

    return okResult({
      ...mockPricing,
      coverage: filteredCoverage,
      assignments: filteredAssignments,
      drafts: filteredDrafts,
      snapshots: filteredSnapshots,
    });
  }

  // 4. Admin Billing
  if (pathname === "/admin/billing") {
    const billingData = {
      period: "30D",
      summary: {
        settledTopUpVnd: "150000000",
        pendingReconciliationCount: 2,
        duplicatePaymentCount: 0,
        settledTopUpTrend: [
          { day: "2026-11-12", amountVnd: "20000000" },
          { day: "2026-11-13", amountVnd: "25000000" },
          { day: "2026-11-14", amountVnd: "15000000" },
          { day: "2026-11-15", amountVnd: "30000000" },
          { day: "2026-11-16", amountVnd: "10000000" },
          { day: "2026-11-17", amountVnd: "35000000" },
          { day: "2026-11-18", amountVnd: "15000000" },
        ],
      },
      items: [
        {
          id: "pay_1",
          provider: "SEPAY",
          providerTransactionId: "tx_sepay_001",
          amountVnd: "5000000",
          reconciliationStatus: "MATCHED",
          reconciliationReason: null,
          receivedAt: "2026-11-15T10:30:00.000Z",
          reconciledAt: "2026-11-15T10:31:00.000Z",
          account: {
            userId: "usr_2",
            email: "bob@client.io",
            displayName: "Bob Customer",
          },
          order: {
            id: "ord_101",
            paymentCode: "LCSP-101",
            status: "CREDITED",
            creditUnits: "500",
          },
        },
        {
          id: "pay_2",
          provider: "VNPAY",
          providerTransactionId: "tx_vnpay_002",
          amountVnd: "2500000",
          reconciliationStatus: "MATCHED",
          reconciliationReason: null,
          receivedAt: "2026-11-14T08:20:00.000Z",
          reconciledAt: "2026-11-14T08:22:00.000Z",
          account: {
            userId: "usr_1",
            email: "alice@company.com",
            displayName: "Alice Admin",
          },
          order: {
            id: "ord_102",
            paymentCode: "LCSP-102",
            status: "CREDITED",
            creditUnits: "250",
          },
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 2,
    };
    return okResult(billingData);
  }

  // 5. Admin Legal Sources
  if (pathname === "/admin/legal-sources") {
    const legalSourceMock = await readMockJson<{
      list: { items: unknown[] };
    }>("legal-source-management.json");
    return okResult(legalSourceMock.list);
  }

  if (pathname.startsWith("/admin/legal-sources/")) {
    const legalSourceMock = await readMockJson<{ source: unknown }>(
      "legal-source-management.json",
    );
    return okResult(legalSourceMock.source);
  }

  // 6. Admin Compliance Rule Sets
  if (pathname === "/admin/compliance-rule-sets") {
    const prep = await readMockJson<{
      clean: { preparation: unknown };
      activeRuleSet: unknown;
    }>("admin-rule-set-preparation.json");
    return okResult({
      preparation: prep.clean.preparation,
      ruleSets: [prep.activeRuleSet],
      preparations: [],
    });
  }

  if (pathname === "/admin/compliance-rule-sets/groups/pending") {
    return okResult({ versions: [] });
  }

  if (pathname.includes("/groups/proposal")) {
    return okResult({
      ruleSetVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ruleSetDigest: "a".repeat(64),
      state: "REVIEW_REQUIRED",
      entries: [],
    });
  }

  if (pathname.includes("/groups")) {
    return okResult({
      localization: { ready: 5, pending: 0, failed: 0 },
      memberships: [],
      membershipDigest: "a".repeat(64),
    });
  }

  if (pathname.startsWith("/admin/compliance-rule-sets/")) {
    const mock = await readMockJson("admin-compliance-rule-set-result.json");
    return okResult(mock);
  }

  if (pathname.startsWith("/admin/legal-rule-catalog")) {
    const cat = await readMockJson<{
      catalog: {
        id: string;
        version: string;
        revision: number;
        legalSourceVersionId: string;
      };
      rules: unknown[];
    }>("legal-rule-catalog.json");
    if (pathname.includes("/rules")) {
      return okResult({
        catalogVersionId: cat.catalog.id,
        catalogVersion: cat.catalog.version,
        catalogRevision: cat.catalog.revision,
        legalSourceVersionId: cat.catalog.legalSourceVersionId,
        total: cat.rules.length,
        eligibleTotal: cat.rules.length,
        page: 1,
        limit: 50,
        items: cat.rules,
      });
    }
    return okResult([cat.catalog]);
  }

  // 7. Admin Tracking
  if (pathname.startsWith("/admin/tracking")) {
    const tracking = await readMockJson("admin-tracking-untrusted.json");
    return okResult(tracking);
  }

  // 8. Admin Usage & Customer Billing Usage
  if (pathname.startsWith("/admin/usage")) {
    const adminUsage = await readMockJson("admin-usage.json");
    return okResult(adminUsage);
  }

  if (pathname === "/billing/usage") {
    const usage = await readMockJson("customer-usage.json");
    return okResult(usage);
  }

  // Admin Localization Backlog & Review
  if (pathname.startsWith("/admin/localization")) {
    const locMock = await readMockJson<{
      backlog: unknown;
      jobs: unknown[];
    }>("localization-pagination.json");
    if (pathname === "/admin/localization") {
      return okResult(locMock.backlog);
    }
    return okResult({
      items: locMock.jobs.slice(0, 20),
      nextAfter: null,
      hasMore: false,
    });
  }

  // 9. Assessments List, Tracking & Detail
  if (pathname.startsWith("/assessments/tracking/overview")) {
    const tracking = await readMockJson<{ overview: unknown }>(
      "customer-tracking.json",
    );
    return okResult(tracking.overview);
  }

  if (pathname.startsWith("/assessments/tracking/obligations")) {
    const tracking = await readMockJson<{ obligations: unknown }>(
      "customer-tracking.json",
    );
    return okResult(tracking.obligations);
  }

  if (pathname.startsWith("/assessments/tracking/reports")) {
    const tracking = await readMockJson<{ reports: unknown }>(
      "customer-tracking.json",
    );
    return okResult(tracking.reports);
  }

  if (pathname === "/assessments") {
    const workspaceMock = await readMockJson<{
      detail: Record<string, unknown>;
    }>("enterprise-legal-compliance-workspace.json");
    const {
      owner_id,
      case: _,
      usage,
      correlationId,
      ...item
    } = workspaceMock.detail;
    return okResult({
      assessments: [item],
      total: 1,
      page: 1,
      page_size: 20,
      correlationId: "mock-correlation-id",
    });
  }

  if (pathname.startsWith("/assessments/")) {
    const workspaceMock = await readMockJson<{
      detail: unknown;
      provenance: unknown;
      events: unknown;
      requests: unknown;
    }>("enterprise-legal-compliance-workspace.json");

    if (pathname.includes("/provenance")) {
      return okResult(workspaceMock.provenance);
    }
    if (pathname.includes("/events")) {
      return okResult(workspaceMock.events);
    }
    if (pathname.includes("/human-requests")) {
      return okResult(workspaceMock.requests);
    }
    if (pathname.includes("/rules")) {
      const catalog = await readMockJson("selected-rule-audit-catalog.json");
      return okResult(catalog);
    }
    if (pathname.includes("/discovery-runs")) {
      return okResult({ available: false, run: null });
    }
    if (pathname.includes("/repository-setup")) {
      return okResult(
        (workspaceMock as Record<string, unknown>).repositorySetup,
      );
    }
    if (pathname.includes("/report")) {
      const wire = await readMockJson<{
        reports: Record<string, unknown>;
      }>("localized-assessment-wire.json");
      return okResult(wire.reports["ASSESSMENT_FINAL_REPORT_V2:en"]);
    }
    return okResult(workspaceMock.detail);
  }

  // 10. Customer Billing Wallet & History
  if (pathname === "/billing/wallet") {
    return okResult({
      walletId: "wal-mock-customer",
      availableCredits: 15000000,
      reservedCredits: 0,
      totalCredits: 15000000,
      version: 1,
    });
  }

  if (pathname === "/billing/history") {
    return okResult({
      orders: [
        {
          id: "ord-mock-1",
          amountVnd: "5000000",
          creditUnits: 5000000,
          paymentCode: "LCSP-MOCK-PAY-1",
          status: "CREDITED",
          expiresAt: "2026-11-20T00:00:00.000Z",
          creditedAt: "2026-11-18T00:00:00.000Z",
          createdAt: "2026-11-17T20:00:00.000Z",
          updatedAt: "2026-11-18T00:00:00.000Z",
          paymentInstructions: {
            provider: "SEPAY",
            currency: "VND",
            paymentCode: "LCSP-MOCK-PAY-1",
            amountVnd: "5000000",
            bankName: "Vietcombank",
            bankAccountNumber: "9876543210",
            accountHolder: "CONG TY LCSP VIET NAM",
            transferContent: "LCSP-MOCK-PAY-1",
            qrCodeUrl: "https://example.com/mock-qr.png",
          },
        },
      ],
      page: 1,
      pageSize: 10,
      totalCount: 1,
    });
  }

  // 11. Sessions
  if (pathname === "/auth/sessions") {
    const sessions = await readMockJson("settings-sessions.json");
    return okResult(sessions);
  }

  // 12. Provider Credentials & GitHub repositories
  if (pathname === "/provider-credentials") {
    return okResult([
      {
        provider: "GITHUB",
        configured: true,
        status: PROVIDER_CREDENTIAL_STATUSES.active,
        account: "enterprise-org",
      },
      {
        provider: "GITLAB",
        configured: false,
        status: null,
        account: null,
      },
      {
        provider: "BITBUCKET",
        configured: false,
        status: null,
        account: null,
      },
      {
        provider: "AZURE_DEVOPS",
        configured: false,
        status: null,
        account: null,
      },
    ]);
  }

  if (pathname.startsWith("/provider-credentials/")) {
    const provider = pathname.split("/").pop();
    return okResult({
      provider,
      configured: false,
      status: null,
      account: null,
    });
  }

  if (pathname.startsWith("/github/repositories")) {
    const repos = await readMockJson("repositories.json");
    return okResult(repos);
  }

  // 13. Legal library
  if (pathname.startsWith("/legal-library")) {
    if (pathname.includes("/chunks")) {
      const legalSourceMock = await readMockJson<{
        chunksPageOne: unknown;
        chunksPageTwo: unknown;
      }>("legal-source-management.json");
      return okResult(
        pathStr.includes("page=2")
          ? legalSourceMock.chunksPageTwo
          : legalSourceMock.chunksPageOne,
      );
    }
    const workspaceMock = await readMockJson<{ library: unknown }>(
      "enterprise-legal-compliance-workspace.json",
    );
    return okResult(workspaceMock.library);
  }

  return null;
}

function okResult(data: unknown): UpstreamRequestResult {
  return {
    result: { ok: true, data },
    data,
    ok: true,
    status: 200,
  };
}

/**
 * Business purpose: Intercept binary download requests in mock mode and return fixture payloads.
 *
 * Business rules:
 * - Return versioned immutable final reports matching request locale for artifact downloads.
 * - Return provenance and export snapshots for assessment export requests.
 *
 * Execution flow:
 * 1. Normalize path string and active locale parameter.
 * 2. Return serialized artifact bytes for matching download endpoints.
 * 3. Return null for unhandled paths to fall back to upstream fetch.
 *
 * Failure cases:
 * - Unmatched paths return null.
 *
 * Side effects:
 * - None: read-only fixture binary generation.
 */
export async function getMockUpstreamBinaryResponse(
  path: string | URL,
  init: UpstreamRequestInit = {},
): Promise<UpstreamBinaryResult | null> {
  const pathStr = typeof path === "string" ? path : path.pathname + path.search;
  const locale = init.locale === "vi" ? "vi" : "en";

  if (pathStr.includes("/artifacts/") && pathStr.includes("/download")) {
    const wire = await readMockJson<{
      reports: Record<string, unknown>;
    }>("localized-assessment-wire.json");
    const reportKey = `ASSESSMENT_FINAL_REPORT_V2:${locale}`;
    const report =
      wire.reports[reportKey] ?? wire.reports["ASSESSMENT_FINAL_REPORT_V2:en"];
    const text = JSON.stringify(report);
    const body = new TextEncoder().encode(text).buffer;
    return {
      body,
      result: null,
      ok: true,
      status: 200,
      contentType: "application/json",
    };
  }

  if (pathStr.includes("/provenance/download")) {
    const workspaceMock = await readMockJson<{ provenance: unknown }>(
      "enterprise-legal-compliance-workspace.json",
    );
    const text = JSON.stringify(workspaceMock.provenance);
    const body = new TextEncoder().encode(text).buffer;
    return {
      body,
      result: null,
      ok: true,
      status: 200,
      contentType: "application/json",
    };
  }

  if (pathStr.includes(".pdf")) {
    const body = new TextEncoder().encode(
      "%PDF-1.4 mock pdf content %%EOF",
    ).buffer;
    return {
      body,
      result: null,
      ok: true,
      status: 200,
      contentType: "application/pdf",
    };
  }

  return null;
}
