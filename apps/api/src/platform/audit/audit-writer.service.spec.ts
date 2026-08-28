import {
  AUDIT_DECISIONS,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_LEGACY_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import { jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import type { AuditEventInput } from "@lcsp/contracts/audit";

import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { LOCAL_RBAC_REASON_CODES } from "../rbac/rbac-reason-codes.js";
import { AuditWriterService } from "./audit-writer.service.ts";

type CreateFn = (args: { data: Record<string, unknown> }) => Promise<unknown>;

function makePrisma(
  overrides: { create?: ReturnType<typeof jest.fn<CreateFn>> } = {},
) {
  const create = overrides.create ?? jest.fn<CreateFn>().mockResolvedValue({});
  const client = {
    auditEvent: { create },
  };
  return { client: client as unknown as PrismaService, create };
}

function makeTx(
  overrides: { create?: ReturnType<typeof jest.fn<CreateFn>> } = {},
) {
  const create = overrides.create ?? jest.fn<CreateFn>().mockResolvedValue({});
  const tx = {
    auditEvent: { create },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, create };
}

function makeEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    eventType: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
    actorId: "user-1",
    correlationId: "corr-1",
    decision: AUDIT_DECISIONS.allow,
    ...overrides,
  };
}

describe("AuditWriterService", () => {
  it("T01: write() with clean payload creates a row with all fields correct", async () => {
    const { client, create } = makePrisma();
    const service = new AuditWriterService(client);
    const event = makeEvent({ payload: { userId: "u-1" } });

    await service.write(event);

    expect(create).toHaveBeenCalledTimes(1);
    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      eventType: event.eventType,
      actorId: event.actorId,
      correlationId: event.correlationId,
      decision: event.decision,
      payload: {
        schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
        actor: { id: "user-1", type: AUDIT_ACTOR_TYPES.user },
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        result: AUDIT_DECISIONS.allow,
        userId: "u-1",
      },
    });
    expect(typeof data.id).toBe("string");
    expect(data.createdAt).toBeInstanceOf(Date);
  });

  it("T02: write() with payload.passwordHash strips the field, still creates the row, and warns", async () => {
    const { client, create } = makePrisma();
    const service = new AuditWriterService(client);
    const warnSpy = jest.spyOn(
      Reflect.get(service, "logger") as { warn: (msg: string) => void },
      "warn",
    );

    await service.write(
      makeEvent({ payload: { passwordHash: "h", userId: "u-1" } }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.payload).toEqual({
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      actor: { id: "user-1", type: AUDIT_ACTOR_TYPES.user },
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      result: AUDIT_DECISIONS.allow,
      userId: "u-1",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("passwordHash"),
    );
  });

  it("T03: write() with payload.sessionToken strips the field and still creates the row", async () => {
    const { client, create } = makePrisma();
    const service = new AuditWriterService(client);

    await service.write(
      makeEvent({ payload: { sessionToken: "t", userId: "u-1" } }),
    );

    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.payload).toEqual({
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      actor: { id: "user-1", type: AUDIT_ACTOR_TYPES.user },
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      result: AUDIT_DECISIONS.allow,
      userId: "u-1",
    });
  });

  it("T04: write() rejects when the DB write fails, and logs the error", async () => {
    const { client, create } = makePrisma({
      create: jest
        .fn<CreateFn>()
        .mockRejectedValue(new Error("db unavailable")),
    });
    const service = new AuditWriterService(client);
    const errorSpy = jest.spyOn(
      Reflect.get(service, "logger") as { error: (msg: string) => void },
      "error",
    );

    await expect(service.write(makeEvent())).rejects.toThrow("db unavailable");

    expect(create).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("db unavailable"),
    );
  });

  it("T05/T06: writeInTx() writes through the passed transaction client, not the module-level PrismaService", async () => {
    const { client, create: prismaCreate } = makePrisma();
    const { tx, create: txCreate } = makeTx();
    const service = new AuditWriterService(client);

    await service.writeInTx(makeEvent(), tx);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  it("T05/T06: writeInTx() rejects when the transaction client rejects", async () => {
    const { client } = makePrisma();
    const { tx } = makeTx({
      create: jest
        .fn<CreateFn>()
        .mockRejectedValue(new Error("tx rolled back")),
    });
    const service = new AuditWriterService(client);

    await expect(service.writeInTx(makeEvent(), tx)).rejects.toThrow(
      "tx rolled back",
    );
  });

  it("preserves optional auth audit reason and session metadata", async () => {
    const { client, create } = makePrisma();
    const service = new AuditWriterService(client);

    await service.write(
      makeEvent({
        reasonCode: LOCAL_RBAC_REASON_CODES.authorized,
        sessionId: "session-1",
      }),
    );

    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      reasonCode: LOCAL_RBAC_REASON_CODES.authorized,
      sessionId: "session-1",
    });
  });

  it("T07: occurredAt (createdAt) is service-generated, not derived from caller input", async () => {
    const { client, create } = makePrisma();
    const service = new AuditWriterService(client);
    const before = new Date();

    await service.write(makeEvent());

    const after = new Date();
    const [{ data }] = create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    const createdAt = data.createdAt as Date;
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
