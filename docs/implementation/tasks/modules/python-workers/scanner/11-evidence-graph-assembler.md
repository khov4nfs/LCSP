---
task_id: MW-scan-py-011
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/09-ai-invocation-detector.md
  - python-workers/scanner/10-decision-flow-tracer.md
---

# Evidence Graph Assembler

## Outcome

Build a scan-local normalized graph from `TechnicalFinding` records and AST/CST/bridge analysis results. The graph captures structural relationships (calls, imports, data flows) needed for downstream intelligence and classification workers. Raw source code is never persisted in the graph — nodes contain metadata only.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/graph/node_types.py` | Create | Node type constants + `GraphNode` dataclass |
| `deepagents/tools/graph/scanner/graph/edge_types.py` | Create | Edge type constants + `GraphEdge` dataclass |
| `deepagents/tools/graph/scanner/graph/graph_builder.py` | Create | Build graph from findings + analysis results |
| `deepagents/tools/graph/scanner/graph/graph_serializer.py` | Create | Serialize graph to `ScanGraph` dict for evidence payload |

## Node Types

```python
NODE_TYPES = [
    "REPOSITORY",           # Root node — one per scan
    "FILE",                 # Source file (relative path, language, size_bytes)
    "MODULE",               # Python module / TS module namespace
    "FUNCTION",             # Function or method definition (name, line_number, is_async)
    "METHOD",               # Class method
    "CLASS",                # Class definition
    "CONTROLLER",           # NestJS/Express/FastAPI controller/router (detected by decorator)
    "ROUTE",                # HTTP route handler
    "AI_PROVIDER",          # External AI provider (openai, anthropic, google, etc.)
    "AI_MODEL_INVOCATION",  # Specific model call site (file_path, line_number, rule_id)
    "AI_INPUT",             # Input data node (variable name, kwarg name — no value)
    "AI_OUTPUT",            # Output assignment node (variable name — no value)
    "DECISION_RULE",        # Conditional/threshold using AI output
    "HUMAN_REVIEW_STEP",    # Human gating point
    "PACKAGE_DEPENDENCY",   # Package node (name, version, ecosystem, purl, is_ai_relevant)
    "UNSUPPORTED_FLOW",     # L4 boundary node
    "COVERAGE_GAP",         # Scan coverage limitation node
]
```

## Edge Types

```python
EDGE_TYPES = [
    "CONTAINS",         # FILE → FUNCTION, MODULE → CLASS, etc.
    "CALLS",            # FUNCTION → AI_MODEL_INVOCATION, FUNCTION → FUNCTION
    "IMPORTS",          # FILE/MODULE → PACKAGE_DEPENDENCY
    "PASSES_TO",        # AI_INPUT → AI_MODEL_INVOCATION
    "FLOWS_TO",         # AI_OUTPUT → DECISION_RULE, AI_OUTPUT → AI_INPUT (chained)
    "CONTROLS",         # DECISION_RULE → state-changing action node
    "REVIEWS",          # HUMAN_REVIEW_STEP → (intercepts) CONTROLS edge
    "CORROBORATES",     # Tool-to-tool: PACKAGE_DEPENDENCY → AI_MODEL_INVOCATION (SBOM confirms)
    "HAS_LIMITATION",   # NODE → COVERAGE_GAP | UNSUPPORTED_FLOW
]
```

## Graph Node Schema

```python
@dataclass
class GraphNode:
    node_id: str         # UUID
    node_type: str       # From NODE_TYPES
    label: str           # Human-readable: function name, file path, package name, etc.
    file_path: str | None        # Relative path — never absolute
    line_number: int | None
    attributes: dict             # Type-specific metadata (no source content)
    finding_ids: list[str]       # TechnicalFinding IDs this node was created from

# Example attributes by node type:
#   FILE: {"language": "python", "size_bytes": 4096, "line_count": 120}
#   FUNCTION: {"name": "process_application", "is_async": True, "line_count": 45}
#   AI_PROVIDER: {"provider_name": "openai", "library_group": "openai"}
#   AI_MODEL_INVOCATION: {"rule_id": "py-openai-chat-completions", "kwarg_names": ["model", "messages"]}
#   PACKAGE_DEPENDENCY: {"name": "openai", "version": "1.14.0", "purl": "pkg:pypi/openai@1.14.0", "is_ai_relevant": True}
```

## Graph Edge Schema

```python
@dataclass
class GraphEdge:
    edge_id: str
    edge_type: str       # From EDGE_TYPES
    source_node_id: str
    target_node_id: str
    confidence: float    # Inherited from triggering finding
    attributes: dict     # e.g. {"analysis_level": "L2"}
