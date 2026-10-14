"""AgentMiddleware for response localization and output normalization in LCSP Deep Agents."""

from __future__ import annotations

from typing import Any, Callable
from collections.abc import Awaitable

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, SystemMessage

from orchestration.context import LCSPRunContext, resolve_response_language
from orchestration.localization import (
    ResponseLocalizationConfig,
    atransform_response_text,
    atransform_structured_response,
    get_language_prompt_instruction,
    load_localization_config,
    transform_response_text,
    transform_structured_response,
)


class ResponseLocalizationMiddleware(AgentMiddleware):
    """Middleware ensuring Deep Agent responses conform to the user/system selected language.

    1. Injects dynamic response-language instructions into the main agent's system prompt before generation.
    2. Post-processes the final user-visible response (and user-facing structured fields) via a lightweight
       transform model to guarantee locale consistency and invariant preservation.
    """

    name = "response_localization_middleware"

    def __init__(
        self,
        config: ResponseLocalizationConfig | None = None,
        transform_model: Any | None = None,
    ) -> None:
        self.config = config or load_localization_config()
        self.transform_model = transform_model

    def _inject_language_prompt(self, request: ModelRequest) -> ModelRequest:
        """Inject dynamic response language directive for the primary model."""
        context = getattr(request.runtime, "context", None)
        raw_lang = getattr(context, "response_language", None)
        if isinstance(context, dict):
            raw_lang = context.get("response_language")
        target_locale = resolve_response_language(raw_lang)

        directive = get_language_prompt_instruction(target_locale)
        if request.system_message is None:
            new_content = [{"type": "text", "text": directive}]
        elif hasattr(request.system_message, "content_blocks") and request.system_message.content_blocks:
            new_content = list(request.system_message.content_blocks)
            new_content.append({"type": "text", "text": directive})
        else:
            base_text = str(getattr(request.system_message, "content", ""))
            new_content = [
                {"type": "text", "text": base_text},
                {"type": "text", "text": directive},
            ]
        return request.override(system_message=SystemMessage(content=new_content))


    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._inject_language_prompt(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._inject_language_prompt(request))

    def after_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        """Post-process the completed agent turn with the lightweight transform model."""
        if not self.config.enabled:
            return None

        context = getattr(runtime, "context", None)
        raw_lang = getattr(context, "response_language", None)
        if isinstance(context, dict):
            raw_lang = context.get("response_language")
        target_locale = resolve_response_language(raw_lang)

        updates: dict[str, Any] = {}

        # 1. If structured response is present, perform at most ONE schema-aware transform
        structured = state.get("structured_response") if isinstance(state, dict) else getattr(state, "structured_response", None)
        if structured is not None:
            transformed_structured, _ = transform_structured_response(
                structured,
                target_locale,
                model=self.transform_model,
                config=self.config,
            )
            if transformed_structured is not structured:
                updates["structured_response"] = transformed_structured
            return updates if updates else None

        # 2. Otherwise, transform the final user-visible AIMessage
        messages = list(state.get("messages", [])) if isinstance(state, dict) else list(getattr(state, "messages", []))
        if messages:
            last_message = messages[-1]
            # Only transform user-visible final AIMessage (not tool calls)
            if isinstance(last_message, AIMessage) and not getattr(last_message, "tool_calls", None):
                content = last_message.content
                if isinstance(content, list):
                    text = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
                else:
                    text = str(content)

                if text.strip():
                    transformed_text, _ = transform_response_text(
                        text,
                        target_locale,
                        model=self.transform_model,
                        config=self.config,
                    )
                    if transformed_text != text:
                        updated_message = AIMessage(
                            content=transformed_text,
                            id=getattr(last_message, "id", None),
                            additional_kwargs=getattr(last_message, "additional_kwargs", {}),
                            response_metadata=getattr(last_message, "response_metadata", {}),
                        )
                        updates["messages"] = [updated_message]

        return updates if updates else None

    async def aafter_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        """Asynchronously post-process the completed agent turn with the lightweight transform model."""
        if not self.config.enabled:
            return None

        context = getattr(runtime, "context", None)
        raw_lang = getattr(context, "response_language", None)
        if isinstance(context, dict):
            raw_lang = context.get("response_language")
        target_locale = resolve_response_language(raw_lang)

        updates: dict[str, Any] = {}

        # 1. If structured response is present, perform at most ONE async schema-aware transform
        structured = state.get("structured_response") if isinstance(state, dict) else getattr(state, "structured_response", None)
        if structured is not None:
            transformed_structured, _ = await atransform_structured_response(
                structured,
                target_locale,
                model=self.transform_model,
                config=self.config,
            )
            if transformed_structured is not structured:
                updates["structured_response"] = transformed_structured
            return updates if updates else None

        # 2. Otherwise, transform the final user-visible AIMessage asynchronously
        messages = list(state.get("messages", [])) if isinstance(state, dict) else list(getattr(state, "messages", []))
        if messages:
            last_message = messages[-1]
            # Only transform user-visible final AIMessage (not tool calls)
            if isinstance(last_message, AIMessage) and not getattr(last_message, "tool_calls", None):
                content = last_message.content
                if isinstance(content, list):
                    text = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
                else:
                    text = str(content)

                if text.strip():
                    transformed_text, _ = await atransform_response_text(
                        text,
                        target_locale,
                        model=self.transform_model,
                        config=self.config,
                    )
                    if transformed_text != text:
                        updated_message = AIMessage(
                            content=transformed_text,
                            id=getattr(last_message, "id", None),
                            additional_kwargs=getattr(last_message, "additional_kwargs", {}),
                            response_metadata=getattr(last_message, "response_metadata", {}),
                        )
                        updates["messages"] = [updated_message]

        return updates if updates else None

