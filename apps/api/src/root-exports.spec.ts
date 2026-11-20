import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("root module export specifiers", () => {
  it("uses standard NodeNext .js specifiers in index.ts without raw .ts extensions", () => {
    const indexPath = path.join(here, "index.ts");
    const content = readFileSync(indexPath, "utf8");
    const rawTsImports = content
      .split("\n")
      .filter((line) => line.includes('from "./') && line.includes('.ts";'));

    expect(rawTsImports).toEqual([]);
  });

  it("uses standard NodeNext .js specifiers in security.ts without raw .ts extensions", () => {
    const securityPath = path.join(here, "security.ts");
    const content = readFileSync(securityPath, "utf8");
    const rawTsImports = content
      .split("\n")
      .filter((line) => line.includes('from "./') && line.includes('.ts";'));

    expect(rawTsImports).toEqual([]);
  });
});
