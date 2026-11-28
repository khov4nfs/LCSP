import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminModelReconciliationCompensationForm } from "../src/features/admin/components/molecules/admin-model-reconciliation-compensation-form.tsx";
import { createAdminCompensationFormSchema } from "../src/features/admin/schemas/admin-model-reconciliation.schema.ts";

const preview = {
  originalLedgerEntryId: "ledger-original-1",
  originalDebitMicrocredits: "1000",
  totalCompensatedMicrocredits: "300",
  remainingUncompensatedMicrocredits: "700",
};

test("compensation form binds original debit and server remaining amount", () => {
  const html = renderToStaticMarkup(
    <AdminModelReconciliationCompensationForm
      preview={preview}
      onSubmit={async () => {}}
      isSubmitting={false}
    />,
  );
  assert.match(html, /ledger-original-1/);
  assert.match(html, /700/);
  assert.match(html, /name="amountMicrocredits"/);
  assert.match(html, /name="reason"/);
});

test("compensation schema rejects zero, fractional and amounts above server ceiling", () => {
  const schema = createAdminCompensationFormSchema(preview);
  const base = {
    originalLedgerEntryId: preview.originalLedgerEntryId,
    amountMicrocredits: "700",
    reason: "Verified billing correction",
    idempotencyKey: "comp-key-12345678",
  };
  assert.equal(schema.safeParse(base).success, true);
  for (const amount of ["0", "1.5", "701", "10000"]) {
    assert.equal(
      schema.safeParse({ ...base, amountMicrocredits: amount }).success,
      false,
    );
  }
  assert.equal(
    schema.safeParse({ ...base, originalLedgerEntryId: "other-ledger" })
      .success,
    false,
  );
});
