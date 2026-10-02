import { jest } from "@jest/globals";

import { PrismaBillingTransaction } from "./prisma-billing-transaction.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

describe("PrismaBillingTransaction runtime policy repository", () => {
  describe("ensure", () => {
    const input = {
      role: "root",
      provider: "LLM7",
      model: "future-model-v99",
      policyVersion: "cfg-0123456789abcdef",
      effectiveAt: new Date("1970-01-01T00:00:00.000Z"),
    };
    function ensureWith(stored: Array<Record<string, unknown>>) {
      const rows = [...stored];
      const snapshot = {
        createMany: jest.fn(
          ({ data }: { data: Array<Record<string, unknown>> }) => {
            for (const row of data)
              if (
                !rows.some(
                  (r) =>
                    r.role === row.role &&
                    r.policyVersion === row.policyVersion,
                )
              )
                rows.push({ id: `id-${rows.length}`, ...row });
            return Promise.resolve({ count: 1 });
          },
        ),
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { role_policyVersion: Record<string, string> };
          }) =>
            Promise.resolve(
              rows.find(
                (r) =>
                  r.role === where.role_policyVersion.role &&
                  r.policyVersion === where.role_policyVersion.policyVersion,
              ) ?? null,
            ),
        ),
      };
      const tx = {
        $executeRaw: jest.fn(() => Promise.resolve(1)),
        runtimeModelPolicySnapshot: snapshot,
      };
      const transaction = new PrismaBillingTransaction({
        $transaction: <T>(op: (t: typeof tx) => Promise<T>) => op(tx),
      } as unknown as PrismaService);
      return {
        rows,
        snapshot,
        ensure: (value: typeof input) =>
          transaction.runForUser("u", (r) => r.runtimePolicy.ensure(value)),
      };
    }

    it("creates a never-seen model with zero seed, then reuses it", async () => {
      const { ensure, rows } = ensureWith([]);
      const first = await ensure(input);
      const second = await ensure(input);
      expect(second.id).toBe(first.id);
      expect(rows).toHaveLength(1);
    });

    it("adds a new row for a new version/model and leaves history untouched", async () => {
      const historical = {
        id: "old",
        ...input,
        model: "model-alpha",
        policyVersion: "p1",
      };
      const { ensure, rows } = ensureWith([historical]);
      await ensure({
        ...input,
        model: "model-beta",
        policyVersion: "cfg-aaaaaaaaaaaaaaaa",
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(historical);
      await expect(
        ensure({ ...input, model: "model-alpha", policyVersion: "p1" }),
      ).resolves.toMatchObject({ id: "old" });
    });

    it("rejects the same (role, policyVersion) bound to a different model", async () => {
      const { ensure, rows } = ensureWith([{ id: "old", ...input }]);
      await expect(ensure({ ...input, model: "other" })).rejects.toThrow(
        "already bound to a different model",
      );
      await expect(ensure({ ...input, provider: "OPENAI" })).rejects.toThrow(
        "already bound",
      );
      expect(rows[0].model).toBe("future-model-v99");
    });
  });
});
