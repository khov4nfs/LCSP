#!/usr/bin/env node
import { analyzeWorkspace, AnalyzerRequest } from "./analyzer.js";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function main(): void {
  const workspace = readArg("--workspace");
  const requestText = readArg("--request");
  if (!workspace || !requestText) {
    process.stderr.write("missing --workspace or --request\n");
    process.exitCode = 2;
    return;
  }

  let request: AnalyzerRequest;
  try {
    const parsed = JSON.parse(requestText) as Partial<AnalyzerRequest>;
    request = {
      ...parsed,
      workspace_path: workspace,
    };
  } catch {
    process.stderr.write("invalid request json\n");
    process.exitCode = 2;
    return;
  }

  const result = analyzeWorkspace(request);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
