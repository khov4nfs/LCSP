from unittest.mock import MagicMock, patch

from tools.common.capabilities.platform.rbac_client import RbacClient


def test_check_reads_allow_decision_from_api_result_envelope():
    response = MagicMock()
    response.json.return_value = {"ok": True, "data": {"decision": "ALLOW"}}

    with patch("tools.common.capabilities.platform.rbac_client.httpx.post", return_value=response):
        decision = RbacClient("http://api", "worker-key").check(
            user_id="user-1",
            required_roles=("CUSTOMER",),
            correlationId="corr-1",
        )

    assert decision == "allow"
    response.raise_for_status.assert_called_once()


def test_check_denies_missing_or_non_allow_decision():
    response = MagicMock()
    response.json.return_value = {"ok": True, "data": {"decision": "DENY"}}

    with patch("tools.common.capabilities.platform.rbac_client.httpx.post", return_value=response):
        decision = RbacClient("http://api", "worker-key").check(
            user_id="user-1",
            required_roles=("CUSTOMER",),
            correlationId="corr-1",
        )

    assert decision == "deny"
