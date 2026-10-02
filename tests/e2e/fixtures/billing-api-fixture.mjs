import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const fixture = JSON.parse(
  await readFile(
    new URL("./billing-release-gate.json", import.meta.url),
    "utf8",
  ),
);

const accounts = new Map();
const PORT = Number(process.env.BILLING_E2E_API_PORT ?? 3102);

function readAccount(token) {
  if (!accounts.has(token)) {
    accounts.set(token, {
      wallet: structuredClone(fixture.wallet),
      orders: [],
      idempotency: new Map(),
    });
  }
  return accounts.get(token);
}

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function success(response, data, status = 200) {
  send(response, status, { ok: true, data });
}

function problem(response, status, code) {
  send(response, status, {
    ok: false,
    problem: {
      type: "about:blank",
      status,
      code,
      titleKey: "problems.requestFailed.title",
      detailKey: "problems.requestFailed.detail",
      requiredAction: null,
      correlationId: "billing-release-gate-fixture",
      meta: {},
    },
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getToken(request) {
  return request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
}

function getRole(token) {
  if (token === "billing-e2e-admin" || token === "billing-e2e-admin-error") {
    return "ADMIN";
  }
  if (token === "billing-e2e-customer") return "CUSTOMER";
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const token = getToken(request);
  const role = getRole(token);

  if (request.method === "GET" && url.pathname === "/health") {
    return send(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/auth/profile") {
    if (!role) return problem(response, 401, "AUTH_REQUIRED");
    return success(
      response,
      role === "ADMIN" ? fixture.profiles.admin : fixture.profiles.customer,
    );
  }

  if (request.method === "GET" && url.pathname === "/auth/sessions") {
    if (!role) return problem(response, 401, "AUTH_REQUIRED");
    return success(response, { sessions: [] });
  }

  if (request.method === "GET" && url.pathname === "/provider-credentials") {
    if (!role) return problem(response, 401, "AUTH_REQUIRED");
    return success(response, []);
  }

  if (request.method === "GET" && url.pathname === "/admin/billing/export") {
    if (role !== "ADMIN") return problem(response, 403, "RBAC_DENIED");
    if (token === "billing-e2e-admin-error") {
      return problem(response, 503, "BILLING_REPORT_UNAVAILABLE");
    }
    const status = url.searchParams.get("status") ?? "ALL";
    const gateway = url.searchParams.get("gateway") ?? "ALL";
    const items = fixture.adminBilling.items.filter(
      (item) =>
        (status === "ALL" || item.reconciliationStatus === status) &&
        (gateway === "ALL" || item.provider === gateway),
    );
    return success(response, {
      period: normalizePeriod(url.searchParams.get("period")),
      items,
    });
  }

  if (request.method === "GET" && url.pathname === "/admin/billing") {
    if (role !== "ADMIN") return problem(response, 403, "RBAC_DENIED");
    if (token === "billing-e2e-admin-error") {
      return problem(response, 503, "BILLING_REPORT_UNAVAILABLE");
    }
    const status = url.searchParams.get("status") ?? "ALL";
    const gateway = url.searchParams.get("gateway") ?? "ALL";
    const page = positiveInteger(url.searchParams.get("page"), 1);
    const pageSize = Math.min(
      positiveInteger(url.searchParams.get("pageSize"), 20),
      100,
    );
    const filtered = fixture.adminBilling.items.filter(
      (item) =>
        (status === "ALL" || item.reconciliationStatus === status) &&
        (gateway === "ALL" || item.provider === gateway),
    );
    const start = (page - 1) * pageSize;
    return success(response, {
      ...fixture.adminBilling,
      period: normalizePeriod(url.searchParams.get("period")),
      items: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      totalCount: filtered.length,
    });
  }

  if (request.method === "GET" && url.pathname === "/billing/wallet") {
    if (!role) return problem(response, 401, "AUTH_REQUIRED");
    return success(response, readAccount(token).wallet);
  }

  if (request.method === "GET" && url.pathname === "/billing/estimate") {
    if (role !== "CUSTOMER") return problem(response, 403, "RBAC_DENIED");
    const amountVnd =
      url.searchParams.get("amount_vnd") ?? fixture.estimate.amountVnd;
    return success(response, {
      ...fixture.estimate,
      amountVnd,
      creditUnits: amountVnd,
    });
  }

  if (request.method === "GET" && url.pathname === "/billing/history") {
    if (role !== "CUSTOMER") return problem(response, 403, "RBAC_DENIED");
    const page = positiveInteger(url.searchParams.get("page"), 1);
    const pageSize = Math.min(
      positiveInteger(url.searchParams.get("page_size"), 20),
      100,
    );
    const account = readAccount(token);
    const start = (page - 1) * pageSize;
    return success(response, {
      orders: account.orders.slice(start, start + pageSize),
      page,
      pageSize,
      totalCount: account.orders.length,
    });
  }

  if (request.method === "POST" && url.pathname === "/billing/orders") {
    if (role !== "CUSTOMER") return problem(response, 403, "RBAC_DENIED");
    const account = readAccount(token);
    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey)
      return problem(response, 400, "IDEMPOTENCY_KEY_REQUIRED");
    if (account.idempotency.has(idempotencyKey)) {
      return success(response, account.idempotency.get(idempotencyKey));
    }
    const input = await readJson(request);
    const orderNumber = account.orders.length + 1;
    const paymentCode = `LCSP-E2E-${orderNumber}`;
    const amountVnd = String(input.amount_vnd);
    const order = {
      ...fixture.orderPrototype,
      id: `billing-order-e2e-${orderNumber}`,
      amountVnd,
      creditUnits: amountVnd,
      paymentCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentInstructions: {
        ...fixture.orderPrototype.paymentInstructions,
        paymentCode,
        amountVnd,
        transferContent: paymentCode,
      },
    };
    account.orders.unshift(order);
    account.idempotency.set(idempotencyKey, order);
    return success(response, order, 201);
  }

  const orderMatch = url.pathname.match(/^\/billing\/orders\/([^/]+)$/);
  if (request.method === "GET" && orderMatch) {
    if (role !== "CUSTOMER") return problem(response, 403, "RBAC_DENIED");
    const order = readAccount(token).orders.find(
      (item) => item.id === orderMatch[1],
    );
    return order
      ? success(response, order)
      : problem(response, 404, "BILLING_ORDER_NOT_FOUND");
  }

  if (request.method === "POST" && url.pathname === "/__test__/settle") {
    if (token !== "billing-e2e-customer")
      return problem(response, 403, "RBAC_DENIED");
    const { orderId } = await readJson(request);
    const account = readAccount(token);
    const order = account.orders.find((item) => item.id === orderId);
    if (!order) return problem(response, 404, "BILLING_ORDER_NOT_FOUND");
    if (order.status !== "CREDITED") {
      order.status = "CREDITED";
      order.creditedAt = new Date().toISOString();
      order.updatedAt = order.creditedAt;
      account.wallet.availableCredits = (
        BigInt(account.wallet.availableCredits) + BigInt(order.creditUnits)
      ).toString();
      account.wallet.totalCredits = account.wallet.availableCredits;
      account.wallet.version += 1;
    }
    return success(response, { orderId: order.id, status: order.status });
  }

  if (request.method === "POST" && url.pathname === "/__test__/reset") {
    if (role !== "CUSTOMER") return problem(response, 403, "RBAC_DENIED");
    accounts.delete(token);
    return success(response, { reset: true });
  }

  return problem(response, 404, "NOT_FOUND");
});

server.listen(PORT, "127.0.0.1");

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePeriod(period) {
  return ["MTD", "7D", "30D", "90D"].includes(period) ? period : "MTD";
}
