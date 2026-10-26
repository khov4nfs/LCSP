import express from "express";
import request from "supertest";
import { httpBodyParser } from "./http-body-parser.js";

describe("httpBodyParser (route-specific JSON and raw body limits)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(httpBodyParser());

    app.post("/internal/compliance-rule-set/source-reviews", (req, res) => {
      res.json({
        ok: true,
        length: JSON.stringify(req.body).length,
        frontierRevision: req.body?.frontierRevision,
        sourceRevision: req.body?.sourceRevision,
        batchCount: req.body?.batch?.length,
      });
    });

    app.post("/internal/compliance-rule-set/failures", (req, res) => {
      res.json({ ok: true, length: JSON.stringify(req.body).length });
    });

    app.post("/billing/sepay/webhook", (req, res) => {
      const isBuffer = Buffer.isBuffer(req.body);
      res.json({ ok: true, isBuffer, length: req.body?.length ?? 0 });
    });
  });

  it("accepts valid JSON payload > 1 MiB on /internal/compliance-rule-set/source-reviews", async () => {
    const largeData = "x".repeat(1.5 * 1024 * 1024); // 1.5 MB
    const res = await request(app)
      .post("/internal/compliance-rule-set/source-reviews")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: largeData }));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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
    expect(res.body.ok).toBe(true);
  });

  it("enforces raw body and 256kb limit on /billing/sepay/webhook", async () => {
    const okPayload = "y".repeat(100 * 1024); // 100 KB
    const resOk = await request(app)
      .post("/billing/sepay/webhook")
      .set("Content-Type", "application/json")
      .send(okPayload);

    expect(resOk.status).toBe(200);
    expect(resOk.body.isBuffer).toBe(true);

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
    expect(res.body.ok).toBe(true);
    expect(res.body.frontierRevision).toBe(17);
    expect(res.body.sourceRevision).toBe("6".repeat(64));
    expect(res.body.batchCount).toBe(500);
  });
});
