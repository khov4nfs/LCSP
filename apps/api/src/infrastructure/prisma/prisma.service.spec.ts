import { describe, expect, it, jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../config/config.types.js";
import { prismaConnectionConfig, PrismaService } from "./prisma.service.js";

describe("PrismaService & prismaConnectionConfig", () => {
  describe("prismaConnectionConfig", () => {
    it("R01: fails closed when database URL is empty or whitespace", () => {
      expect(() => prismaConnectionConfig("", "")).toThrow(
        "DATABASE_URL must be a non-empty PostgreSQL connection URL",
      );
      expect(() => prismaConnectionConfig("   ", "")).toThrow(
        "DATABASE_URL must be a non-empty PostgreSQL connection URL",
      );
    });

    it("R02: rejects non-postgres connection protocols", () => {
      expect(() =>
        prismaConnectionConfig("mysql://root:pass@localhost:3306/db", ""),
      ).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
    });

    it("R03: preserves connection options and appends UTC timezone", () => {
      const result = prismaConnectionConfig(
        "postgresql://user:pass@localhost:5432/lcsp?sslmode=require&options=-c%20statement_timeout=5000",
        "",
      );

      const parsedUrl = new URL(result.connectionString);
      expect(parsedUrl.searchParams.get("sslmode")).toBe("require");
      expect(parsedUrl.searchParams.get("options")).toContain(
        "-c statement_timeout=5000 -c timezone=UTC",
      );
      expect(result.options).toBe("-c statement_timeout=5000 -c timezone=UTC");
    });
  });

  describe("PrismaService dependency injection", () => {
    it("R04: resolves connection configuration from ConfigService when injected", () => {
      const getSpy = jest.fn((key: string, options?: unknown) => {
        void options;
        if (key === "database") {
          return {
            url: "postgresql://config-user:config-pass@localhost:5432/config_db",
          };
        }
        return undefined;
      });
      const mockConfigService = {
        get: getSpy,
      } as unknown as ConfigService<AppConfig, true>;

      const service = new PrismaService(mockConfigService);
      expect(service).toBeDefined();
      expect(getSpy).toHaveBeenCalledWith("database", {
        infer: true,
      });
    });
  });
});
