# Unified System Evidence Graph Architecture Plan

## Status

PROPOSED TARGET ARCHITECTURE — follow-up evolution of Program Evidence Graph v2.

This document records the architecture decisions agreed while hardening the direct EngineeringRule assessment runtime. It defines the target graph, detection strategy, LLM semantic-enrichment boundary, rollout plan, and acceptance criteria.

The existing `ProgramEvidenceGraph` remains the migration base. The target is one graph artifact, not a separate technical graph plus a disconnected business graph.

## 1. Architecture decision

LCSP will evolve `ProgramEvidenceGraph v2` into a single **ProgramEvidenceGraph v3 / Unified System Evidence Graph** containing multiple logical semantic layers over one node/edge namespace, one provenance model, one traversal engine, one unresolved-frontier contract, and one immutable graph hash.

Logical layers:

```text
L0  Source / provenance
L1  Code structure
L2  Runtime and framework boundaries
L3  Data lineage
L4  AI system and model lifecycle
L5  Business process semantics
L6  Decision influence and human oversight
L7  Evidence confidence / origin / resolution state
```

The layers are logical views only. They MUST NOT become independently persisted graphs that require later technical-to-business reconciliation.

## 2. Why one unified graph

EngineeringRule questions are cross-layer by nature. LCSP must be able to traverse one continuous evidence path such as:

```text
HTTP/gRPC/Event input
  -> DATA_OBJECT
  -> transformation / validation
  -> AI model or AI capability
  -> AI_OUTPUT
  -> BUSINESS_DECISION
  -> HUMAN_REVIEW or HUMAN_OVERRIDE
  -> STATUS_CHANGE / BUSINESS_OUTCOME
  -> REPOSITORY_ACCESS
  -> DATABASE
  -> affected DATA_SUBJECT
```

A split `PGE + BusinessGraph` design would require another mapping layer between technical nodes and business nodes, creating additional ambiguity exactly where LCSP needs deterministic provenance.

## 3. Authority boundary

The graph represents technical and business-system evidence. It does not establish legal applicability.

- Static scanners may establish deterministic repository/runtime/data-flow facts.
- Deterministic graph resolvers may establish bounded structural relationships.
- LLM semantic enrichment may propose business meanings only when backed by immutable graph/source provenance.
- The EngineeringRule Planner may use the graph to decide technical investigation relevance.
- The Planner MUST NOT assign legal risk tiers, determine legal applicability, or emit compliance verdicts.
- `COMPLIANT`, `NON_COMPLIANT`, and `UNKNOWN` remain deterministic evaluator outputs.

## 4. Evidence origins and trust states

Every graph node/edge that carries semantic meaning must expose its evidence origin and resolution state.

Recommended fields:

```text
origin:
  STATIC_ANALYSIS
  CONTRACT_ANALYSIS
  FRAMEWORK_RESOLUTION
  DATA_LINEAGE
  AI_LIFECYCLE_ANALYSIS
  LLM_SEMANTIC_ENRICHMENT

resolutionState:
  OBSERVED
  CORROBORATED
  INFERRED
  UNRESOLVED

supportRefs[]:
  immutable node/edge/source-anchor refs
```

Rules:

1. Static deterministic facts may be `OBSERVED`.
2. A fact composed from multiple deterministic signals may be `CORROBORATED`.
3. LLM-created business semantics begin as `INFERRED`/proposal state and require provenance validation before being admitted to the graph.
4. Missing or dynamic paths become `UNRESOLVED`; silence is never evidence of absence.
5. An LLM proposal without valid support refs is rejected.

## 5. Expand the canonical graph vocabulary

### 5.1 Existing technical layer

Preserve and continue using existing node families such as:

```text
FILE / MODULE / CLASS / METHOD / FUNCTION / CALL_SITE
HTTP_ROUTE / COMMAND / QUERY / EVENT / QUEUE
DATABASE / TABLE / ENTITY / REPOSITORY_ACCESS
EXTERNAL_SERVICE / EXTERNAL_API
AI_PROVIDER / AI_MODEL_INVOCATION / AI_INPUT / AI_OUTPUT
BUSINESS_ACTION / STATUS_CHANGE / APPROVAL / REJECTION
HUMAN_REVIEW / HUMAN_OVERRIDE
PERSONAL_DATA / SENSITIVE_DATA
UNRESOLVED_DYNAMIC_TARGET
```

### 5.2 Add first-class data-lineage entities

Add or model explicitly:

```text
DATA_OBJECT
DATA_ASSET
DATA_CONTRACT
PROTOCOL_MESSAGE
MEDIA_OBJECT
```

