# Scanner project discovery

Phase 2 introduces a language-neutral project boundary without changing
semantic language support or the Program Evidence Graph. `ProjectDiscovery`
uses the deterministic `ProjectDetectorRegistry`; detectors read repository
manifests safely and never execute project code.

The default detectors recognize JavaScript/TypeScript `package.json`, Python
project manifests (`pyproject.toml`, setup metadata, and requirements files),
and several future ecosystem manifests for recognition only. Recognition of a
`.csproj`, `Gemfile`, `go.mod`, or similar file does not advertise a semantic
analyzer.

Project identity is derived only from normalized repository-relative root,
primary manifest path, and a safe manifest-defined name. Absolute workspace
paths, timestamps, enumeration order, and random identifiers are excluded.
Descriptors with the same root are merged deterministically, with manifest
paths retained. Nested projects receive the nearest containing project as
their parent. File ownership selects the most specific project root; files
outside discovered roots remain unowned.

Project/language outcomes reuse the Phase 1 status vocabulary and preserve
unsupported, failed, partial, and successful outcomes separately. Existing
Python and TS/JS native analyzer contracts, graph contracts, metrics, and
frontend/API behavior remain unchanged.

Future detectors can be added by implementing `ProjectDetector`, registering
it in `ProjectDetectorRegistry`, returning evidence-backed descriptors, and
adding deterministic hierarchy, deduplication, malformed-manifest, and
ownership tests.

## Project-scoped analyzer execution

After classification, `ProjectExecutionPlanner` creates deterministic
`AnalyzerExecutionUnit` values containing one project, one registered semantic
adapter language, and a sorted, de-duplicated file list. TypeScript and
JavaScript files owned by the same project share one TS/JS invocation. Nested
projects receive only files owned by the most-specific root; files outside all
roots use the internal `repository-unowned` bucket and remain analyzable.

The scan boundary invokes the existing canonical Python and TS/JS entrypoints
once per unit, then merges native results for the unchanged evidence pipeline.
Per-unit `ProjectLanguageResult` and aggregated `ProjectScanResult` values
retain capabilities, status, skipped files, coverage limitations, and
recoverable failures. Unsupported basic languages are explicit results and do
not receive a semantic adapter invocation. Analyzer-local failures are isolated
to their unit; privacy, graph-integrity, and evidence-integrity failures remain
fatal.
