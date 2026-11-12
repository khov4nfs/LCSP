import { describe, it, expect } from "@jest/globals";
import { diagnosticDatabaseEndpoint } from "../scripts/lib/diagnostic-database.js";

describe("Diagnostic credential-safe database validation", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "accepts explicit PostgreSQL loopback %s",
    (host) => {
      expect(
        diagnosticDatabaseEndpoint(`postgresql://${host}:55438/disposable`)
          .hostname,
      ).toBe(host);
    },
  );
  it.each([
    undefined,
    "SECRET_SENTINEL://bad credential",
    "https://localhost/db",
    "postgresql://remote.invalid/db",
    "postgresql://localhost/",
  ])("rejects invalid addresses without exposing their contents", (raw) => {
    try {
      diagnosticDatabaseEndpoint(raw);
      throw Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/required/);
      expect((error as Error).stack).not.toContain("SECRET_SENTINEL");
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
