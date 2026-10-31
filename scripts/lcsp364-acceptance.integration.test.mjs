import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { applyTestCredit, TEST_CREDIT } from "./lcsp364-test-credit.mjs";
import { enrollCanary } from "./lcsp364-enroll-canary.mjs";

const url = process.env.LCSP_TEST_CAPACITY_DATABASE_URL;
const enabled = { skip: !url };
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
let admin,
  owner,
  replica,
  Kernel,
  Transactions,
  Repository,
  actorId,
  writerRole;
let ownedId, ordinaryId;
const suffix = randomUUID().replaceAll("-", "");

before(async () => {
  if (!url) return;
  const parsed = new URL(url);
  assert(
    ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
      /^\/lcsp364_/.test(parsed.pathname),
    "Disposable LCSP-364 DB required",
  );
  const { PrismaClient } = require("@prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const connect = (connection) =>
    new PrismaClient({ adapter: new PrismaPg(connection) });
  admin = connect(url);
  writerRole = `lcsp364_writer_${suffix}`;
  const password = `fixture_${suffix}`;
  await admin.$executeRawUnsafe(
    `CREATE ROLE "${writerRole}" LOGIN PASSWORD '${password}'`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE ON SCHEMA public TO "${writerRole}"`,
  );
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${writerRole}"`,
  );
  await admin.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${writerRole}"`,
  );
  parsed.username = writerRole;
  parsed.password = password;
  owner = connect(parsed.toString());
  replica = connect(parsed.toString());
  ({
    BillingAccountingKernel: Kernel,
    PrismaBillingTransaction: Transactions,
    OutboxRepository: Repository,
  } = await import(require.resolve("@lcsp/api/operations")));
  actorId = `lcsp364-admin-${suffix}`;
  for (const data of [
    { id: TEST_CREDIT.userId, email: TEST_CREDIT.email, role: "CUSTOMER" },
    { id: actorId, email: `${actorId}@acceptance.invalid`, role: "ADMIN" },
  ])
    await admin.user.create({
      data: {
        ...data,
        passwordHash: "provider-free-fixture",
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
  ownedId = randomUUID();
  ordinaryId = randomUUID();
  for (const id of [ownedId, ordinaryId])
    await admin.assessment.create({
      data: {
        id,
        ownerId: TEST_CREDIT.userId,
        name: "LCSP-364 provider-free fixture",
        lifecycleState: "PREPARING",
        lifecycleRevision: 0,
        runtime: {
          create: {
            threadId: randomUUID(),
            rootAgentVersion: "fixture",
            checkpointNamespace: "fixture",
          },
        },
      },
    });
});

after(async () => {
  if (!url || !admin) return;
  await Promise.all([owner?.$disconnect(), replica?.$disconnect()]);
  // Fixture teardown is restricted to identities created in this disposable database.
  await admin.assessmentExecutionIsolation.deleteMany({
    where: { assessmentId: { in: [ownedId, ordinaryId] } },
  });
  await admin.assessmentRootAdmissionRequest.deleteMany({
    where: { assessmentId: { in: [ownedId, ordinaryId] } },
  });
  await admin.outboxMessage.deleteMany({
    where: { aggregateId: { in: [ownedId, ordinaryId] } },
  });
  await admin.assessment.deleteMany({
    where: { id: { in: [ownedId, ordinaryId] } },
  });
  await admin.auditEvent.deleteMany({ where: { actorId } });
  await admin.creditLedgerEntry.deleteMany({
    where: { userId: TEST_CREDIT.userId },
  });
  await admin.billingWallet.deleteMany({
    where: { userId: TEST_CREDIT.userId },
  });
  await admin.user.deleteMany({
    where: { id: { in: [TEST_CREDIT.userId, actorId] } },
  });
  await admin.$executeRawUnsafe(`DROP OWNED BY "${writerRole}"`);
  await admin.$executeRawUnsafe(`DROP ROLE "${writerRole}"`);
  await admin.$disconnect();
});

test(
  "only the exact test customer and active admin can grant credit",
  enabled,
  async () => {
    await assert.rejects(
      applyTestCredit({
        prisma: owner,
        transactions: new Transactions(owner),
        Kernel,
        actorId: TEST_CREDIT.userId,
        action: "grant",
      }),
      /ADMIN/,
    );
    await admin.user.update({
      where: { id: TEST_CREDIT.userId },
      data: { email: `${suffix}@acceptance.invalid` },
    });
    await assert.rejects(
      applyTestCredit({
        prisma: owner,
        transactions: new Transactions(owner),
        Kernel,
        actorId,
        action: "grant",
      }),
      /test customer/,
    );
    await admin.user.update({
      where: { id: TEST_CREDIT.userId },
      data: { email: TEST_CREDIT.email },
    });
    assert.equal(await admin.creditLedgerEntry.count(), 0);
  },
);

test(
  "audit failure rolls back kernel ledger and wallet projection together",
  enabled,
  async () => {
    const actual = new Transactions(owner);
    const transactions = {
      runForUser: (id, operation) =>
        actual.runForUser(id, (repos) =>
          operation({
            ...repos,
            audit: {
              append: async () => {
                throw new Error("Injected audit outage");
              },
            },
          }),
        ),
    };
    await assert.rejects(
      applyTestCredit({
        prisma: owner,
        transactions,
        Kernel,
        actorId,
        action: "grant",
      }),
      /audit outage/,
    );
    assert.equal(await admin.creditLedgerEntry.count(), 0);
    assert.equal(await admin.billingWallet.count(), 0);
  },
);

test(
  "concurrent grants append once, project once, audit once and create no payment",
  enabled,
  async () => {
    const [a, b] = await Promise.all(
      [owner, replica].map((prisma) =>
        applyTestCredit({
          prisma,
          transactions: new Transactions(prisma),
          Kernel,
          actorId,
          action: "grant",
        }),
      ),
    );
    assert.equal(a.ledgerEntryId, b.ledgerEntryId);
    assert.equal(Number(a.replay) + Number(b.replay), 1);
    assert.equal(
      (
        await admin.billingWallet.findUniqueOrThrow({
          where: { userId: TEST_CREDIT.userId },
        })
      ).availableCredits,
      TEST_CREDIT.amount,
    );
    assert.equal(await admin.creditLedgerEntry.count(), 1);
    assert.equal(
      await admin.auditEvent.count({
        where: { eventType: TEST_CREDIT.grantSource },
      }),
      1,
    );
    for (const model of [
      admin.billingOrder,
      admin.paymentTransaction,
      admin.sePayWebhookEvent,
    ])
      assert.equal(await model.count(), 0);
  },
);

test(
  "unused-credit reversal preserves usage debit and is idempotent",
  enabled,
  async () => {
    const wallet = await admin.billingWallet.findUniqueOrThrow({
      where: { userId: TEST_CREDIT.userId },
    });
    await new Kernel(new Transactions(owner)).appendLedger({
      userId: TEST_CREDIT.userId,
      walletId: wallet.id,
      deltaCredits: -137n,
      idempotencyKey: `fixture-debit-${suffix}`,
      source: "FIXTURE_USAGE",
      referenceId: "LCSP-364",
    });
    const result = await applyTestCredit({
      prisma: owner,
      transactions: new Transactions(owner),
      Kernel,
      actorId,
      action: "revoke",
    });
    assert.equal(result.usedCredits, "137");
    assert.equal(result.deltaCredits, "-999863");
    assert.equal(result.after.available, "0");
    const replay = await applyTestCredit({
      prisma: owner,
      transactions: new Transactions(owner),
      Kernel,
      actorId,
      action: "revoke",
    });
    assert.equal(replay.ledgerEntryId, result.ledgerEntryId);
    assert.equal(replay.replay, true);
    assert.equal(
      await admin.auditEvent.count({
        where: { eventType: TEST_CREDIT.revokeSource },
      }),
      1,
    );
  },
);

test(
  "enrollment refuses a superuser and never transfers an existing execution",
  enabled,
  async () => {
    await assert.rejects(
      enrollCanary({ prisma: admin, assessmentId: ownedId, actorId }),
      /non-superuser/,
    );
    await owner.assessmentRuntime.update({
      where: { assessmentId: ordinaryId },
      data: { currentExecutionId: randomUUID() },
    });
    await assert.rejects(
      enrollCanary({ prisma: owner, assessmentId: ordinaryId, actorId }),
      /unstarted/,
    );
    await owner.assessmentRuntime.update({
      where: { assessmentId: ordinaryId },
      data: { currentExecutionId: null },
    });
    assert.equal(
      (await enrollCanary({ prisma: owner, assessmentId: ownedId, actorId }))
        .replay,
      false,
    );
    assert.equal(
      (await enrollCanary({ prisma: replica, assessmentId: ownedId, actorId }))
        .replay,
      true,
    );
  },
);

test(
  "old DB writer cannot claim, complete, move, delete or mutate an isolated Assessment",
  enabled,
  async () => {
    for (const operation of [
      () =>
        admin.assessmentRuntime.update({
          where: { assessmentId: ownedId },
          data: { executionState: "RUNNING", leaseToken: randomUUID() },
        }),
      () =>
        admin.assessmentRuntime.update({
          where: { assessmentId: ownedId },
          data: { executionState: "FAILED" },
        }),
      () =>
        admin.assessment.update({
          where: { id: ownedId },
          data: { lifecycleState: "COMPLETE" },
        }),
      () =>
        admin.assessmentRuntime.delete({ where: { assessmentId: ownedId } }),
      () =>
        admin.assessmentRuntimeTurn.create({
          data: {
            id: randomUUID(),
            assessmentId: ownedId,
            threadId: randomUUID(),
            boundary: "ASSESSMENT_ROOT",
            logicalRunId: randomUUID(),
            correlationId: suffix,
            contextJson: {},
          },
        }),
    ])
      await assert.rejects(operation(), /LCSP_EXECUTION_WRITER_FENCED/);
    await owner.assessmentRuntime.delete({
      where: { assessmentId: ordinaryId },
    });
    await assert.rejects(
      admin.$executeRaw`UPDATE "AssessmentRuntime" SET "assessmentId" = ${ordinaryId} WHERE "assessmentId" = ${ownedId}`,
      /LCSP_EXECUTION_WRITER_FENCED/,
    );
    // A superuser's SET ROLE cannot impersonate the login identity checked by the fence.
    await assert.rejects(
      admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${writerRole}"`);
        await tx.assessment.update({
          where: { id: ownedId },
          data: { lifecycleState: "COMPLETE" },
        });
      }),
      /LCSP_EXECUTION_WRITER_FENCED/,
    );
    await admin.assessment.update({
      where: { id: ordinaryId },
      data: { name: "Unrelated writer remains operational" },
    });
    const rows =
      await admin.$queryRaw`SELECT count(*)::int AS count FROM pg_trigger WHERE tgname = 'lcsp_execution_writer_fence'`;
    assert(
      rows[0].count >= 20,
      "Canonical evidence, decisions, usage and runtime tables must be covered",
    );
  },
);

test(
  "isolated outbox survives old publishers, backoff, replicas and confirmed RabbitMQ delivery",
  { skip: !url || !process.env.LCSP_TEST_RABBITMQ_URL },
  async () => {
    const { RabbitMqClient } = await import(
      require.resolve("@lcsp/api/operations")
    );
    const { ASSESSMENT_ROOT_COMMAND_TYPES } = await import(
      require.resolve("@lcsp/contracts/assessment-domain")
    );
    const repository = new Repository(owner);
    const id = await repository.enqueue({
      aggregateType: "ASSESSMENT",
      aggregateId: ownedId,
      eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
      idempotencyKey: suffix,
      payload: { assessmentId: ownedId, idempotencyKey: suffix },
    });
    assert.equal(
      (await owner.outboxMessage.findUniqueOrThrow({ where: { id } })).status,
      "OWNED_PENDING",
    );
    const old =
      await admin.$queryRaw`SELECT id FROM "OutboxMessage" WHERE status IN ('PENDING', 'FAILED') AND id = ${id} FOR UPDATE SKIP LOCKED`;
    assert.deepEqual(old, []);
    assert.equal(
      await new Repository(admin).withPendingBatch(10, async () => {
        throw new Error("Foreign publisher selected protected work");
      }),
      null,
    );
    await owner.$transaction((tx) =>
      repository.markFailure(
        tx,
        id,
        1,
        5,
        "fixture transient failure",
        new Date(),
        new Date(Date.now() + 60000),
      ),
    );
    assert.equal(
      (await owner.outboxMessage.findUniqueOrThrow({ where: { id } })).status,
      "OWNED_PENDING",
    );
    assert.equal(await repository.withPendingBatch(10, async () => []), null);
    await owner.outboxMessage.update({
      where: { id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    const brokerUrl = process.env.LCSP_TEST_RABBITMQ_URL;
    assert(["localhost", "127.0.0.1"].includes(new URL(brokerUrl).hostname));
    const amqp = require("amqplib");
    const connection = await amqp.connect(brokerUrl);
    const channel = await connection.createChannel();
    const exchange = `lcsp364.isolation.${suffix}`;
    const previousExchange = process.env.RABBITMQ_EXCHANGE;
    process.env.RABBITMQ_EXCHANGE = exchange;
    const client = new RabbitMqClient(brokerUrl);
    try {
      await channel.assertExchange(exchange, "topic", { durable: true });
      const { queue } = await channel.assertQueue("", { exclusive: true });
      await channel.bindQueue(
        queue,
        exchange,
        ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
      );
      let locked;
      const lock = new Promise((resolve) => {
        locked = resolve;
      });
      let release;
      const hold = new Promise((resolve) => {
        release = resolve;
      });
      const publication = repository.withPendingBatch(
        1,
        async ([message], tx) => {
          assert.equal(message.id, id);
          locked();
          await hold;
          await client.publish(exchange, message.eventType, message.payload);
          await repository.markPublished(tx, message.id, new Date());
          return message.id;
        },
      );
      await lock;
      assert.equal(
        await new Repository(replica).withPendingBatch(1, async () => {
          throw new Error("Duplicate locked delivery");
        }),
        null,
      );
      release();
      assert.equal(await publication, id);
      const delivery = await channel.get(queue, { noAck: false });
      assert(delivery);
      assert.equal(
        JSON.parse(delivery.content.toString()).assessmentId,
        ownedId,
      );
      channel.nack(delivery, false, true);
      const redelivery = await channel.get(queue, { noAck: false });
      assert(redelivery && redelivery.fields.redelivered);
      channel.ack(redelivery);
      assert.equal(
        (await owner.outboxMessage.findUniqueOrThrow({ where: { id } })).status,
        "PUBLISHED",
      );
      assert.equal(await repository.withPendingBatch(10, async () => []), null);
    } finally {
      await client.onModuleDestroy();
      await channel.deleteExchange(exchange);
      await connection.close();
      if (previousExchange === undefined) delete process.env.RABBITMQ_EXCHANGE;
      else process.env.RABBITMQ_EXCHANGE = previousExchange;
    }
  },
);
