from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class CallbackResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    success: Optional[bool] = None
    accepted: Optional[bool] = None
    status: Optional[str] = None
    correlationId: Optional[str] = Field(default=None, alias="correlationId")
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None





class SettledUsagePayload(BaseModel):
    """Provider-reported usage telemetry for one model invocation.

    Carries identity and provider-reported token counts only. There is no
    reservation, price, or monetary field: assessment execution never debits a
    wallet, so nothing here may imply a charge.

    Fields: assessmentId, runId, invocationId, agentRole, provider, model,
    providerResponseId?, effectiveRuntimeModel?, inputTokens?, cachedInputTokens?,
    cacheWriteTokens?, outputTokens?, reasoningTokens?, totalTokens?, occurredAt.
    Token counts are decimal strings and only present when the provider reported them.
    """

    model_config = ConfigDict(extra="forbid")
    assessmentId: str
    runId: str
    invocationId: str
    agentRole: str
    provider: str
    model: str
    providerResponseId: Optional[str] = None
    effectiveRuntimeModel: Optional[Dict[str, str]] = None
    inputTokens: Optional[str] = None
    cachedInputTokens: Optional[str] = None
    cacheWriteTokens: Optional[str] = None
    outputTokens: Optional[str] = None
    reasoningTokens: Optional[str] = None
    totalTokens: Optional[str] = None
    occurredAt: str










class AuditExportCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    export_url: Optional[str] = None
    error_message: Optional[str] = None
