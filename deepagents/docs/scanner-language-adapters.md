# Scanner language adapter extension point

The semantic scanner keeps file classification and basic/fallback analysis
in `inventory/language`, while semantic analyzers are exposed through
`analyzers.registry.LanguageAnalyzerRegistry`. The default registry registers
Python, TypeScript/JavaScript, Ruby, C#, Java, Kotlin, PHP, Go, Rust, Swift,
Objective-C, and Dart. Ruby uses Tree-sitter
Ruby for non-executing syntax analysis.

Each adapter implements the `LanguageAnalyzer` protocol and returns a
`CanonicalAnalyzerResult`. The result is an execution envelope around the
existing native analyzer output; it reports `SUCCESS`, `PARTIAL`, `FAILED`,
or `UNSUPPORTED`, explicit `AnalyzerCapability` flags, skipped files and
coverage/dynamic-flow limitations. Native results remain available so the
existing evidence and graph contracts are unchanged.

Adapter registration is deterministic (the registry sorts by adapter
language and rejects duplicates). Adapters must preserve the existing
semantic fact identity/key contract: keys are deterministic, include enough
path/project/language context to avoid collisions, and must not contain
timestamps or temporary paths. ProgramGraphBuilder remains responsible for
canonical graph IDs and deduplication.

## Adding a future language adapter

1. Implement `LanguageAnalyzer` for the language's existing parser/tool.
2. Translate native output into `CanonicalAnalyzerResult` without creating a
   parallel graph model or recalculating evidence downstream.
3. Declare only capabilities the analyzer actually provides and report
   unsupported/partial files explicitly.
4. Register the adapter in the default registry after focused contract,
   determinism, and compatibility tests are in place.

Ruby supports modules, classes, instance/singleton methods, static requires,
Gemfile declarations, visible calls, and conservative provider-call evidence.
Dynamic dispatch is retained as limited/unresolved evidence. Cross-language
resolution and additional language adapters remain outside this phase.

C# uses the Tree-sitter C# grammar in the worker's existing Python runtime. It
extracts bounded syntax facts (namespaces, classes, interfaces, records, enums,
methods, attributes, usings, and calls), safe `.csproj` PackageReference and
ProjectReference metadata, and conservative AI-call evidence. It never runs
`dotnet restore`, `dotnet build`, MSBuild, or repository code. Type resolution,
reflection, and runtime configuration remain partial or unresolved.

Tree-sitter was selected over Roslyn for this pilot because it supplies
deterministic syntax/source locations without requiring a .NET runtime,
`dotnet restore`, MSBuild, or repository-controlled build execution. Roslyn
remains a future option if type-aware resolution is required, but would need a
separate runtime and dependency-isolation design.

ASP.NET Core is a separate registered framework adapter. It requires static
web-project evidence (`Microsoft.NET.Sdk.Web` or ASP.NET package references),
then enriches existing C# symbols with controller roles, attribute routes,
minimal API routes, and bounded DI registrations. It does not create
ASP.NET-specific graph nodes, execute the application, or infer dynamic route
targets. Non-web .NET projects remain C# projects without ASP.NET semantics.

Java and Kotlin use the Tree-sitter Java/Kotlin grammars in the existing Python
worker. They extract bounded package/import/declaration/inheritance/call facts
and statically parse Maven POM or Gradle dependency declarations. Maven and
Gradle are never executed; dynamic properties, reflection, and unresolved build
logic remain partial evidence.

Spring is a separate registered framework adapter. It detects Spring evidence
from dependencies, enriches existing Java/Kotlin symbols with controller,
service, repository, entity, route, and scheduled-job roles, and emits canonical
HTTP facts. Java and Kotlin routes share the same downstream resolver and do not
create framework-specific graph nodes.

PHP uses the Tree-sitter PHP grammar in the worker runtime and statically parses
Composer metadata. It extracts namespaces, classes, interfaces, traits,
functions, methods, imports, calls, attributes, and conservative dynamic-call
limitations without executing PHP or Composer. Laravel and Symfony are separate
registered framework adapters. They detect application-level Composer evidence,
reuse PHP symbols, and emit bounded canonical route/controller, DI, ORM, job,
and source-provenance facts. Laravel's transitive Symfony dependencies do not
select the Symfony adapter.

Go and Rust use Tree-sitter parsers in the existing worker runtime. Their
adapters statically extract declarations, imports, calls, and module metadata
from `go.mod`/`Cargo.toml` without invoking Go or Cargo toolchains. Reflection,
indirect calls, generated code, and macro expansion remain explicit limitations.
Go/Rust route and client evidence uses the same canonical HTTP vocabulary and
repository resolver as every other language.