A `DATA_OBJECT` represents lineage identity, not a variable name. It must survive aliases and protocol/serialization boundaries.

Example:

```text
req.body.payload
 -> buffer
 -> grpc VerifyRequest.payload
 -> queue event.data
 -> parser input
```

must be representable as one lineage chain even when every local identifier is renamed.

### 5.3 Add AI system lifecycle entities

LCSP must scan all three AI-system modes:

```text
A. Consume AI
   application -> third-party/local AI endpoint

B. Embed AI
   business process -> model inference -> decision/action

C. Build AI
   dataset -> training -> evaluation -> model artifact -> deployment -> inference -> monitoring -> retraining
```

Add concepts such as:

```text
AI_SYSTEM
AI_CAPABILITY
MODEL
MODEL_ARTIFACT
DATASET
DATA_PREPARATION
TRAINING_JOB
FINE_TUNING_JOB
EVALUATION_JOB
MODEL_REGISTRY
MODEL_ENDPOINT
MODEL_DEPLOYMENT
MODEL_MONITORING
MODEL_DRIFT_SIGNAL
RETRAINING_JOB
```

The scanner must not collapse `model.fit`, `Trainer.train`, model registry usage, and inference into the generic `AI_FRAMEWORK_USAGE`/`AI_MODEL_INVOCATION` category.

### 5.4 Add business semantic entities

Add logical business entities inside the same graph:

```text
BUSINESS_PROCESS
PROCESS_STEP
BUSINESS_DECISION
BUSINESS_OUTCOME
BUSINESS_OBJECT
ACTOR
DATA_SUBJECT
```

Representative edges:

```text
PART_OF_PROCESS
PRECEDES
PERFORMED_BY
AFFECTS_SUBJECT
USES_DATA
INVOKES_AI
INFLUENCES_DECISION
WRITES_BUSINESS_STATE
PRODUCES_OUTCOME
REQUIRES_HUMAN_REVIEW
```

### 5.5 Add AI lifecycle edges

Representative edges:

```text
TRAINS_MODEL_WITH
FINE_TUNES
EVALUATES_MODEL
PRODUCES_MODEL_ARTIFACT
REGISTERS_MODEL
DEPLOYS_MODEL
SERVES_MODEL
MONITORS_MODEL
RETRAINS_MODEL
```

Prefer extending the canonical vocabulary deliberately rather than encoding business semantics in arbitrary free-form attributes.

## 6. Sensitive and personal data detection strategy

### 6.1 Identifier taxonomy is only a seed

Existing hints such as `cccd`, `national_id`, `fingerprint`, `faceprint`, and `voiceprint` remain useful as low-cost seed signals, but they MUST NOT be authoritative classification.

Variable/field names can be renamed or intentionally generic:

```text
payload
blob
x
input
file
value
```

Sensitive-data detection therefore becomes **semantic data-lineage classification**.

### 6.2 Evidence classes

Data classification must combine multiple evidence classes:

```text
identifier hints
+ HTTP/OpenAPI/GraphQL request/response contracts
+ gRPC/protobuf message contracts
+ event/queue message schemas
+ DB/entity/schema fields and persistence behavior
+ media/file characteristics
+ parser/OCR/vision/embedding/identity-processing behavior
+ external service/SDK capability
+ AI/model processing behavior
+ deterministic lineage between source, transforms, sinks and decisions
+ optional LLM semantic corroboration
```

No single weak signal is sufficient for a closed sensitive-data fact.

### 6.3 Protocol boundaries must preserve lineage

Semantic lineage must survive:

```text
HTTP / REST
GraphQL
gRPC / protobuf
WebSocket
Kafka / RabbitMQ / event bus
CQRS command/query dispatch
serialization / deserialization
JSON/base64/binary encoding
DTO/entity mapping
DI / consumer boundaries
```

Edges such as serialization, deserialization, mapping, aliasing, queue publishing/consuming and external sends/receives must preserve the associated `DATA_OBJECT` lineage.

### 6.4 Behavior-based classification

Examples:

```text
image/media
 -> face detection
 -> feature extraction / embedding
 -> similarity/identity match
 => BIOMETRIC_PROCESSING_CANDIDATE
```

```text
image/PDF
 -> OCR
 -> structured identity extraction
 -> document-number/identity verification
 => IDENTITY_DOCUMENT_PROCESSING_CANDIDATE
```

```text
audio
 -> speaker/voice embedding
 -> identity comparison
 => VOICE_BIOMETRIC_PROCESSING_CANDIDATE
```

