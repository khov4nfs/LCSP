import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

for (const scenario of ["drain", "resume", "unsupported", "invalid"]) {
  test(`native deployment drain: ${scenario}`, async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      assert.equal(req.headers["x-worker-api-key"], "fixture-worker-key");
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({
        method: req.method,
        body: body ? JSON.parse(body) : null,
      });
      res.setHeader("content-type", "application/json");
      res.statusCode = scenario === "unsupported" ? 404 : 200;
      res.end(
        JSON.stringify(
          scenario === "invalid"
            ? { ok: true, data: {} }
            : {
                ok: scenario !== "unsupported",
                data: {
                  quiescent: requests.length > 1 || scenario === "resume",
                },
              },
        ),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const child = spawn(
        process.execPath,
        [
          "scripts/drain-agent-runtime.mjs",
          ...(scenario === "resume" ? ["--resume-admission"] : []),
        ],
        {
          env: {
            ...process.env,
            LCSP_DEPLOY_ENV_FILE: "/dev/null",
            WORKER_API_KEY: "fixture-worker-key",
            LCSP_AGENT_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      const [code] = await once(child, "exit");
      assert.equal(code === 0, ["drain", "resume"].includes(scenario), output);
      assert.equal(output.includes("fixture-worker-key"), false);
      assert.deepEqual(requests[0], {
        method: "POST",
        body: { draining: scenario !== "resume" },
      });
      assert.equal(requests.length, scenario === "drain" ? 2 : 1);
      if (scenario === "drain") assert.equal(requests[1].method, "GET");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
