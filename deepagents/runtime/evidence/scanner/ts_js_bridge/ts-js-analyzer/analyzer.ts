import {
  CallExpression,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
} from "ts-morph";
import { relative, resolve, sep } from "node:path";

export const SCHEMA_VERSION = "1.0";
export const ANALYZER_VERSION = "1.0.0";

type FindingType =
  | "AI_PROVIDER_USAGE"
  | "AI_FRAMEWORK_USAGE"
  | "SYSTEM_PROMPT_DETECTED"
  | "DYNAMIC_SYSTEM_PROMPT_REFERENCE"
  | "RAG_USAGE_SIGNAL"
  | "MODEL_OUTPUT_PARSER_SIGNAL"
  | "UNSUPPORTED_DYNAMIC_FLOW";

type AnalyzerRule = {
  ruleId: string;
  packageName: string;
  patterns: string[];
  findingType: FindingType;
  baseConfidence: number;
};

export type TsJsFinding = {
  file_path: string;
  line_number: number;
  finding_type: FindingType;
  rule_id: string;
  import_source: string | null;
  call_expression: string;
  kwarg_names: string[];
  analysis_level: "L1";
  has_dynamic_call: boolean;
  confidence: number;
};

export type UnsupportedDynamicFlow = {
  file_path: string;
  line_number: number;
  reason: string;
};

export type AnalyzerResult = {
  schema_version: string;
  analyzer_version: string;
  files_analyzed: number;
  files_skipped: number;
  findings: TsJsFinding[];
  unsupported_dynamic_flows: UnsupportedDynamicFlow[];
  coverage_limitations: Array<{ file_path: string; reason: string }>;
};

export type AnalyzerRequest = {
  workspace_path: string;
  max_analysis_depth?: number;
  include_files?: string[] | null;
};

const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const EXCLUDED_PARTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);