The final persisted semantic should be based on the bounded evidence path, not on the spelling of one variable.

## 7. AI decision influence and human replacement/oversight

LCSP must introduce a deterministic **AI Decision Influence Trace** instead of relying on proximity heuristics such as “AI call and DB save occur in the same file”.

Target traversal:

```text
AI_MODEL_INVOCATION / MODEL_ENDPOINT
 -> AI_OUTPUT
 -> parser / transformation / score / rank / recommendation
 -> BUSINESS_DECISION
 -> STATUS_CHANGE / APPROVAL / REJECTION / BUSINESS_OUTCOME
 -> PERSISTS_TO / WRITES_TO
 -> DATABASE or EXTERNAL_EFFECT
```

Then inspect the same bounded path for:

```text
HUMAN_REVIEW
HUMAN_OVERRIDE
manual approval
review queue
human-owned decision step
```

Technical states should be explicit and non-legal, for example:

```text
AI_INFLUENCES_DECISION
AI_PERSISTS_DECISION
HUMAN_IN_LOOP_PRESENT
AUTOMATED_DECISION_CANDIDATE
DECISION_PATH_UNRESOLVED
```

`AUTOMATED_DECISION_CANDIDATE` means a technical candidate only. It MUST NOT be treated as a legal conclusion that AI unlawfully replaced a human.

Negative evidence is allowed only when the relevant path is bounded, complete, non-truncated and has no unresolved framework/protocol frontier.

## 8. Framework and distributed-flow resolution

Consumer, DI, dispatch and protocol boundaries are continuation boundaries, not endpoints.

Invariant:

```text
consumer / queue / event / command bus / query bus / DI / dispatcher / protocol hop
!= end of business flow
```

Every such boundary must end in exactly one of:

```text
RESOLVED -> concrete symbol/method/downstream system
UNRESOLVED -> explicit UNRESOLVED_DYNAMIC_TARGET
```

Never:

```text
boundary -> nothing
```

The post-test-filter framework finalizer introduced on PR #261 remains part of this architecture because filtering can remove a test-only handler/provider and expose a production dead-end.

## 9. AI lifecycle detection

Implement a dedicated lifecycle extractor that works across dependencies, AST/CST/structural facts, manifests and deployment artifacts.

Initial capability families:

```text
DATASET_LOAD / DATASET_BUILD
FEATURE_PREPARATION
MODEL_DEFINE
MODEL_TRAIN
MODEL_FINE_TUNE
MODEL_EVALUATE
MODEL_SAVE / EXPORT
MODEL_REGISTER
MODEL_DEPLOY
MODEL_SERVE / INFER
MODEL_MONITOR
DRIFT_DETECT
MODEL_RETRAIN
```

Initial ecosystems should include the packages already recognized by LCSP, including at minimum:

```text
PyTorch
TensorFlow / Keras
scikit-learn
XGBoost / LightGBM
Transformers / Hugging Face
MLflow-like model registry/deployment patterns where present
local inference stacks
cloud model endpoints already covered by provider detection
```

The architecture should be adapter-based: framework-specific detectors emit canonical lifecycle facts into Semantic IR rather than leaking framework-specific vocabulary into EngineeringRules.

## 10. LLM Business Semantic Enricher

### 10.1 Purpose

Static analysis is strong at structure but weak at business meaning. The LLM semantic-enrichment pass should infer bounded business semantics from already resolved graph subgraphs.

Example input subgraph:

```text
POST /loan/application
 -> CreateApplicationCommand
 -> EligibilityService
 -> riskModel.predict
 -> score threshold
 -> application.status = REJECTED
 -> repository.save
```

Possible proposal:

```text
BUSINESS_PROCESS: Loan application assessment
BUSINESS_DECISION: Applicant eligibility
AI_CAPABILITY: Risk scoring
DATA_SUBJECT: Applicant
BUSINESS_OUTCOME: Application rejected
```

### 10.2 The model never directly mutates the graph

Required flow:

```text
Technical graph
 -> deterministic bounded subgraph clustering
 -> LLM semantic proposal
 -> deterministic proposal validator
 -> accepted semantic nodes/edges
 -> unified graph artifact
```

Every proposal must include immutable support refs. Unknown refs, unsupported links, legal conclusions, invented system actors or unsupported domain labels fail closed.

### 10.3 Multi-pass enrichment

Prefer bounded passes over one whole-repository prompt:

