import express from "express";
import request from "supertest";
import { httpBodyParser } from "./http-body-parser.js";

interface TestApiResponse {
  ok: boolean;
  length?: number;
  isBuffer?: boolean;
  frontierRevision?: number;
  sourceRevision?: string;
  batchCount?: number;
}

interface SourceReviewsBody {
  frontierRevision?: number;
  sourceRevision?: string;
  batch?: unknown[];
}

describe("httpBodyParser (route-specific JSON and raw body limits)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(httpBodyParser());

    app.post(
      "/internal/compliance-rule-set/source-reviews",
      (req: express.Request, res: express.Response) => {
        const body =
          typeof req.body === "object" && req.body !== null
            ? (req.body as SourceReviewsBody)
            : undefined;
        const length =
          typeof req.body === "object" && req.body !== null
            ? JSON.stringify(req.body).length
            : 0;
        res.json({
          ok: true,
          length,
          frontierRevision:
            typeof body?.frontierRevision === "number"
              ? body.frontierRevision
              : undefined,
          sourceRevision:
            typeof body?.sourceRevision === "string"
              ? body.sourceRevision
              : undefined,
          batchCount: Array.isArray(body?.batch)
            ? body.batch.length
            : undefined,
        });
      },
    );

    app.post(
      "/internal/compliance-rule-set/failures",
      (req: express.Request, res: express.Response) => {
        const length =
          typeof req.body === "object" && req.body !== null
            ? JSON.stringify(req.body).length
            : 0;
        res.json({ ok: true, length });
      },
    );

    app.post(
      "/billing/sepay/webhook",
      (req: express.Request, res: express.Response) => {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
        const isBuffer = rawBody !== undefined;
        const length = rawBody ? rawBody.length : 0;
        res.json({ ok: true, isBuffer, length });
      },
    );
  });

  it("accepts valid JSON payload > 1 MiB on /internal/compliance-rule-set/source-reviews", async () => {
    const largeData = "x".repeat(1.5 * 1024 * 1024); // 1.5 MB
    const res = await request(app)
      .post("/internal/compliance-rule-set/source-reviews")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: largeData }));

    expect(res.status).toBe(200);
    const body = res.body as TestApiResponse;
    expect(body.ok).toBe(true);
  });

  it("rejects payload > 1 MiB on unconfigured internal endpoints with 413", async () => {
    const largeData = "x".repeat(1.5 * 1024 * 1024); // 1.5 MB
    const res = await request(app)
      .post("/internal/compliance-rule-set/failures")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: largeData }));

    expect(res.status).toBe(413);
  });

  it("accepts small payload <= 1 MiB on unconfigured internal endpoints", async () => {
    const smallData = "x".repeat(10 * 1024); // 10 KB
    const res = await request(app)
      .post("/internal/compliance-rule-set/failures")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: smallData }));

    expect(res.status).toBe(200);
    const body = res.body as TestApiResponse;
    expect(body.ok).toBe(true);
  });

  it("enforces raw body and 256kb limit on /billing/sepay/webhook", async () => {
    const okPayload = "y".repeat(100 * 1024); // 100 KB
    const resOk = await request(app)
      .post("/billing/sepay/webhook")
      .set("Content-Type", "application/json")
      .send(okPayload);

    expect(resOk.status).toBe(200);
    const bodyOk = resOk.body as TestApiResponse;
    expect(bodyOk.isBuffer).toBe(true);
    expect(bodyOk.length).toBe(Buffer.byteLength(okPayload));

    const tooBigPayload = "y".repeat(300 * 1024); // 300 KB > 256 KB
    const resTooBig = await request(app)
      .post("/billing/sepay/webhook")
      .set("Content-Type", "application/json")
      .send(tooBigPayload);

    expect(resTooBig.status).toBe(413);
  });

  it("rejects payload > 50 MiB on /internal/compliance-rule-set/source-reviews with 413", async () => {
    const exceeds50Mb = "x".repeat(50 * 1024 * 1024 + 1024);
    const res = await request(app)
      .post("/internal/compliance-rule-set/source-reviews")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: exceeds50Mb }));

    expect(res.status).toBe(413);
  }, 15000);

  it("preserves full parsed payload including CAS revisions without truncation on large payloads", async () => {
    const largeBatch = Array.from({ length: 500 }, (_, i) => ({
      sourceNodeId: `node-${i}`,
      content: `Article obligation text for candidate ${i}`.repeat(20),
    }));
    const res = await request(app)
      .post("/internal/compliance-rule-set/source-reviews")
      .set("Content-Type", "application/json")
      .send(
        JSON.stringify({
          frontierRevision: 17,
          sourceRevision: "6".repeat(64),
          batch: largeBatch,
        }),
      );

    expect(res.status).toBe(200);
    const body = res.body as TestApiResponse;
    expect(body.ok).toBe(true);
    expect(body.frontierRevision).toBe(17);
    expect(body.sourceRevision).toBe("6".repeat(64));
    expect(body.batchCount).toBe(500);
  });
});
