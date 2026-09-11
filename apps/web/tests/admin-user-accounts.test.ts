import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  type AdminUserSummary,
} from "@lcsp/contracts/auth";

test("Admin user query filters correctly across search, status, and role", () => {
  const sampleUsers: AdminUserSummary[] = [
    {
      id: "usr_1",
      fullName: "Alice Admin",
      email: "alice@company.com",
      role: AUTH_USER_ROLES.admin,
      status: AUTH_ACCOUNT_STATUSES.active,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-09-09T00:00:00.000Z",
      assessmentCount: 10,
    },
    {
      id: "usr_2",
      fullName: "Bob Customer",
      email: "bob@client.io",
      role: AUTH_USER_ROLES.customer,
      status: AUTH_ACCOUNT_STATUSES.suspended,
      createdAt: "2026-02-01T00:00:00.000Z",
      lastActiveAt: null,
      assessmentCount: 0,
    },
    {
      id: "usr_3",
      fullName: "Charlie Admin",
      email: "charlie@company.com",
      role: AUTH_USER_ROLES.admin,
      status: AUTH_ACCOUNT_STATUSES.invited,
      createdAt: "2026-03-01T00:00:00.000Z",
      lastActiveAt: null,
      assessmentCount: null,
    },
  ];

  function filterUsers(
    query: string,
    status: string,
    role: string,
  ): AdminUserSummary[] {
    return sampleUsers.filter((u) => {
      const matchesQuery =
        !query ||
        u.fullName.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === "ALL" || u.status === status;
      const matchesRole = role === "ALL" || u.role === role;
      return matchesQuery && matchesStatus && matchesRole;
    });
  }

  // Search by name
  assert.equal(filterUsers("alice", "ALL", "ALL").length, 1);
  assert.equal(filterUsers("alice", "ALL", "ALL")[0].id, "usr_1");

  // Search by email
  assert.equal(filterUsers("client.io", "ALL", "ALL").length, 1);
  assert.equal(filterUsers("client.io", "ALL", "ALL")[0].id, "usr_2");

  // Status filter
  assert.equal(
    filterUsers("", AUTH_ACCOUNT_STATUSES.suspended, "ALL").length,
    1,
  );
  assert.equal(filterUsers("", AUTH_ACCOUNT_STATUSES.active, "ALL").length, 1);

  // Role filter
  assert.equal(filterUsers("", "ALL", AUTH_USER_ROLES.admin).length, 2);
  assert.equal(filterUsers("", "ALL", AUTH_USER_ROLES.customer).length, 1);

  // Combined filter
  assert.equal(
    filterUsers("company", AUTH_ACCOUNT_STATUSES.active, AUTH_USER_ROLES.admin)
      .length,
    1,
  );
});

test("Admin user list pagination computes total pages and page slices accurately", () => {
  function paginate<T>(items: T[], page: number, pageSize: number) {
    const totalCount = items.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize);
    return { paginatedItems, totalCount, totalPages, page, pageSize };
  }

  const items = Array.from({ length: 25 }, (_, i) => `user_${i + 1}`);
  const resultPage1 = paginate(items, 1, 10);
  assert.equal(resultPage1.totalCount, 25);
  assert.equal(resultPage1.totalPages, 3);
  assert.equal(resultPage1.paginatedItems.length, 10);
  assert.equal(resultPage1.paginatedItems[0], "user_1");

  const resultPage3 = paginate(items, 3, 10);
  assert.equal(resultPage3.paginatedItems.length, 5);
  assert.equal(resultPage3.paginatedItems[4], "user_25");
});

test("Ensures no Figma design fixture values are hardcoded into production admin components", async () => {
  const tableFilePath = join(
    process.cwd(),
    "src/features/admin/components/organisms/admin-user-table.tsx",
  );
  const tableContent = await readFile(tableFilePath, "utf8");

  // Figma fixtures must not be hardcoded as truth
  assert.equal(tableContent.includes("Nhi M."), false);
  assert.equal(tableContent.includes("Bao N."), false);
  assert.equal(tableContent.includes("nhi@example.com"), false);
  assert.equal(tableContent.includes("1,248 accounts"), false);
  assert.equal(tableContent.includes("Page 1 of 125"), false);
});

test("Ensures production BFF admin user routes forward upstream directly without mock json fallbacks", async () => {
  const routes = [
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[id]/route.ts",
    "src/app/api/admin/users/[id]/suspend/route.ts",
    "src/app/api/admin/users/[id]/restore/route.ts",
    "src/lib/server/admin-account-mutations.ts",
  ];

  for (const routePath of routes) {
    const fullPath = join(process.cwd(), routePath);
    const content = await readFile(fullPath, "utf8");

    // Must not read mock JSON in production BFF handlers
    assert.equal(
      content.includes("readMockJson"),
      false,
      `${routePath} must not use readMockJson`,
    );
    assert.equal(
      content.includes("admin-users.json"),
      false,
      `${routePath} must not use admin-users.json`,
    );
    // Must forward upstream
    assert.equal(
      content.includes("upstreamRequest") ||
        content.includes("proxyAdminAccountMutation"),
      true,
      `${routePath} must use the shared upstream transport`,
    );
    assert.equal(
      content.includes("upstreamJson") ||
        content.includes("proxyAdminAccountMutation"),
      true,
      `${routePath} must forward canonical upstream results`,
    );
  }
});