```

## Graph Assembly Rules

1. One `REPOSITORY` root node per scan — attributes: `{repo_name, commit_sha, language_breakdown}`.
2. One `FILE` node per analyzed file — `file_path` relative only.
3. One `FUNCTION`/`METHOD` node per detected function that contains an AI call site.
4. One `AI_PROVIDER` node per distinct `library_group` detected (e.g. one `openai` provider node).
5. One `AI_MODEL_INVOCATION` node per `TechnicalFinding` of type `AI_PROVIDER_USAGE` or `AI_FRAMEWORK_USAGE` or `AI_MODEL_INVOCATION`.
6. `PACKAGE_DEPENDENCY` node created for every `PackageDependency` with `is_ai_relevant = True`.
7. `CALLS` edge: `FUNCTION` → `AI_MODEL_INVOCATION` for each call site.
8. `IMPORTS` edge: `FILE` → `PACKAGE_DEPENDENCY` for each confirmed import.
9. `CORROBORATES` edge: `PACKAGE_DEPENDENCY` → `AI_MODEL_INVOCATION` when SBOM confirms package.
10. `FLOWS_TO` edge: `AI_OUTPUT` → `DECISION_RULE` when decision flow tracer detects direct flow.
11. `REVIEWS` edge: `HUMAN_REVIEW_STEP` → intercept point when `HUMAN_REVIEW_SIGNAL` detected.
12. `UNSUPPORTED_FLOW` node: created for each `UNSUPPORTED_DYNAMIC_FLOW` finding; `HAS_LIMITATION` edge from triggering function node.
13. `COVERAGE_GAP` node: created for each `SCAN_COVERAGE_LIMITATION` finding.
14. No raw source in any node/edge attribute. `kwarg_names` lists names only.

## Output Schema

```python
@dataclass
class ScanGraph:
    graph_id: str           # UUID
    schema_version: str     # "1.0"
    node_count: int
    edge_count: int
    nodes: list[dict]       # Serialized GraphNodes
    edges: list[dict]       # Serialized GraphEdges
    ai_provider_nodes: list[str]     # node_ids of AI_PROVIDER nodes
    ai_invocation_nodes: list[str]   # node_ids of AI_MODEL_INVOCATION nodes
    coverage_gap_nodes: list[str]    # node_ids of COVERAGE_GAP nodes
    unsupported_flow_nodes: list[str] # node_ids of UNSUPPORTED_FLOW nodes
```

## Business Rules

1. `file_path` in every node is relative — strip workspace prefix before graph creation.
2. No node attribute contains source code. Only: names, line numbers, sizes, language, rule_ids, kwarg_names (names only), booleans.
3. Node deduplication: if same `file_path` + `node_type` + `label` → reuse existing node, add `finding_ids`.
4. Graph is scan-local and transient — serialized into evidence payload, NOT persisted to DB separately.
5. Max nodes: 10,000 (emit `COVERAGE_GAP` if exceeded and truncate).
6. Max edges: 50,000 (truncate, record in `coverage_gap_nodes`).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | File with one OpenAI call | `REPOSITORY` → `FILE` → `FUNCTION` → `AI_MODEL_INVOCATION`, `AI_PROVIDER` (openai) |
| T02 | SBOM confirms `openai` present | `PACKAGE_DEPENDENCY` node + `CORROBORATES` edge to `AI_MODEL_INVOCATION` |
| T03 | LangChain agent with tools | `AI_DECISION_FLOW_SIGNAL` node, `CONTROLS` edge |
| T04 | Human review step detected | `HUMAN_REVIEW_STEP` node + `REVIEWS` edge |
| T05 | Dynamic call detected | `UNSUPPORTED_FLOW` node + `HAS_LIMITATION` edge from function node |
| T06 | Tool failure | `COVERAGE_GAP` node |
| T07 | `file_path` in node | Relative, no workspace prefix |
| T08 | Raw source in node attribute | Assertion error — not allowed |
| T09 | 10,001 nodes | Truncated at 10,000, `COVERAGE_GAP` added |
| T10 | `ScanGraph.ai_invocation_nodes` | Lists all `AI_MODEL_INVOCATION` node IDs |

## Definition of Done

- All 15 node types implemented.
- All 9 edge types implemented.
- `file_path` relative in all nodes.
- No source content in any attribute.
- `ScanGraph` serializable to JSON for evidence payload.
- Max node/edge limits enforced with `COVERAGE_GAP` emission.
