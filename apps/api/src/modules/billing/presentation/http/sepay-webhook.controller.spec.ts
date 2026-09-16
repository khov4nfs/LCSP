import { jest } from "@jest/globals";
import type { Request } from "express";
import { BILLING_RECONCILIATION_ERROR_CODES } from "@lcsp/contracts/billing";

import {
  SePayWebhookIngressError,
  SePayWebhookIngressService,
} from "../../application/services/sepay-webhook-ingress.service.js";
import { SePayWebhookController } from "./sepay-webhook.controller.js";

describe("SePayWebhookController", () => {
  it("passes the raw Buffer through and returns the shared success envelope", async () => {
    const accept = jest.fn<SePayWebhookIngressService["accept"]>(() =>
      Promise.resolve({ duplicate: false }),
    );
    const controller = new SePayWebhookController({
      accept,
    } as unknown as SePayWebhookIngressService);
    const rawBody = Buffer.from('{"id":"TX-1"}');

    await expect(
      controller.receive({ body: rawBody } as Request, "signature", "123"),
    ).resolves.toEqual({ ok: true, data: { duplicate: false } });
    expect(accept).toHaveBeenCalledWith({
      rawBody,
      signature: "signature",
      timestamp: "123",
    });
  });

  it("maps malformed raw bodies to the canonical webhook problem code", async () => {
    const accept = jest.fn<SePayWebhookIngressService["accept"]>(() =>
      Promise.reject(new SePayWebhookIngressError("BODY")),
    );
    const controller = new SePayWebhookController({
      accept,
    } as unknown as SePayWebhookIngressService);

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
