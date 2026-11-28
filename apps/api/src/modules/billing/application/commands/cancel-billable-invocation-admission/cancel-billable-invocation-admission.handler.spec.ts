import {
  ADMISSION_STATES,
  deriveAdmissionCapabilityDigest,
} from "@lcsp/contracts/billing";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { CancelBillableInvocationAdmissionCommand } from "./cancel-billable-invocation-admission.command.js";
import { CancelBillableInvocationAdmissionHandler } from "./cancel-billable-invocation-admission.handler.js";

describe("cancel admission lost-response recovery", () => {
  it("replays an already confirmed pre-consume cancellation without a second write", async () => {
    // Why: A worker can lose the cancellation response after the server releases the slot.
    // How: Retry with the same admission and capability against the locked terminal row.
    // Invariant: Recovery can delete its encrypted envelope only after a terminal acknowledgement.
    const token = "capability-token-abcdef1234567890abcdef1234567890";
    const admission = {
      id: "admission-1",
      invocationId: "invocation-1",
      capabilityDigest: deriveAdmissionCapabilityDigest(token),
    };
    let writeCount = 0;
    const tx = {
      $queryRaw: () =>
        Promise.resolve([
          {
            id: admission.id,
            state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
            version: 2,
          },
        ]),
      billableInvocationAdmission: {
        update: () => {
          writeCount += 1;
          return Promise.resolve({});
        },
      },
    };
    const prisma = {
      billableInvocationAdmission: {
        findUnique: () => Promise.resolve(admission),
      },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as unknown as PrismaService;
    const handler = new CancelBillableInvocationAdmissionHandler(prisma);

    const result = await handler.execute(
      new CancelBillableInvocationAdmissionCommand(
        {
          admissionId: admission.id,
          invocationId: admission.invocationId,
          capabilityToken: token,
          cancellationReason: "LOCAL_ADMISSION_REJECTED",
        },
        "correlation-1",
      ),
    );

    expect(result).toMatchObject({
      state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
      slotReleased: true,
    });
    expect(writeCount).toBe(0);
  });

  it("still rejects cancellation when consume won the race", async () => {
    // Why: Idempotent terminal replay must never let a worker release an IN_FLIGHT slot.
    // How: Present an authenticated capability with a row already advanced by consume.
    // Invariant: Server keeps exposure until settlement or independent reconciliation.
    const token = "capability-token-abcdef1234567890abcdef1234567890";
    const admission = {
      id: "admission-2",
      invocationId: "invocation-2",
      capabilityDigest: deriveAdmissionCapabilityDigest(token),
    };
    const tx = {
      $queryRaw: () =>
        Promise.resolve([
          { id: admission.id, state: ADMISSION_STATES.IN_FLIGHT },
        ]),
    };
    const prisma = {
      billableInvocationAdmission: {
        findUnique: () => Promise.resolve(admission),
      },
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as unknown as PrismaService;
    const handler = new CancelBillableInvocationAdmissionHandler(prisma);

    await expect(
      handler.execute(
        new CancelBillableInvocationAdmissionCommand(
          {
            admissionId: admission.id,
            invocationId: admission.invocationId,
            capabilityToken: token,
            cancellationReason: "LOCAL_ADMISSION_REJECTED",
          },
          "correlation-2",
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