Swift, Objective-C, and Dart use Tree-sitter grammars in the same worker
runtime. Their adapters extract bounded declarations, imports, calls, and
static package metadata from SwiftPM/Podfiles/pubspec files without invoking
Xcode, CocoaPods, Dart, or Flutter tooling. iOS, Android, React Native, and
Flutter are project-scoped framework adapters that enrich existing language
symbols with entry-point, screen/component, native-integration, permission,
and conservative navigation evidence. Dynamic navigation, generated mobile
code, and runtime platform behavior remain unresolved or partial.

Mobile navigation uses the language-neutral `NAVIGATES_TO` edge. Permission
declarations and dependency presence are retained as capability evidence and
are never treated as proof of runtime usage or AI invocation.

## Repository-wide cross-project resolution

After language and framework facts are normalized, `CrossReferenceResolver`
runs once in the graph assembly boundary. It consumes only canonical facts and
project descriptors, never parser-specific AST nodes. It currently resolves
strong `.csproj`, Go `replace`, and Cargo path project relationships and evidence-bound HTTP call
to route relationships. Route matching is method-aware and supports literal
paths against `{id}`/`:id` templates; multiple plausible targets remain
unresolved with coverage evidence. External or dynamic URLs are not guessed.

Resolved edges retain source and target provenance and reuse existing
`DEPENDS_ON`/`CALLS_API` vocabulary. Resolver failures and ambiguity do not
discard successful language/framework facts. Future messaging, gRPC, GraphQL,
and workspace-package resolvers should register as additional canonical-fact
passes rather than adding language-specific branches.

## Protocol coverage

Protocol evidence uses the existing canonical vocabulary and is resolved after
language/framework extraction:

| Domain | Static extraction | Resolution | Limitations |
| --- | --- | --- | --- |
| Messaging | queue/event/command producer and consumer facts | provider + resource kind + literal name | dynamic or ambiguous resources remain unresolved |
| GraphQL | `.graphql`/`.gql` operations and resolver decorators | canonical operation to existing functions/methods | schema inference and endpoint association are partial |
| gRPC | protobuf package/service/RPC/request/response facts | qualified service/package/method matching | generated clients and ambiguous implementations remain partial |
| Command/Query/Event | framework and architecture evidence | canonical handler edges | application events remain distinct from transport resources |

No protocol-specific node or edge vocabulary was added. Protocol failures are
isolated and preserve successful language/framework facts.

## Framework adapter extension point

Framework semantics are a separate, project-scoped layer over language facts.
`frameworks.registry.FrameworkAdapterRegistry` runs registered detectors first,
then invokes an adapter only for a project with evidence for that framework.
`FrameworkAdapter` returns a `FrameworkAnalysisResult` containing the existing
canonical `SemanticProgram`, capabilities, provenance, and explicit
`SUCCESS`/`PARTIAL`/`FAILED`/`UNSUPPORTED` status. A framework adapter must not
create a parallel graph or duplicate language symbols.

The default framework registry includes Rails, ASP.NET Core, Spring, Laravel,
Symfony, iOS, Android, React Native, and Flutter. Detection is evidence-bound;
a source extension or directory name alone is not sufficient. The Rails pilot is
registered by default. Detection requires a safely parsed
`Gemfile` declaration for the `rails` gem; a `.rb` file or directory name is
not sufficient. The static adapter reuses Ruby symbols, recognizes bounded
controller/model/job roles, and extracts statically resolvable route
declarations without executing Rails or repository Ruby code. Dynamic routes,
metaprogramming, and unsupported framework behavior remain explicit
limitations. A Rails failure preserves the Ruby language result and other
project results.

The Python/TypeScript framework registry now also covers Django, Flask, FastAPI,
Express, NestJS, React, Next.js, Vue, Nuxt, Angular, Svelte, SvelteKit, and
Electron. Backend adapters emit canonical `HTTP_ROUTE`/`HANDLED_BY` facts;
frontend adapters emit UI route/component facts and `NAVIGATES_TO` rather than
misclassifying browser navigation as a server endpoint. Detection is package or
manifest based, and dynamic router mounting, runtime DI, generated pages, and
embedded-template behavior remain partial.

| Framework | Detection | Routes/navigation | DI/roles | Overall |
| --- | --- | --- | --- | --- |
| Django | supported | partial HTTP routes | partial ORM/commands | partial |
| Flask | supported | partial HTTP routes | unsupported/partial | partial |
| FastAPI | supported | supported/partial | partial `Depends` | partial |
| Express | supported | supported/partial HTTP routes | partial middleware | partial |
| NestJS | supported | supported decorators | partial DI/CQRS | partial |
| React | supported | partial UI navigation | partial | partial |
| Next.js | supported | partial UI/server route split | partial | partial |
| Vue | supported | partial UI navigation | partial | partial |
| Nuxt | supported | partial UI/server route split | partial | partial |
| Angular | supported | partial UI navigation | partial DI | partial |
| Svelte | supported | partial UI navigation | partial | partial |
| SvelteKit | supported | partial UI/server route split | partial | partial |
| Electron | supported | partial IPC/navigation | partial main/renderer/preload | partial |

## Capability and graph compatibility notes

