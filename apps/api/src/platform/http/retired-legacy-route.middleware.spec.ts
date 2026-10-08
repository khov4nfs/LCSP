import {
  RETIRED_API_ROUTES,
  LEGACY_ROUTE_RETIRED_ERROR_CODE,
} from "@lcsp/contracts/legacy-migration";
import {
  Controller,
  Get,
  type INestApplication,
  Logger,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

import { HttpExceptionFilter } from "./filters/http-exception.filter.js";
import { RetiredLegacyRouteMiddleware } from "./retired-legacy-route.middleware.js";

@Controller("health")
class LiveController {
  @Get()
  ok() {
    return { alive: true };
  }
}

@Module({
  controllers: [LiveController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
class MiniAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Same registration as AppModule.configure.
    consumer.apply(RetiredLegacyRouteMiddleware).forRoutes(
      ...RETIRED_API_ROUTES.map((route) => ({
        path: route.path,
        method: RequestMethod[route.method],
      })),
    );
  }
}

const concrete = (path: string) =>
  `/${path.replaceAll(/:[A-Za-z0-9_]+/gu, "id-1")}`;

describe("RetiredLegacyRouteMiddleware", () => {
  let app: INestApplication;
  const warn = jest
    .spyOn(Logger.prototype, "warn")
    .mockImplementation(() => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MiniAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    warn.mockRestore();
  });

  it.each(
    RETIRED_API_ROUTES.map((route) => [route.method, route.path] as const),
  )(
    "%s /%s answers 410 with the standard problem envelope",
    async (method, path) => {
      const response = await request(app.getHttpServer())
        [method.toLowerCase() as "get"](concrete(path))
        .set("x-correlation-id", "corr-retired")
        .send({});
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({
        ok: false,
        problem: {
          status: 410,
          code: LEGACY_ROUTE_RETIRED_ERROR_CODE,
          correlationId: "corr-retired",
        },
      });
    },
  );

  it("does not touch a live route and never logs query strings", async () => {
    warn.mockClear();
    const live = await request(app.getHttpServer()).get("/health");
    expect(live.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();

    await request(app.getHttpServer()).get(
      "/assessments/a-1/documents?token=secret",
    );
    // Only this middleware's own event is asserted: the global exception filter has its own log line.
    const events = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.startsWith("{"))
      .map((message) => JSON.parse(message) as Record<string, unknown>);
    expect(events).toEqual([
      expect.objectContaining({
        event: LEGACY_ROUTE_RETIRED_ERROR_CODE,
        route: "/assessments/a-1/documents",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });
});
