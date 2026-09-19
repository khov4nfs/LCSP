import { jest } from "@jest/globals";
import type { CommandBus } from "@nestjs/cqrs";
import type { Request } from "express";
import { BILLING_RECONCILIATION_ERROR_CODES } from "@lcsp/contracts/billing";

import { SePayWebhookIngressError } from "../../infrastructure/security/sepay-webhook-ingress.js";
import { SePayWebhookController } from "./sepay-webhook.controller.js";

describe("SePayWebhookController", () => {
  it("passes the raw Buffer through and returns the shared success envelope", async () => {
    const execute = jest.fn<CommandBus["execute"]>(() =>
      Promise.resolve({ duplicate: false }),
    );
    const controller = new SePayWebhookController({
      execute,
    } as unknown as CommandBus);
    const rawBody = Buffer.from('{"id":"TX-1"}');

    await expect(
      controller.receive({ body: rawBody } as Request, "signature", "123"),
    ).resolves.toEqual({ ok: true, data: { duplicate: false } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { rawBody, signature: "signature", timestamp: "123" },
      }),
    );
  });

  it("maps malformed raw bodies to the canonical webhook problem code", async () => {
    const execute = jest.fn<CommandBus["execute"]>(() =>
      Promise.reject(new SePayWebhookIngressError("BODY")),
    );
    const controller = new SePayWebhookController({
      execute,
    } as unknown as CommandBus);

    await expect(
      controller.receive(
        { body: Buffer.from("{") } as Request,
        "signature",
        "123",
      ),
    ).rejects.toMatchObject({
      // Jest asymmetric matchers intentionally return `any`.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      response: expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        problem: expect.objectContaining({
          code: BILLING_RECONCILIATION_ERROR_CODES.malformedBody,
        }),
      }),
    });
  });
});
