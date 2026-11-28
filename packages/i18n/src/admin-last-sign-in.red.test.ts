import assert from "node:assert/strict";
import test from "node:test";
import { enPages } from "./locales/en/pages.ts";
import { viPages } from "./locales/vi/pages.ts";

test("A-04 Admin session creation is labelled as last sign in, not last activity", () => {
  // Why: Admin queries read the newest SESSION.createdAt, not a durable activity timestamp.
  // How: Lock the user-list and detail labels to the actual session issuance metric.
  // Invariant: Neither locale claims to show activity the backend has not recorded.
  assert.equal(enPages.admin.usersList.columns.lastActive, "Last sign in");
  assert.equal(
    enPages.admin.userDetail.accountDetailsCard.lastActive,
    "Last sign in",
  );
  assert.equal(
    viPages.admin.usersList.columns.lastActive,
    "Đăng nhập gần nhất",
  );
  assert.equal(
    viPages.admin.userDetail.accountDetailsCard.lastActive,
    "Đăng nhập gần nhất",
  );
});