```text
Pass 1: cluster technical subgraphs into business-flow candidates
Pass 2: infer process/step/actor/subject/decision semantics
Pass 3: link AI/data/human-control/model-lifecycle nodes to those semantics
Pass 4: deterministic provenance and graph-consistency validation
```

LLM context should be graph summaries and bounded source projections, not unrestricted raw repository source.

## 11. Unified graph construction pipeline

Target pipeline:

```text
Repository Snapshot
        |
        v
Language parsers / static analyzers
        |
        v
Semantic IR
        |
        +--> framework/DI/consumer/dispatch resolution
        +--> protocol/contract extraction
        +--> DB/persistence extraction
        +--> data-lineage construction
        +--> AI invocation detection
        +--> AI model-lifecycle extraction
        +--> decision/human-control extraction
        |
        v
Test/spec/source-role filtering
        |
        v
Post-filter framework finalization
        |
        v
Deterministic Technical + Data + AI Graph
        |
        v
Business-flow clustering
        |
        v
LLM Business Semantic Enricher
        |
        v
Deterministic provenance/consistency gate
        |
        v
ProgramEvidenceGraph v3 / Unified System Evidence Graph
        |
        +--> EngineeringRule Planner
        +--> bounded Investigator
        +--> deterministic Evaluator
```

## 12. Planner integration

The Planner should stop consuming broad raw hit counts.

Target planning candidate should include bounded material signals such as:

```text
businessProcesses[]
affectedSubjects[]
dataCategories[]
aiCapabilities[]
modelLifecycleStages[]
decisionInfluenceState
humanOversightState
materialSourceRefs[]
unresolvedFrontiers[]
```

These are technical investigation-relevance signals only.

Example:

```text
Business process: customer onboarding
AI capability: identity verification
Affected subject: customer
Data: identity document + facial biometric
Decision influence: verification result updates account status
Human oversight: unresolved
Model lifecycle: inference-only / third-party
```

This is materially stronger than `AI_MODEL_INVOCATION=5`, `DATABASE=3`, `SENSITIVE_DATA=2`.

## 13. Search and evidence policy

The source-role policy added on PR #261 remains mandatory:

- test/spec/mock/fixture sources are excluded from persisted graph evidence and normal code search;
- script/example/generated/tooling evidence is not allowed to independently close a criterion;
- source-less framework identities created only by removed tests are pruned;
- criterion-scoped provenance remains bounded and minimal;
- source search should prefer material production implementation rather than generic node-type saturation.

The unified graph MUST preserve these policies. Business semantic enrichment must never reintroduce test-only or tooling-only evidence as material production behavior.

## 14. Implementation roadmap

### Phase 0 — Contract and migration boundary

Deliverables:

1. Define ProgramEvidenceGraph v3 schema additions.
2. Add `origin`, `resolutionState`, and bounded `supportRefs` contracts.
3. Define new canonical node/edge vocabulary.
4. Define backward-compatible v2 reader/migration behavior.
5. Lock privacy rules: no raw PII, secrets, complete source bodies or unrestricted prompts in persisted graph.

Acceptance:

- existing v2 assessment artifacts remain readable;
- v3 graph hash remains deterministic;
- no legal authority is moved into graph enrichment.

### Phase 1 — Semantic Data Lineage

Deliverables:

1. First-class `DATA_OBJECT` lineage.
2. HTTP/OpenAPI/GraphQL contract adapters.
3. gRPC/protobuf adapter.
4. event/queue contract lineage.
5. DTO/entity/DB mapping.
6. serialization/deserialization lineage preservation.
7. behavior-based sensitive-data corroboration.

Acceptance fixtures must include intentionally renamed variables (`x`, `payload`, `blob`) and still reconstruct the same sensitive-data flow.

### Phase 2 — AI System Lifecycle

Deliverables:

1. lifecycle canonical facts and vocabulary;
2. PyTorch/TensorFlow/Keras/sklearn/XGBoost/Transformers adapters;
3. model artifact/save/register/deploy/serve detection;
4. monitoring/drift/retraining signals;
5. third-party vs local/custom model technical ownership signals where evidence supports the distinction.

Acceptance:

- distinguish inference-only application from repository that trains/maintains its own model;
- do not infer lifecycle stages solely from dependency presence.

### Phase 3 — Decision Influence + Human Oversight

Deliverables:

1. `inspect_ai_decision_influence_path` deterministic graph query;
2. AI output -> business decision -> persistent/external effect tracing;
3. human review/override detection on the same path;
4. explicit unresolved state through DI/consumer/dispatch/protocol boundaries;
5. bounded-path negative evidence policy.

Acceptance:

- AI recommendation followed by human approval is not classified as autonomous final action;
- AI output directly changing persisted user eligibility on a closed path becomes an automated-decision technical candidate;
- an unresolved consumer/dispatch hop produces UNKNOWN/unresolved, never absence.

### Phase 4 — Business Semantic Enrichment

Deliverables:

1. deterministic graph clustering;
2. provider-native structured LLM proposal schema;
3. process/step/actor/subject/decision/outcome proposal nodes;
4. support-ref validator;
5. hallucination/domain/legal-authority guards;
6. accepted semantic facts merged into the same graph namespace.

Acceptance:

- every accepted LLM semantic node/edge has immutable support refs;
- unsupported proposals are rejected without degrading deterministic graph facts;
- model cannot author legal risk tier/applicability/verdict fields.

### Phase 5 — Planner + Investigator consumption

Deliverables:

1. Planner candidate projection from unified graph semantics;
2. per-rule planner decision audit (`SELECT/SKIP`, reason, basis, material refs);
3. investigator tools for business process, data lineage, AI lifecycle and decision influence;
4. evidence claims remain criterion-scoped and source-role filtered;
5. evaluator remains deterministic.

Acceptance:

- unrelated domain EngineeringRules can be skipped despite generic AI usage elsewhere;
- relevant rules are selected from material business/data/AI evidence;
- planner fallback still fails safe to broader investigation rather than false exclusion.

## 15. Recommended new deterministic graph tools

Add canonical read-only tools incrementally:

```text
inspect_data_lineage
inspect_protocol_path
inspect_ai_lifecycle
inspect_ai_decision_influence_path
inspect_business_process
find_affected_subjects
find_sensitive_data_flows
```

Each tool must return:

```text
nodes
edges
paths
truncated
continuationFrontiers
unresolvedFrontiers
evidenceRefs/supportRefs
```

Tools expose evidence, not legal conclusions.

## 16. Test strategy

Required fixture families:

1. HTTP -> service -> DB sensitive-data flow with meaningless variable names.
2. gRPC -> consumer -> DB sensitive-data flow.
3. queue/event serialization-deserialization preserving lineage.
4. face/identity processing without sensitive keywords in local identifiers.
5. third-party LLM application with no custom model lifecycle.
6. custom sklearn/XGBoost model training + artifact + API inference.
7. Transformer fine-tuning + model registry/deployment.
8. AI recommendation -> human approval -> DB.
9. AI score -> automatic rejection -> DB.
10. unresolved CQRS/DI/consumer boundary -> unresolved decision path.
11. test-only handler/provider/data flow proving source-role filter cannot create production behavior.
12. LLM business proposal with valid refs accepted; invented unsupported proposal rejected.

## 17. Observability

Add safe structured events for each enrichment boundary, for example:

```text
DATA_LINEAGE_GRAPH_READY
AI_LIFECYCLE_GRAPH_READY
DECISION_INFLUENCE_GRAPH_READY
BUSINESS_FLOW_CLUSTERS_READY
BUSINESS_SEMANTIC_PROPOSAL_READY
BUSINESS_SEMANTIC_PROPOSAL_REJECTED
UNIFIED_SYSTEM_GRAPH_READY
```

Log only counts, IDs, states, bounded categories and immutable refs. Do not log raw source, PII or secret values.

## 18. Non-goals

This architecture does not attempt to:

- infer actual runtime values from static code when evidence is unavailable;
- claim a person is legally affected solely because a code variable resembles a person;
- claim a business domain solely from package names or folder names;
- let an LLM invent graph facts without provenance;
- establish legal applicability, legal risk tier, violation, certification or compliance verdict;
- treat missing static edges across unresolved/dynamic boundaries as proof that a control is absent.

## 19. Final target

The target assessment context becomes:

```text
Wizard context
        +
ProgramEvidenceGraph v3 / Unified System Evidence Graph
  - technical structure
  - distributed/framework flow
  - semantic data lineage
  - sensitive/personal data flows
  - AI consumption + custom model lifecycle
  - business process semantics
  - decision influence
  - human oversight
  - immutable provenance/unresolved state
        +
EngineeringRule contracts
        |
        v
EngineeringRule Planner
        |
        v
selected bounded investigation
        |
        v
deterministic EngineeringRule evaluation
```

This evolves LCSP from a scanner that primarily recognizes applications using AI into an evidence system capable of reasoning over a business AI system: what data enters it, how that data moves, whether the organization consumes or builds AI, where AI participates in business decisions, where humans remain in control, what business outcomes are affected, and exactly which immutable technical evidence supports each conclusion.
