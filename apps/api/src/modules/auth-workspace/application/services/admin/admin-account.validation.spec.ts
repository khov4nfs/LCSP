import { describe, expect, it } from "@jest/globals";
import {
  ADMIN_ACCOUNT_OPERATIONS,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import {
  idempotency,
  parseInvitation,
  parseListQuery,
  record,
  version,
} from "./admin-account.validation.js";

describe("LCSP-299 bounded Admin account input", () => {
  it("keeps canonical RBAC/provisioning roles without an existing-user role command", () => {
    expect(Object.values(AUTH_USER_ROLES).sort()).toEqual([
      "ADMIN",
      "CUSTOMER",
    ]);
    expect(Object.values(ADMIN_ACCOUNT_OPERATIONS).sort()).toEqual([
      "INVITE",
      "RESTORE",
      "SUSPEND",
    ]);
    expect(() =>
      record({ expectedVersion: 0, role: AUTH_USER_ROLES.admin }, "test", [
        "expectedVersion",
        "reason",
      ]),
    ).toThrow();
  });
  it("normalizes provisioning identity and accepts only canonical roles", () => {
    expect(
      parseInvitation(
        {
          email: " New@Example.com ",
          displayName: " New User ",
          role: AUTH_USER_ROLES.customer,
        },
        "test",
      ),
    ).toEqual({
      email: "new@example.com",
      displayName: "New User",
      role: AUTH_USER_ROLES.customer,
    });
    expect(() =>
      parseInvitation(
        { email: "ok@example.com", displayName: "User", role: "ROOT" },
        "test",
      ),
    ).toThrow();
  });
  it.each([
    null,
    [],
    "record",
    { role: AUTH_USER_ROLES.admin, password: "forbidden" },
  ])("rejects invalid or extra fields: %p", (value) => {
    expect(() => record(value, "test", ["role"])).toThrow();
  });
  it.each([-1, 1.1, "0", NaN, Infinity, undefined])(
    "requires a nonnegative safe integer version: %p",
    (value) => {
      expect(() => version(value, "test")).toThrow();
    },
  );
  it("accepts version zero and a bounded idempotency key", () => {
    expect(version(0, "test")).toBe(0);
    expect(idempotency("retry-299:1", "test")).toBe("retry-299:1");
  });
  it.each([undefined, "", "x".repeat(129), "bad key"])(
    "requires a bounded idempotency key: %p",
    (value) => {
      expect(() => idempotency(value, "test")).toThrow();
    },
  );
  it("accepts canonical query aliases and bounds", () => {
    expect(
      parseListQuery(
        {
          q: "  Alice  ",
          role: AUTH_USER_ROLES.customer,
          pageSize: "100",
          page: "2",
        },
        "test",
      ),
    ).toMatchObject({
      query: "Alice",
      role: AUTH_USER_ROLES.customer,
      pageSize: 100,
      page: 2,
    });
  });
  it.each([
    { pageSize: "101" },
    { page: "0" },
    { page: "1x" },
    { pageSize: ["10"] },
    { role: "ROOT" },
    { status: "LOCKED" },
    { q: "a", query: "b" },
    { pageSize: "10", page_size: "20" },
    { q: "x".repeat(201) },
  ])("rejects ambiguous or unbounded queries %p", (query) => {
    expect(() => parseListQuery(query, "test")).toThrow();
  });
});
