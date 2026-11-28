import { assertDedicatedTestDatabaseUrl } from "./support/auth-workspace-test-helpers.js";

describe("assertDedicatedTestDatabaseUrl Guard", () => {
  it("accepts valid local loopback test database URLs", () => {
    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public",
      ),
    ).not.toThrow();

    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/lcsp_api_e2e",
      ),
    ).not.toThrow();

    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432/my_test_db_test",
      ),
    ).not.toThrow();
  });

  it("strictly forbids lcsp_local and development/production databases even if LCSP_TEST_POSTGRES_DB is configured", () => {
    const originalEnv = process.env.LCSP_TEST_POSTGRES_DB;
    try {
      // Simulate malicious or accidental env setting attempting to legitimize lcsp_local
      process.env.LCSP_TEST_POSTGRES_DB = "lcsp_local";

      expect(() =>
        assertDedicatedTestDatabaseUrl(
          "postgresql://postgres:postgres@127.0.0.1:5432/lcsp_local",
        ),
      ).toThrow(
        /Safety guard: (Database name.*targets a local\/development\/production database|LCSP_TEST_POSTGRES_DB=.*cannot target local\/dev\/prod databases)/,
      );

      // Even with LCSP_TEST_POSTGRES_DB set to a forbidden name, other forbidden DBs fail
      expect(() =>
        assertDedicatedTestDatabaseUrl(
          "postgresql://postgres:postgres@127.0.0.1:5432/lcsp_dev",
        ),
      ).toThrow(
        /Safety guard: (Database name.*targets a local\/development\/production database|LCSP_TEST_POSTGRES_DB=.*cannot target local\/dev\/prod databases)/,
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LCSP_TEST_POSTGRES_DB;
      } else {
        process.env.LCSP_TEST_POSTGRES_DB = originalEnv;
      }
    }
  });

  it("strictly rejects when LCSP_TEST_POSTGRES_DB itself points to a non-test database", () => {
    const originalEnv = process.env.LCSP_TEST_POSTGRES_DB;
    try {
      process.env.LCSP_TEST_POSTGRES_DB = "production_db";
      expect(() =>
        assertDedicatedTestDatabaseUrl(
          "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public",
        ),
      ).toThrow(
        /LCSP_TEST_POSTGRES_DB.*is invalid.*must end with '_test' or '_e2e'/,
      );
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LCSP_TEST_POSTGRES_DB;
      } else {
        process.env.LCSP_TEST_POSTGRES_DB = originalEnv;
      }
    }
  });

  it("rejects remote or non-loopback hostnames even if database name contains test", () => {
    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://user:pass@db.production.internal:5432/lcsp_api_test",
      ),
    ).toThrow(/Safety guard: Test database host must be local loopback/);

    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://user:pass@192.168.1.100:5432/lcsp_api_test",
      ),
    ).toThrow(/Safety guard: Test database host must be local loopback/);
  });

  it("rejects local databases that lack _test or _e2e suffix", () => {
    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432/somedb",
      ),
    ).toThrow(
      /Safety guard: Test database name must end with '_test' or '_e2e'/,
    );

    expect(() =>
      assertDedicatedTestDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/analytics_warehouse",
      ),
    ).toThrow(
      /Safety guard: Test database name must end with '_test' or '_e2e'/,
    );
  });

  it("rejects malformed database URLs without leaking credentials in error message", () => {
    let thrownError: Error | null = null;
    try {
      assertDedicatedTestDatabaseUrl(
        "postgresql://user:super_secret_password@malformed-url:9999999",
      );
    } catch (err) {
      thrownError = err as Error;
    }
    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("Invalid DATABASE_URL");
    expect(thrownError?.message).not.toContain("super_secret_password");
  });
});