export const TS_JS_RULES: AnalyzerRule[] = [
  {
    ruleId: "ts-openai-chat-completions",
    packageName: "openai",
    patterns: ["client.chat.completions.create", "openai.chat.completions.create"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.9,
  },
  {
    ruleId: "ts-openai-embeddings",
    packageName: "openai",
    patterns: ["client.embeddings.create", "openai.embeddings.create"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.9,
  },
  {
    ruleId: "ts-anthropic-messages",
    packageName: "@anthropic-ai/sdk",
    patterns: ["client.messages.create", "anthropic.messages.create"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.9,
  },
  {
    ruleId: "ts-google-genai",
    packageName: "@google/generative-ai",
    patterns: ["model.generateContent", "genAI.getGenerativeModel"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.9,
  },
  {
    ruleId: "ts-langchain-llm",
    packageName: "langchain",
    patterns: ["ChatOpenAI", "ChatAnthropic", "chain.invoke", "chain.stream"],
    findingType: "AI_FRAMEWORK_USAGE",
    baseConfidence: 0.85,
  },
  {
    ruleId: "ts-langchain-prompt",
    packageName: "langchain",
    patterns: ["ChatPromptTemplate.fromMessages", "PromptTemplate.fromTemplate"],
    findingType: "SYSTEM_PROMPT_DETECTED",
    baseConfidence: 0.8,
  },
  {
    ruleId: "ts-langchain-rag",
    packageName: "langchain",
    patterns: ["createRetrievalChain", "VectorStoreRetriever"],
    findingType: "RAG_USAGE_SIGNAL",
    baseConfidence: 0.85,
  },
  {
    ruleId: "ts-llamaindex-query",
    packageName: "llamaindex",
    patterns: [
      "VectorStoreIndex.fromDocuments",
      "index.asQueryEngine",
      "queryEngine.query",
    ],
    findingType: "RAG_USAGE_SIGNAL",
    baseConfidence: 0.85,
  },
  {
    ruleId: "ts-hf-inference",
    packageName: "@huggingface/inference",
    patterns: ["HfInference", "hf.textGeneration", "hf.questionAnswering"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.8,
  },
  {
    ruleId: "ts-generic-predict",
    packageName: "*",
    patterns: [".predict", ".generate", ".infer", ".classify"],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.4,
  },
  {
    ruleId: "ts-system-prompt-var",
    packageName: "*",
    patterns: ["systemPrompt", "SYSTEM_PROMPT", "SystemMessage"],
    findingType: "SYSTEM_PROMPT_DETECTED",
    baseConfidence: 0.7,
  },
  {
    ruleId: "ts-dynamic-prompt",
    packageName: "*",
    patterns: ["template.format"],
    findingType: "DYNAMIC_SYSTEM_PROMPT_REFERENCE",
    baseConfidence: 0.65,
  },
  {
    ruleId: "ts-output-parser",
    packageName: "langchain",
    patterns: ["JsonOutputParser", "PydanticOutputParser", "StructuredOutputParser"],
    findingType: "MODEL_OUTPUT_PARSER_SIGNAL",
    baseConfidence: 0.8,
  },
  {
    ruleId: "ts-local-http-inference",
    packageName: "*",
    patterns: [
      "localhost:11434",
      "/v1/chat/completions",
      "ollama.chat",
      "generateText",
    ],
    findingType: "AI_PROVIDER_USAGE",
    baseConfidence: 0.75,
  },
];

export function analyzeWorkspace(request: AnalyzerRequest): AnalyzerResult {
  const workspace = resolve(request.workspace_path);
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const files = sourceFilePaths(workspace, request.include_files ?? null);

  let filesSkipped = 0;
  const sourceFiles: SourceFile[] = [];
  for (const file of files) {
    try {
      sourceFiles.push(project.addSourceFileAtPath(file));
    } catch {
      filesSkipped += 1;
    }
  }

  const findings: TsJsFinding[] = [];
  const unsupportedDynamicFlows: UnsupportedDynamicFlow[] = [];
  for (const sourceFile of sourceFiles) {
    const importMap = importSources(sourceFile);
    const relativePath = relativeToWorkspace(workspace, sourceFile.getFilePath());

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const dynamicFlow = dynamicFlowForCall(call, relativePath);
      if (dynamicFlow) {
        unsupportedDynamicFlows.push(dynamicFlow);
        continue;
      }

      findings.push(...findingsForCall(call, relativePath, importMap));
    }

    findings.push(...promptVariableFindings(sourceFile, relativePath, importMap));
  }

  return {
    schema_version: SCHEMA_VERSION,
    analyzer_version: ANALYZER_VERSION,
    files_analyzed: sourceFiles.length,
    files_skipped: filesSkipped,
    findings: dedupeFindings(findings),
    unsupported_dynamic_flows: dedupeFlows(unsupportedDynamicFlows),
    coverage_limitations: [],
  };
}

function sourceFilePaths(workspace: string, includeFiles: string[] | null): string[] {
  if (includeFiles) {
    return includeFiles
      .filter((file) => JS_TS_EXTENSIONS.some((extension) => file.endsWith(extension)))
      .map((file) => resolve(workspace, file))
      .filter((file) => file.startsWith(workspace + sep));
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(
    JS_TS_EXTENSIONS.map(
      (extension) => `${workspace.replaceAll("\\", "/")}/**/*${extension}`,
    ),
  );
  return project
    .getSourceFiles()
    .map((file: SourceFile) => file.getFilePath())
    .filter(
      (file: string) =>
        !relativeToWorkspace(workspace, file)
          .split("/")
          .some((part: string) => EXCLUDED_PARTS.has(part)),
    );
}

function importSources(sourceFile: SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const source = declaration.getModuleSpecifierValue();
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) {
      imports.set(defaultImport.getText(), source);
    }
    for (const namedImport of declaration.getNamedImports()) {
      imports.set(namedImport.getName(), source);
    }
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) {
      imports.set(namespaceImport.getText(), source);
    }
  }
  return imports;
}

function findingsForCall(
  call: CallExpression,
  relativePath: string,
  importMap: Map<string, string>,
): TsJsFinding[] {
  const expression = callExpressionName(call);
  if (!expression) {
    return [];
  }

  const packages = packagesForExpression(expression, importMap);
  return TS_JS_RULES.filter((rule) => ruleMatches(rule, expression, packages))
    .map((rule) => ({
      file_path: relativePath,
      line_number: call.getStartLineNumber(),
      finding_type: rule.findingType,
      rule_id: rule.ruleId,
      import_source: firstImportSource(packages, rule.packageName),
      call_expression: expression,
      kwarg_names: objectLiteralPropertyNames(call),
      analysis_level: "L1" as const,
      has_dynamic_call: false,
      confidence: rule.baseConfidence,
    }));
}

function promptVariableFindings(
  sourceFile: SourceFile,
  relativePath: string,
  importMap: Map<string, string>,
): TsJsFinding[] {
  const findings: TsJsFinding[] = [];
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = identifier.getText();
    const rule = TS_JS_RULES.find((candidate) => candidate.patterns.includes(name));
    if (!rule || !["ts-system-prompt-var"].includes(rule.ruleId)) {
      continue;
    }
    findings.push({
      file_path: relativePath,
      line_number: identifier.getStartLineNumber(),
      finding_type: rule.findingType,
      rule_id: rule.ruleId,
      import_source: firstImportSource(packagesForExpression(name, importMap), rule.packageName),
      call_expression: name,
      kwarg_names: [],
      analysis_level: "L1",
      has_dynamic_call: false,
      confidence: rule.baseConfidence,
    });
  }

  for (const template of sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    if (!template.getText().includes("systemPrompt")) {
      continue;
    }
    const rule = TS_JS_RULES.find((candidate) => candidate.ruleId === "ts-dynamic-prompt");
    if (!rule) {
      continue;
    }
    findings.push({
      file_path: relativePath,
      line_number: template.getStartLineNumber(),
      finding_type: rule.findingType,
      rule_id: rule.ruleId,
      import_source: null,
      call_expression: "template_expression",
      kwarg_names: [],
      analysis_level: "L1",
      has_dynamic_call: false,
      confidence: rule.baseConfidence,
    });
  }
  return findings;
}

function dynamicFlowForCall(
  call: CallExpression,
  relativePath: string,
): UnsupportedDynamicFlow | null {
  if (!Node.isElementAccessExpression(call.getExpression())) {
    return null;
  }
  return {
    file_path: relativePath,
    line_number: call.getStartLineNumber(),
    reason: "dynamic property access on AI client object",
  };
}

function ruleMatches(rule: AnalyzerRule, expression: string, packages: Set<string>): boolean {
  if (rule.packageName !== "*" && !packages.has(rule.packageName)) {
    return false;
  }
  return rule.patterns.some((pattern) => {
    const normalized = pattern.replace(/\($/, "");
    if (normalized.startsWith(".")) {
      return expression.endsWith(normalized.slice(1));
    }
    return expression === normalized || expression.endsWith(`.${normalized}`);
  });
}

function callExpressionName(call: CallExpression): string {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression)) {
    return expression.getText();
  }
  if (Node.isNewExpression(expression)) {
    return expression.getText();
  }
  return "";
}

