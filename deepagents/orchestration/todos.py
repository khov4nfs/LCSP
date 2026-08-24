"""Todo planning owned by the root orchestrator."""

from langchain.agents.middleware import TodoListMiddleware


# Deep Agents v0.7+ makes task planning opt-in. Keep exactly one todo list on the
# supervisor; ephemeral subagents execute one bounded pipeline stage each.
ROOT_TODO_MIDDLEWARE = TodoListMiddleware()
