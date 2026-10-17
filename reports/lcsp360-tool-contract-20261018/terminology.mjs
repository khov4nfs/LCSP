// Preserve every canonical check; only enlarge subprocess capture for the retained untracked archives.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.execFileSync;
childProcess.execFileSync = (file, args, options) => original(file, args, { maxBuffer: 64 * 1024 * 1024, ...options });
syncBuiltinESMExports();
await import("../../scripts/check-canonical-terminology.mjs");
