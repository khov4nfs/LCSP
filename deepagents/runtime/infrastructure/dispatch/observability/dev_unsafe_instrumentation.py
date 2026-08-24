"""Install development-only raw tracing around LCSP runtime boundaries.

The instrumentation is deliberately outside domain implementations so enabling
local observability does not alter scanner, orchestration, agentic-tool, API,
LLM provider/fallback, authorization, or persistence semantics. It wraps the
existing public/private runtime methods and emits their exact arguments/results
through :mod:`tools.common.platform.dev_unsafe_trace`.

Nothing in this module is active unless ``LCSP_DEV_UNSAFE_TRACE=true``.
Production activation is rejected by ``unsafe_dev_trace_enabled``.
"""

from __future__ import annotations

import functools
import inspect
from typing import Any

from tools.common.platform.dev_unsafe_trace import (
    emit_dev_unsafe_trace,
    unsafe_dev_trace_enabled,
)


_INSTALLED = False


def install_dev_unsafe_instrumentation() -> None:
    """Patch runtime boundaries once when explicit unsafe development tracing is enabled."""
    global _INSTALLED
    if _INSTALLED or not unsafe_dev_trace_enabled():
        return

    _install_llm_trace()
    _install_http_client_trace()
    _install_agentic_trace()
    _INSTALLED = True
    emit_dev_unsafe_trace(
        "DEV_UNSAFE_TRACE_INSTALLED",
        warning=(
            "Raw development tracing is active; logs may contain credentials, "
            "source code, prompts, model responses, idempotency keys, PII, and tokens."
        ),
    )


def _install_llm_trace() -> None:
    """Trace Deep Agents/fallback calls without changing provider behavior."""
    from tools.common.llm import deep_agent_client, fallback_client

    original_redact_string = deep_agent_client.redact_string

    @functools.wraps(original_redact_string)
    def traced_redact_string(text: str) -> str:
        caller_frame = inspect.currentframe().f_back
        caller = caller_frame.f_code.co_name if caller_frame is not None else "unknown"
        emit_dev_unsafe_trace(
            "DEV_LLM_REDACTION_INPUT_RAW",
            caller=caller,
            value=text,
        )
        rendered = original_redact_string(text)
        emit_dev_unsafe_trace(
            "DEV_LLM_REDACTION_OUTPUT",
            caller=caller,
            value=rendered,
        )
        return rendered

    deep_agent_client.redact_string = traced_redact_string

    original_complete = deep_agent_client.DeepAgentClient.complete

    @functools.wraps(original_complete)
    def traced_complete(self, prompt: str, workflow_run_id: str, node_name: str, max_tokens=None, correlationId=None):
        emit_dev_unsafe_trace(
            "DEV_LLM_REQUEST_RAW",
            operation="complete",
            provider=self.provider,
            model=self.model,
            api_key=self.api_key,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
            prompt=prompt,
        )
        try:
            response = original_complete(
                self,
                prompt,
                workflow_run_id,
                node_name,
                max_tokens,
                correlationId,
            )
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_LLM_ERROR_RAW",
                operation="complete",
                provider=self.provider,
                model=self.model,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_LLM_RESPONSE_NORMALIZED",
            operation="complete",
            provider=self.provider,
            model=self.model,
            response=response,
        )
        return response

    deep_agent_client.DeepAgentClient.complete = traced_complete

    original_complete_with_tools = deep_agent_client.DeepAgentClient.complete_with_tools

    @functools.wraps(original_complete_with_tools)
    def traced_complete_with_tools(
        self,
        prompt: str,
        *,
        tools,
        workflow_run_id: str,
        node_name: str,
        max_tokens=None,
        correlationId=None,
    ):
        emit_dev_unsafe_trace(
            "DEV_LLM_REQUEST_RAW",
            operation="complete_with_tools",
            provider=self.provider,
            model=self.model,
            api_key=self.api_key,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
            prompt=prompt,
            tools=tools,
        )
        try:
            response = original_complete_with_tools(
                self,
                prompt,
                tools=tools,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=max_tokens,
                correlationId=correlationId,
            )
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_LLM_ERROR_RAW",
                operation="complete_with_tools",
                provider=self.provider,
                model=self.model,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_LLM_RESPONSE_NORMALIZED",
            operation="complete_with_tools",
            provider=self.provider,
            model=self.model,
            response=response,
            tool_calls=getattr(response, "tool_calls", ()),
        )
        return response

    deep_agent_client.DeepAgentClient.complete_with_tools = traced_complete_with_tools

    original_complete_structured = deep_agent_client.DeepAgentClient.complete_structured

    @functools.wraps(original_complete_structured)
    def traced_complete_structured(
        self,
        prompt: str,
        *,
        response_format,
        workflow_run_id: str,
        node_name: str,
        max_tokens=None,
        correlationId=None,
    ):
        emit_dev_unsafe_trace(
            "DEV_LLM_REQUEST_RAW",
            operation="complete_structured",
            provider=self.provider,
            model=self.model,
            api_key=self.api_key,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
            prompt=prompt,
            response_format=response_format,
        )
        try:
            response = original_complete_structured(
                self,
                prompt,
                response_format=response_format,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=max_tokens,
                correlationId=correlationId,
            )
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_LLM_ERROR_RAW",
                operation="complete_structured",
                provider=self.provider,
                model=self.model,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_LLM_RESPONSE_NORMALIZED",
            operation="complete_structured",
            provider=self.provider,
            model=self.model,
            response=response,
            structured_response=getattr(response, "structured_response", None),
        )
        return response

    deep_agent_client.DeepAgentClient.complete_structured = traced_complete_structured

    original_fallback_dispatch = fallback_client.PrimaryThenFallbackLLMClient._dispatch

    @functools.wraps(original_fallback_dispatch)
    def traced_fallback_dispatch(self, operation):
        emit_dev_unsafe_trace(
            "DEV_LLM_FALLBACK_START",
            providers=[candidate.name for candidate in self._providers],
            fallback_on_codes=sorted(self._fallback_on_codes),
            max_provider_attempts=self._max_provider_attempts,
        )
        try:
            result = original_fallback_dispatch(self, operation)
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_LLM_FALLBACK_ERROR",
                error_type=type(exc).__name__,
                error=str(exc),
                reasons=getattr(exc, "reasons", None),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace("DEV_LLM_FALLBACK_RESULT", response=result)
        return result

    fallback_client.PrimaryThenFallbackLLMClient._dispatch = traced_fallback_dispatch