Language adapters provide bounded static coverage, not compiler or runtime
execution. Symbols, imports/dependencies, calls, routes, framework roles, AI
invocations, and mobile navigation are reported only where repository evidence
supports them; reflection, dynamic dispatch, generated code, and runtime
configuration remain partial or unresolved. Python/TypeScript framework logic
and protocol domains such as messaging, GraphQL, and gRPC have uneven or partial
depth and are follow-on coverage work, not an implication of language support.

Mobile navigation uses the additive, language-neutral `NAVIGATES_TO` edge. The
strict graph validator accepts it, the existing stable edge identity deduplicates
it, and projections that only show execution paths ignore it safely. Historical
graphs without the edge remain readable, while unknown edge types still fail
closed. No graph node types, public API contracts, metric authority, or global
identity rules are changed.

### Adding a future framework adapter

1. Add evidence-based detection for the framework and keep it separate from
   semantic analysis.
2. Implement the language-neutral `FrameworkAdapter` protocol and declare
   only capabilities that are actually extracted.
3. Reuse canonical language symbol keys and existing node/edge vocabulary;
   report unresolved behavior instead of guessing relationships.
4. Register the adapter deterministically and isolate operational failures
   from language facts and other projects.
5. Add project-scoped, negative-detection, provenance, determinism, and
   failure-isolation tests before documenting capability levels.

### Protocol client-linking closure

GraphQL operation documents emit canonical `GRAPHQL_OPERATION` facts with a
client role. The repository resolver links a client operation to exactly one
server operation only when operation type/name and an explicit endpoint or
service identity disambiguate the target; dynamic endpoints and same-name
multi-service candidates remain unresolved. Existing resolver/function symbols
are reused.

gRPC client call facts may carry normalized `grpcPackage`, `grpcService`, and
`grpcMethod` attributes. They resolve through the existing `GRPC_METHOD`
contract identity (`package/service/method`) and then to the canonical server
implementation. Generated code is supporting contract evidence, not first-party
application symbols; no code generation or compilation is executed.

The protocol acceptance matrix covers backend/frontend/polyglot boundaries,
with dedicated mobile and AI suites. Quality assertions cover deterministic
output, source provenance, malformed/partial isolation, and ambiguity-safe
unresolved behavior.

The acceptance matrix is exercised by an integrated protocol fixture covering
HTTP, UI navigation, GraphQL client/server association, gRPC client/contract/
server linking, messaging producer/consumer convergence, and command-handler
evidence. Dedicated mobile and AI suites complete the backend/frontend/mobile/
AI/polyglot categories. The quality matrix asserts repeatability, provenance,
ambiguity-safe unresolved behavior, and isolated partial failures.

## Remaining language coverage floor

Phase 14 makes every remaining LCSP language category explicit in the
classifier and analyzer registry. Scala, Elixir, Clojure, Lua, R, and Haskell
are recognized-only adapters: they produce `UNSUPPORTED` with a deterministic
coverage limitation rather than silently disappearing or being analyzed as a
different language. C, C++, shell, PowerShell, SQL, and Solidity use bounded
structural adapters and return `PARTIAL` with canonical facts and source
provenance where static syntax permits.

| Language | Analysis path | Symbols/imports/calls | Domain evidence | Dynamic behavior | Overall |
| --- | --- | --- | --- | --- | --- |
| Scala | recognized-only | unavailable | JVM project metadata only | explicit limitation | recognized-only |
| Elixir/Phoenix | recognized-only | unavailable | project recognition only | explicit limitation | recognized-only |
| Clojure | recognized-only | unavailable | project recognition only | explicit limitation | recognized-only |
| C | structural adapter | bounded functions/includes/calls | none | preprocessor/dynamic partial | structural |
| C++ | structural adapter | bounded classes/includes/calls | none | templates/macros partial | structural |
| Bash/Shell | structural adapter | functions/source/commands | literal process/HTTP evidence | eval/dynamic commands unresolved | structural |
| PowerShell | structural adapter | functions/modules/cmdlets | literal command evidence | dynamic invocation unresolved | structural |
| SQL | structural adapter | migration/schema facts | tables and bounded DDL | dynamic SQL partial | structural |
| Lua | recognized-only | unavailable | none | explicit limitation | recognized-only |
| R | recognized-only | unavailable | none | explicit limitation | recognized-only |
| Haskell | recognized-only | unavailable | none | explicit limitation | recognized-only |
| Solidity | structural adapter | contracts/functions/events/calls | bounded contract metadata | low-level calls unresolved | structural |

No language-specific PGE node or edge types were added. Structural outputs use
existing `FUNCTION`, `CLASS`, `PACKAGE_DEPENDENCY`, `CALL_SITE`, `TABLE`, and
`EVENT` vocabulary. Toolchains, compilers, interpreters, migration runners,
and blockchain build tools are never executed. Generated/vendor/build outputs
remain governed by existing source-role and bounded-file policies.