function packagesForExpression(expression: string, importMap: Map<string, string>): Set<string> {
  const root = expression.split(".")[0] ?? expression;
  const packages = new Set<string>();
  const direct = importMap.get(root);
  if (direct) {
    packages.add(direct);
  }
  for (const source of importMap.values()) {
    packages.add(source);
  }
  packages.add("*");
  return packages;
}

function firstImportSource(packages: Set<string>, packageName: string): string | null {
  if (packageName !== "*" && packages.has(packageName)) {
    return packageName;
  }
  return [...packages].find((item) => item !== "*") ?? null;
}

function objectLiteralPropertyNames(call: CallExpression): string[] {
  const firstArg = call.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return [];
  }
  return firstArg.getProperties().flatMap((property: Node) => {
    if (Node.isPropertyAssignment(property)) {
      return [property.getName()];
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      return [property.getName()];
    }
    return [];
  });
}

function relativeToWorkspace(workspace: string, filePath: string): string {
  return relative(workspace, resolve(filePath)).replaceAll("\\", "/");
}

function dedupeFindings(findings: TsJsFinding[]): TsJsFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [
      finding.file_path,
      finding.line_number,
      finding.rule_id,
      finding.call_expression,
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeFlows(flows: UnsupportedDynamicFlow[]): UnsupportedDynamicFlow[] {
  const seen = new Set<string>();
  return flows.filter((flow) => {
    const key = [flow.file_path, flow.line_number, flow.reason].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