def _install_http_client_trace() -> None:
    """Trace raw WorkerApiClient request/response boundaries."""
    from tools.common.platform import api_client as api_client_module

    original_post = api_client_module.WorkerApiClient._post_with_retry

    @functools.wraps(original_post)
    def traced_post(self, path: str, payload: dict):
        emit_dev_unsafe_trace(
            "DEV_WORKER_HTTP_REQUEST_RAW",
            method="POST",
            base_url=self._base_url,
            path=path,
            url=f"{self._base_url}{path}",
            worker_api_key=self._api_key,
            timeout=self._timeout,
            max_retries=self._max_retries,
            payload=payload,
        )
        try:
            result = original_post(self, path, payload)
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_WORKER_HTTP_ERROR_RAW",
                method="POST",
                path=path,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_WORKER_HTTP_RESPONSE_RAW",
            method="POST",
            path=path,
            response=result,
        )
        return result

    api_client_module.WorkerApiClient._post_with_retry = traced_post

    original_get = api_client_module.WorkerApiClient._get_with_retry

    @functools.wraps(original_get)
    def traced_get(self, path: str, params: dict | None = None):
        emit_dev_unsafe_trace(
            "DEV_WORKER_HTTP_REQUEST_RAW",
            method="GET",
            base_url=self._base_url,
            path=path,
            url=f"{self._base_url}{path}",
            worker_api_key=self._api_key,
            timeout=self._timeout,
            max_retries=self._max_retries,
            params=params,
        )
        try:
            result = original_get(self, path, params)
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_WORKER_HTTP_ERROR_RAW",
                method="GET",
                path=path,
                params=params,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_WORKER_HTTP_RESPONSE_RAW",
            method="GET",
            path=path,
            params=params,
            response=result,
        )
        return result

    api_client_module.WorkerApiClient._get_with_retry = traced_get


