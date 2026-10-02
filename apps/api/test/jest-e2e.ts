import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "..",
  testEnvironment: "node",
  testRegex: "test/.*\\.e2e-spec\\.ts$",
  setupFiles: [
    "<rootDir>/test/jest-env.ts",
    "<rootDir>/test/jest-e2e-rabbitmq.ts",
  ],
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
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  maxWorkers: 1,
  workerIdleMemoryLimit: "768MB",
  testTimeout: 30000,
};

export default config;
