import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RETIRED_API_ROUTES } from "@lcsp/contracts/legacy-migration";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it } from "@jest/globals";

import { AppModule } from "./app.module.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(here, "app.routes.allowlist.json");

type ModuleEntry = unknown;

/** Every HTTP route the application registers, from Nest module metadata (no DI, no database). */
function registeredRoutes(): string[] {
  const seen = new Set<unknown>();
  const controllers: Array<new (...args: never[]) => unknown> = [];
  const walk = (entry: ModuleEntry): void => {
    if (!entry) return;
    let current = entry as Record<string, unknown> | (new () => unknown);
    if (typeof current === "object" && "forwardRef" in current)
      current = (
        current as { forwardRef: () => unknown }
      ).forwardRef() as typeof current;
    const mod =
      typeof current === "object" && "module" in current
        ? (current as { module: unknown }).module
        : current;
    if (typeof mod !== "function" || seen.has(mod)) return;
    seen.add(mod);
    const dynamic = typeof current === "object" ? current : {};
    for (const controller of [
      ...((Reflect.getMetadata("controllers", mod) as unknown[]) ?? []),
      ...((dynamic.controllers as unknown[]) ?? []),
    ])
      controllers.push(controller as (typeof controllers)[number]);
    for (const imported of [
      ...((Reflect.getMetadata("imports", mod) as unknown[]) ?? []),
      ...((dynamic.imports as unknown[]) ?? []),
    ])
      walk(imported);
  };
  walk(AppModule);

  const routes: string[] = [];
  for (const controller of controllers) {
    const base = Reflect.getMetadata("path", controller) as
      string | string[] | undefined;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === "constructor") continue;
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata("method", handler) as
        number | undefined;
      const route = Reflect.getMetadata("path", handler) as
        string | string[] | undefined;
      if (method === undefined || route === undefined) continue;
      for (const prefix of Array.isArray(base) ? base : [base ?? ""])
        for (const suffix of Array.isArray(route) ? route : [route])
          routes.push(
            `${RequestMethod[method]} /${[prefix, suffix]
              .filter((part) => part && part !== "/")
              .join("/")
              .replaceAll(/\/+/gu, "/")
              .replace(/^\//u, "")}`,
          );
    }
  }
  return routes.sort();
}

const shape = (route: string) => route.replaceAll(/:[A-Za-z0-9_]+/gu, ":");

describe("API route surface after the W6 cutover", () => {
  const routes = registeredRoutes();

  it("matches the committed allowlist exactly (adding or removing a route is a reviewed change)", () => {
    if (process.env.UPDATE_ROUTE_ALLOWLIST === "1")
      writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(routes, null, 2)}\n`);
    const allowlist = JSON.parse(
      readFileSync(ALLOWLIST_PATH, "utf8"),
    ) as string[];
    expect(routes).toEqual(allowlist);
  });

  it("registers no handler for a retired V1 route (they answer 410 through the middleware)", () => {
    const registered = new Set(routes.map(shape));
    const resurrected = RETIRED_API_ROUTES.filter((route) =>
      registered.has(shape(`${route.method} /${route.path}`)),
    ).map((route) => `${route.method} /${route.path}`);
    expect(resurrected).toEqual([]);
  });

  it("keeps the one live /internal/scan-jobs route and nothing else under it", () => {
    expect(
      routes.filter((route) => route.includes("/internal/scan-jobs")),
    ).toEqual(["POST /internal/scan-jobs/agent-stream-events"]);
  });

  it("has no duplicated route", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