def _install_agentic_trace() -> None:
    """Trace LLM tool calls, PBAC resolution, and all Python tool dispatchers."""
    from tools.common.agentic_evidence import dispatcher, resolver

    original_invoke = resolver.AgenticToolResolver.invoke_tool_calls

    @functools.wraps(original_invoke)
    def traced_invoke(self, tool_calls, *, context):
        emit_dev_unsafe_trace(
            "DEV_AGENTIC_TOOL_CALLS_RAW",
            tool_calls=tool_calls,
            context=context,
            max_tool_calls=self._max_tool_calls,
        )
        try:
            result = original_invoke(self, tool_calls, context=context)
        except Exception as exc:
            emit_dev_unsafe_trace(
                "DEV_AGENTIC_TOOL_CALLS_ERROR",
                tool_calls=tool_calls,
                context=context,
                error_type=type(exc).__name__,
                error=str(exc),
                exception=exc,
            )
            raise
        emit_dev_unsafe_trace(
            "DEV_AGENTIC_TOOL_CALLS_RESULT",
            tool_calls=tool_calls,
            context=context,
            results=result,
        )
        return result

    resolver.AgenticToolResolver.invoke_tool_calls = traced_invoke

    _wrap_dispatcher(dispatcher.AgenticToolDispatcher, request_mode="agentic")
    _wrap_dispatcher(dispatcher.ScannerToolDispatcher, request_mode="keyword")
    _wrap_dispatcher(dispatcher.LegalToolDispatcher, request_mode="keyword")


def _wrap_dispatcher(dispatcher_type, *, request_mode: str) -> None:
    """Wrap one dispatcher class while preserving its exact public signature shape."""
    original_dispatch = dispatcher_type.dispatch

    if request_mode == "agentic":
        @functools.wraps(original_dispatch)
        def traced_dispatch(self, request):
            binding = self.binding(request.tool_name)
            emit_dev_unsafe_trace(
                "DEV_TOOL_DISPATCH_RAW",
                dispatcher=dispatcher_type.__name__,
                tool_name=request.tool_name,
                runtime_target=binding.runtime_target.value,
                downstream_target=binding.downstream_target,
                request=request,
            )
            try:
                result = original_dispatch(self, request)
            except Exception as exc:
                emit_dev_unsafe_trace(
                    "DEV_TOOL_DISPATCH_ERROR",
                    dispatcher=dispatcher_type.__name__,
                    tool_name=request.tool_name,
                    error_type=type(exc).__name__,
                    error=str(exc),
                    exception=exc,
                )
                raise
            emit_dev_unsafe_trace(
                "DEV_TOOL_DISPATCH_RESULT_RAW",
                dispatcher=dispatcher_type.__name__,
                tool_name=request.tool_name,
                result=result,
            )
            return result
    else:
        @functools.wraps(original_dispatch)
        def traced_dispatch(self, tool_name: str, **tool_input):
            binding = self.binding(tool_name)
            emit_dev_unsafe_trace(
                "DEV_TOOL_DISPATCH_RAW",
                dispatcher=dispatcher_type.__name__,
                tool_name=tool_name,
                runtime_target=binding.runtime_target.value,
                downstream_target=binding.downstream_target,
                tool_input=tool_input,
            )
            try:
                result = original_dispatch(self, tool_name, **tool_input)
            except Exception as exc:
                emit_dev_unsafe_trace(
                    "DEV_TOOL_DISPATCH_ERROR",
                    dispatcher=dispatcher_type.__name__,
                    tool_name=tool_name,
                    tool_input=tool_input,
                    error_type=type(exc).__name__,
                    error=str(exc),
                    exception=exc,
                )
                raise
            emit_dev_unsafe_trace(
                "DEV_TOOL_DISPATCH_RESULT_RAW",
                dispatcher=dispatcher_type.__name__,
                tool_name=tool_name,
                result=result,
            )
            return result

    dispatcher_type.dispatch = traced_dispatch
