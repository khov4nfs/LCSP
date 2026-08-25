# Managed Deep Agents LangChain Native Runtime Policy

LCSP Managed Deep Agents must use the LangChain and Deep Agents framework as the
LLM execution layer. Do not add new provider clients, tool-call protocols,
structured-output parsers, prompt-safety filters, fallback dispatchers, or retry
loops under a runtime infrastructure LLM package.

## Required Patterns

- Tools must be LangChain tools built with `langchain.tools.tool` and typed input
  schemas. Tool functions may use `ToolRuntime` for state, context, store,
  stream writer, execution info, or server info.
- Structured output must be requested through `create_agent(...,
  response_format=...)`, using Pydantic/dataclass/TypedDict schemas or explicit
  `ProviderStrategy`/`ToolStrategy` for JSON schema.
- Guardrails must be LangChain middleware, including built-in PII/HITL middleware
  where applicable and custom middleware for LCSP policy checks.
- Retry, fallback, rate limit, tracing, early termination, and model/tool-call
  control must be implemented as LangChain middleware attached to the agent or
  graph node.

## Migration Boundary

The legacy `deepagents/runtime/infrastructure/llm` package has been deleted.
The event-boundary factory no longer constructs or injects a custom runtime
client, and runtime configuration no longer accepts the
`LLM_PRIMARY_*`, `LLM_FALLBACK_*`, budget, pricing, or custom-provider settings.
Provider credentials use the standard LangChain integration variables, while
model selection uses the `LCSP_*_MODEL` `provider:model` policy variables.

Classification, reporting, legal-rule planning/compilation, and EngineeringRule
investigation now invoke `langchain.agents.create_agent` directly. Investigation
graph and code-context operations are native `@tool` functions, claims use
`response_format`, and framework middleware owns model retry, PII redaction, and
tool-call limits. The custom orchestration client, provider fallback client, and
model-budget runtime have been deleted and must not be reintroduced.
