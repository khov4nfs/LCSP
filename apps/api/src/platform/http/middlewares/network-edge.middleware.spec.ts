import type { Server } from "node:http";
import { Controller, Get, Res, type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Response } from "express";
import request from "supertest";

import {
  applyNetworkEdgeMiddleware,
  resolveCorsOrigin,
} from "./network-edge.middleware.js";

@Controller("test-network-edge")
class TestEdgeController {
  @Get("headers")
  getHeaders() {
    return { ok: true, data: "secure" };
  }

  @Get("large-payload")
  getLargePayload() {
    return { ok: true, data: "A".repeat(4096) };
  }

  @Get("sse-stream")
  getSseStream(@Res() res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.write("data: chunk-1\n\n");
    res.end();
  }

  @Get("pdf-binary")
  getPdfBinary(@Res() res: Response) {
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from("%PDF-1.4 " + "B".repeat(2048)));
  }
}

describe("Network Edge Security & Middlewares (Integration via Nest Application)", () => {
  describe("resolveCorsOrigin unit checks", () => {
    it("allows requests with no origin (e.g. server-to-server BFF or curl)", (done) => {
      const resolver = resolveCorsOrigin(["https://app.lcsp.vn"]);
      resolver(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });

    it("allows configured whitelist origins", (done) => {
      const resolver = resolveCorsOrigin([
        "https://app.lcsp.vn",
        "https://admin.lcsp.vn",
      ]);
      resolver("https://app.lcsp.vn", (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });

    it("rejects untrusted third-party origins in production", (done) => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const resolver = resolveCorsOrigin(["https://app.lcsp.vn"]);
        resolver("https://malicious-site.com", (err, allow) => {
          expect(err).toBeNull();
          expect(allow).toBe(false);
          done();
        });
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it("allows localhost IPv4 and IPv6 [::1] origins in development / test environments", (done) => {
      const resolver = resolveCorsOrigin([]);
      resolver("http://[::1]:3000", (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });
  });

  describe("Integration with Nest Application via applyNetworkEdgeMiddleware", () => {
    let app: INestApplication;
    let server: Server;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [TestEdgeController],
      }).compile();

      app = moduleFixture.createNestApplication();
      applyNetworkEdgeMiddleware(app, {
        allowedOrigins: ["https://app.lcsp.vn"],
      });
      await app.init();
      server = app.getHttpServer() as Server;
    });

    afterAll(async () => {
      await app.close();
    });

    it("applies Helmet security headers (nosniff, frameguard) on real endpoints", async () => {
      const res = await request(server).get("/test-network-edge/headers");
      expect(res.status).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      // In test mode, HSTS should be omitted
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    });

    it("compresses large JSON payloads when client accepts gzip", async () => {
      const res = await request(server)
        .get("/test-network-edge/large-payload")
        .set("Accept-Encoding", "gzip");
      expect(res.status).toBe(200);
      expect(res.headers["content-encoding"]).toBe("gzip");
    });

    it("never compresses text/event-stream to avoid AI streaming buffering", async () => {
      const res = await request(server)
        .get("/test-network-edge/sse-stream")
        .set("Accept-Encoding", "gzip");
      expect(res.status).toBe(200);
      expect(res.headers["content-encoding"]).toBeUndefined();
    });

    it("never compresses PDF binaries", async () => {
      const res = await request(server)
        .get("/test-network-edge/pdf-binary")
        .set("Accept-Encoding", "gzip");
      expect(res.status).toBe(200);
      expect(res.headers["content-encoding"]).toBeUndefined();
    });

    it("handles CORS preflight correctly with LCSP custom headers", async () => {
      const res = await request(server)
        .options("/test-network-edge/headers")
        .set("Origin", "https://app.lcsp.vn")
        .set("Access-Control-Request-Method", "GET")
        .set(
          "Access-Control-Request-Headers",
          "x-worker-api-key, x-lcsp-locale, x-assessment-lease, x-correlation-id",
        );

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(
        "https://app.lcsp.vn",
      );
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
  });
});
