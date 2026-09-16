import { createHmac, randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module.js";
import { httpBodyParser } from "../src/http-body-parser.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";
import {
  pushPrismaSchema,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";

const secret = "sepay-e2e-webhook-secret";
describe("SePay webhook HTTP ingress (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.SEPAY_WEBHOOK_SECRET = secret;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.use(httpBodyParser());
    await app.init();
  });
  beforeEach(async () => {
    await prisma.outboxMessage.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.sePayWebhookEvent.deleteMany();
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("accepts raw signed bytes once, queues one outbox event, and rejects invalid/stale requests without persistence", async () => {
    const body = JSON.stringify({
      id: `TX-${randomUUID()}`,
      transferAmount: "10000",
      transferType: "in",
      code: "LCSPTEST",
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")}`;
    const send = (sig = signature, time = timestamp) =>
      httpRequest(app)
        .post("/billing/sepay/webhook")
        .set("Content-Type", "application/json")
        .set("X-SePay-Signature", sig)
        .set("X-SePay-Timestamp", time)
        .send(body);
    const first = await send().expect(201);
    assert.deepEqual(successBody<{ duplicate: boolean }>(first), {
      duplicate: false,
    });
    const duplicate = await send().expect(201);
    assert.deepEqual(successBody<{ duplicate: boolean }>(duplicate), {
      duplicate: true,
    });
    assert.equal(await prisma.sePayWebhookEvent.count(), 1);
    assert.equal(await prisma.outboxMessage.count(), 1);
    const invalid = await send("bad").expect(400);
    assert.equal(problemCode(invalid), "BILLING_WEBHOOK_SIGNATURE_INVALID");
    const stale = await send(signature, "0").expect(400);
    assert.equal(problemCode(stale), "BILLING_WEBHOOK_TIMESTAMP_STALE");
    assert.equal(await prisma.sePayWebhookEvent.count(), 1);
    assert.equal(await prisma.paymentTransaction.count(), 0);
  });
});
