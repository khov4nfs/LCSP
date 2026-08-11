from unittest.mock import MagicMock, patch

from lcsp_workers.platform.pbac_client import PbacClient


def test_check_reads_allow_decision_from_api_result_envelope():
    response = MagicMock()
    response.json.return_value = {"ok": True, "data": {"decision": "ALLOW"}}

    with patch("lcsp_workers.platform.pbac_client.httpx.post", return_value=response):
        decision = PbacClient("http://api", "worker-key").check(
            user_id="user-1",
            organization_id="org-1",
            action="scan:trigger",
            correlation_id="corr-1",
        )

    assert decision == "allow"
    response.raise_for_status.assert_called_once()


def test_check_denies_missing_or_non_allow_decision():
    response = MagicMock()
    response.json.return_value = {"ok": True, "data": {"decision": "DENY"}}

    with patch("lcsp_workers.platform.pbac_client.httpx.post", return_value=response):
        decision = PbacClient("http://api", "worker-key").check(
            user_id="user-1",
            organization_id="org-1",
            action="scan:trigger",
            correlation_id="corr-1",
        )

    assert decision == "deny"