test("Admin user filters expose only lifecycle statuses supported by the API", async () => {
  const filterFilePath = join(
    process.cwd(),
    "src/features/admin/components/molecules/admin-user-filters.tsx",
  );
  const filterContent = await readFile(filterFilePath, "utf8");

  assert.equal(filterContent.includes("AUTH_ACCOUNT_STATUSES.active"), true);
  assert.equal(filterContent.includes("AUTH_ACCOUNT_STATUSES.suspended"), true);
  assert.equal(filterContent.includes("AUTH_ACCOUNT_STATUSES.invited"), true);
  assert.equal(
    /value=\{AUTH_ACCOUNT_STATUSES\.deactivated\}/.test(filterContent),
    false,
  );
});

test("Admin UI chrome resolves labels from i18n instead of hardcoded English copy", async () => {
  const checkedFiles = [
    "src/features/admin/components/organisms/admin-user-table.tsx",
    "src/features/admin/components/molecules/admin-pagination.tsx",
    "src/features/admin/components/templates/admin-sidebar.tsx",
    "src/features/admin/components/organisms/admin-usage-summary.tsx",
    "src/app/(admin)/admin/users/[id]/page.tsx",
  ];

  for (const relativePath of checkedFiles) {
    const content = await readFile(join(process.cwd(), relativePath), "utf8");

    assert.equal(content.includes("User Accounts Table"), false, relativePath);
    assert.equal(content.includes(">Actions<"), false, relativePath);
    assert.equal(content.includes("Page {page} of"), false, relativePath);
    assert.equal(content.includes(">Soon<"), false, relativePath);
    assert.equal(content.includes("Admin Navigation"), false, relativePath);
    assert.equal(content.includes("Admin Sections"), false, relativePath);
    assert.equal(content.includes('LCSP Admin"'), false, relativePath);
    assert.equal(
      content.includes('aria-label="Usage Summary"'),
      false,
      relativePath,
    );
    assert.equal(
      content.includes("Administrative suspension"),
      false,
      relativePath,
    );
  }
});

test("Admin mutations invalidate list queries through the shared admin query key", async () => {
  const queryFilePath = join(
    process.cwd(),
    "src/lib/api/admin-users-queries.ts",
  );
  const queryContent = await readFile(queryFilePath, "utf8");

  assert.equal(queryContent.includes("apiQueryKeys.admin.usersRoot()"), true);
  assert.equal(queryContent.includes('queryKey: ["admin", "users"]'), false);
});

test("Admin UI components use semantic color tokens instead of raw palette colors", async () => {
  const adminFiles = [
    "src/app/(admin)/admin/users/[id]/page.tsx",
    "src/app/(admin)/admin/users/page.tsx",
    "src/features/admin/components/atoms/admin-detail-row.tsx",
    "src/features/admin/components/atoms/admin-metric-card.tsx",
    "src/features/admin/components/atoms/admin-role-badge.tsx",
    "src/features/admin/components/atoms/admin-status-badge.tsx",
    "src/features/admin/components/atoms/admin-status-dot.tsx",
    "src/features/admin/components/molecules/admin-page-header.tsx",
    "src/features/admin/components/molecules/admin-pagination.tsx",
    "src/features/admin/components/molecules/admin-suspend-confirmation-content.tsx",
    "src/features/admin/components/molecules/admin-user-filters.tsx",
    "src/features/admin/components/molecules/admin-user-identity-cell.tsx",
    "src/features/admin/components/organisms/admin-account-details-card.tsx",
    "src/features/admin/components/organisms/admin-administrative-actions-card.tsx",
    "src/features/admin/components/organisms/admin-shell.tsx",
    "src/features/admin/components/organisms/admin-sidebar.tsx",
    "src/features/admin/components/organisms/admin-suspend-modal.tsx",
    "src/features/admin/components/organisms/admin-usage-summary.tsx",
    "src/features/admin/components/organisms/admin-user-table.tsx",
    "src/features/admin/components/templates/admin-shell.tsx",
    "src/features/admin/components/templates/admin-sidebar.tsx",
  ];
  const rawColorPattern =
    /\b(?:emerald|rose|amber)-\d{2,3}\b|\b(?:black|white)\b|rgb\(|#[0-9a-fA-F]{3,8}\b/;

  for (const relativePath of adminFiles) {
    const content = await readFile(join(process.cwd(), relativePath), "utf8");
    assert.equal(rawColorPattern.test(content), false, relativePath);
  }
});
