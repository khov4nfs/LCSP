import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const preloadSource = await readFile(
  new URL("./node-mac-fix.cjs", import.meta.url),
  "utf8",
);
const apiSource = ts.transpileModule(
  await readFile(
    new URL("../apps/api/src/patch-net-tos.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  },
).outputText;
const launcherSource = await readFile(
  new URL("./run.mjs", import.meta.url),
  "utf8",
);

function install(source, net, platform = "darwin", optIn = "1") {
  vm.runInNewContext(source, {
    require(specifier) {
      assert.equal(specifier, "node:net");
      return net;
    },
    exports: {},
    process: {
      platform,
      env: optIn === undefined ? {} : { LCSP_NODE_DARWIN_TOS_COMPAT: optIn },
    },
  });
}

for (const [label, source] of [
  ["preload", preloadSource],
  ["API", apiSource],
]) {
  test(
    label + " leaves every other platform or disabled option unchanged",
    () => {
      for (const [platform, optIn] of [
        ["linux", "1"],
        ["win32", "1"],
        ["darwin", ""],
        ["darwin", "0"],
        ["darwin", "true"],
      ]) {
        const original = function () {
          throw { code: "EINVAL" };
        };
        const net = { Socket: { prototype: { setTypeOfService: original } } };
        install(source, net, platform, optIn);
        assert.equal(net.Socket.prototype.setTypeOfService, original);
        assert.throws(
          () => original(),
          (error) => error.code === "EINVAL",
        );
      }
    },
  );

  test(label + " skips a missing native method", () => {
    const prototype = {};
    install(source, { Socket: { prototype } });
    assert.equal(Object.hasOwn(prototype, "setTypeOfService"), false);
  });

  test(label + " preserves native success, receiver and arguments", () => {
    const receiver = {};
    const result = {};
    let calls = 0;
    const net = {
      Socket: {
        prototype: {
          setTypeOfService(tos) {
            calls++;
            assert.equal(this, receiver);
            assert.equal(tos, 72);
            return result;
          },
        },
      },
    };
    install(source, net);
    assert.equal(
      net.Socket.prototype.setTypeOfService.call(receiver, 72),
      result,
    );
    assert.equal(calls, 1);
  });

  test(label + " suppresses only the opted-in EINVAL operation", () => {
    const receiver = {};
    let calls = 0;
    const net = {
      Socket: {
        prototype: {
          setTypeOfService() {
            calls++;
            throw Object.assign(new Error("unsupported"), { code: "EINVAL" });
          },
        },
      },
    };
    install(source, net);
    assert.equal(
      net.Socket.prototype.setTypeOfService.call(receiver, 72),
      receiver,
    );
    assert.equal(calls, 1);
  });

  test(label + " rethrows all unrelated errors unchanged", () => {
    for (const failure of [
      Object.assign(new Error("permission"), { code: "EPERM" }),
      new Error("EINVAL"),
      "EINVAL",
      null,
      7,
    ]) {
      const net = {
        Socket: {
          prototype: {
            setTypeOfService() {
              throw failure;
            },
          },
        },
      };
      install(source, net);
      assert.throws(
        () => net.Socket.prototype.setTypeOfService(72),
        (error) => error === failure,
      );
    }
  });

  test(label + " installation is idempotent", () => {
    const net = {
      Socket: {
        prototype: {
          setTypeOfService() {
            return this;
          },
        },
      },
    };
    install(source, net);
    const once = net.Socket.prototype.setTypeOfService;
    install(source, net);
    assert.equal(net.Socket.prototype.setTypeOfService, once);
  });
}

test("preload and API entrypoint share one compatibility wrapper", () => {
  for (const sources of [
    [preloadSource, apiSource],
    [apiSource, preloadSource],
  ]) {
    const net = {
      Socket: {
        prototype: {
          setTypeOfService() {
            return this;
          },
        },
      },
    };
    install(sources[0], net);
    const once = net.Socket.prototype.setTypeOfService;
    install(sources[1], net);
    assert.equal(net.Socket.prototype.setTypeOfService, once);
  }
});

function buildEnvironment(platform, env) {
  const start = launcherSource.indexOf("function buildSpawnEnv(target) {");
  const end = launcherSource.indexOf("function hardenLangSmithEnv(env) {");
  assert.ok(start >= 0 && end > start);
  const build = vm.runInNewContext(
    launcherSource.slice(start, end) + "\nbuildSpawnEnv;",
    {
      process: { platform, env },
      path,
      repoRoot: "/owned workspace/lcsp",
      isDarwin: platform === "darwin",
      hardenLangSmithEnv() {},
    },
  );
  return build({ env: {} });
}

test("launcher injects only explicit Darwin opt-in and preserves caller options", () => {
  for (const [platform, optIn] of [
    ["linux", "1"],
    ["win32", "1"],
    ["darwin", undefined],
    ["darwin", "0"],
  ]) {
    const env = {
      NODE_OPTIONS: "--trace-warnings",
      LCSP_NODE_DARWIN_TOS_COMPAT: optIn,
    };
    assert.equal(
      buildEnvironment(platform, env).NODE_OPTIONS,
      "--trace-warnings",
    );
    assert.equal(env.NODE_OPTIONS, "--trace-warnings");
  }
  const env = {
    NODE_OPTIONS: "--trace-warnings",
    LCSP_NODE_DARWIN_TOS_COMPAT: "1",
  };
  const once = buildEnvironment("darwin", env);
  assert.equal(
    once.NODE_OPTIONS,
    '--trace-warnings --require="/owned workspace/lcsp/scripts/node-mac-fix.cjs"',
  );
  assert.equal(
    buildEnvironment("darwin", once).NODE_OPTIONS,
    once.NODE_OPTIONS,
  );
  assert.equal(env.NODE_OPTIONS, "--trace-warnings");
});
