import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  // Do not index Corepack / pnpm packages stored in the local test cache:
  // duplicate package.json names in that cache create false haste collisions.
  modulePathIgnorePatterns: ["<rootDir>/.cache/", "<rootDir>/dist/"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: "(src|test)/.*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/test/jest-env.ts"],
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)\\.js$": "<rootDir>/src/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  // Native coverage avoids retaining Babel instrumentation for the full API
  // in the single process used by the database-backed CI coverage run.
  coverageProvider: "v8",
  // CI consumes LCOV; skip the HTML tree and per-file console table.
  coverageReporters: ["text-summary", "lcovonly", "json"],
  coverageDirectory: "../coverage",
  maxWorkers: 1,
  workerIdleMemoryLimit: "768MB",
};

export default config;
