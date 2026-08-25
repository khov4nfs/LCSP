"""PBAC preflight client used by worker-side authorization boundaries."""

from typing import Literal

import httpx


class PbacClient:
    """Call the NestJS PBAC preflight endpoint for worker actions."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        """Create a PBAC client.

        Args:
            base_url: Base URL of the LCSP NestJS API.
            api_key: Worker API key used to authenticate internal requests.
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._client = client

    def check(
        self,
        user_id: str,
        organization_id: str,
        action: str,
        correlationId: str,
    ) -> Literal["allow", "deny"]:
        """Evaluate whether a worker action is allowed by PBAC.

        The client fails closed for any successful response that does not
        explicitly contain the ``ALLOW`` decision. Transport failures remain
        distinguishable so callers can apply retry/dead-letter behavior.

        Args:
            user_id: User or technical principal requesting the action.
            organization_id: Tenant boundary for the authorization decision.
            action: PBAC action identifier to evaluate.
            correlationId: Correlation identifier propagated to the API.

        Returns:
            ``"allow"`` only for an explicit ALLOW response; otherwise
            ``"deny"``.

        Raises:
            ConnectionError: If the PBAC service cannot be reached.
            httpx.HTTPStatusError: If the service returns a non-success status.
        """
        try:
            request = {
                "json": {
                    "user_id": user_id,
                    "organization_id": organization_id,
                    "action": action,
                    "correlationId": correlationId,
                },
                "headers": {"X-Worker-Api-Key": self._api_key},
                "timeout": self._timeout_seconds,
            }
            if self._client is None:
                resp = httpx.post(
                    f"{self._base_url}/internal/pbac/preflight",
                    **request,
                )
            else:
                resp = self._client.post(
                    f"{self._base_url}/internal/pbac/preflight",
                    **request,
                )
            resp.raise_for_status()
            body = resp.json()
            result = body.get("data") if isinstance(body, dict) else None
            decision = result.get("decision") if isinstance(result, dict) else None
            return "allow" if decision == "ALLOW" else "deny"
        except httpx.RequestError as e:
            raise ConnectionError("PBAC preflight unreachable") from e
