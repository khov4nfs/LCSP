import { test, expect } from "@playwright/test";

test.describe("Admin Release Gate: RBAC & Security Isolation (Sentinel)", () => {
  test("asserts browser never sends worker credentials or hits internal worker endpoints during live navigation", async ({
    page,
  }) => {
    const interceptedHeaders: Record<string, string>[] = [];
    const interceptedUrls: string[] = [];

    page.on("request", (req) => {
      interceptedUrls.push(req.url());
      interceptedHeaders.push(req.headers());
    });

    // Navigate across web application surfaces
    await page.goto("/sign-in");
    await page.goto("/pricing");

    expect(interceptedUrls.length).toBeGreaterThan(0);

    // Verify network isolation assertions across all intercepted requests
    for (const headers of interceptedHeaders) {
      expect(headers["x-worker-api-key"]).toBeUndefined();
      expect(headers["worker_api_key"]).toBeUndefined();
    }

    for (const url of interceptedUrls) {
      expect(url).not.toContain("/internal/worker/");
    }
  });

  test("asserts unauthenticated access to protected workspace routes redirects to sign-in", async ({
    page,
  }) => {
    const response = await page.goto("/workspace");
    // Next.js server proxy redirects unauthenticated requests to /sign-in
    expect(page.url()).toContain("/sign-in");
  });
});
