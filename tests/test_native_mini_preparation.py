from __future__ import annotations

import importlib.util
from pathlib import Path
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import UUID


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "native_mini_preparation", ROOT / "tests/native-mini-preparation.py"
)
assert SPEC and SPEC.loader
staging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staging)


class StagingRuleSetPreparationSourceContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.raw, self.pin = staging.fixture_input()
        self.version = {
            "id": str(UUID(int=1)),
            "status": "DRAFT",
            "source": {"id": str(UUID(int=2))},
            "index": {"status": "VALID", "contentHash": "sha256:" + "a" * 64},
        }
        self.document = {
            "id": str(UUID(int=3)),
            "ingestionState": "READY",
            "sourceSha256": self.pin["sourceSha256"],
            "sourceEffectStatus": "EFFECTIVE",
        }
        self.chunks = {
            "total": len(staging.EXPECTED_LOCATORS),
            "items": [
                {
                    "locator": locator,
                    "legalEffectStatus": "EFFECTIVE",
                    "legalStatusSourceRef": "LCSP-360-MINI-FIXTURE",
                    "content": "fixture text must not enter the status report",
                }
                for locator in staging.EXPECTED_LOCATORS
            ],
        }

    def test_fixture_contains_the_six_requested_synthetic_provisions(self) -> None:
        text = self.raw.decode("utf-8")
        self.assertIn("SYNTHETIC TEST FIXTURE", text)
        self.assertEqual(text.count("Article "), 6)
        self.assertIn("more than 1,000", text)
        self.assertIn("once every 12 months", text)
        self.assertIn("no more than 30 days", text)
        self.assertIn("MINI-002 still applies", text)

    def test_effect_status_is_explicitly_provenanced_for_test(self) -> None:
        self.assertEqual(
            staging.effect_status_request(self.pin),
            {"status": "EFFECTIVE", "sourceRef": "LCSP-360-MINI-FIXTURE"},
        )

    def test_preflight_requires_status_and_source_reference_before_activation(self) -> None:
        report = staging.source_status_preflight(
            self.version, self.document, self.chunks, self.pin
        )
        self.assertEqual(report["preparationGate"], "PASS")
        self.assertEqual(report["sourceStatusProvenance"], "PRESENT")
        self.assertNotIn("fixture text", str(report))

        unknown = {**self.chunks, "items": [dict(item) for item in self.chunks["items"]]}
        unknown["items"][0].update(legalEffectStatus="UNKNOWN", legalStatusSourceRef=None)
        with self.assertRaisesRegex(RuntimeError, "missing or undetermined"):
            staging.source_status_preflight(
                self.version, self.document, unknown, self.pin
            )

        missing_reference = {**self.chunks, "items": [dict(item) for item in self.chunks["items"]]}
        missing_reference["items"][0]["legalStatusSourceRef"] = None
        with self.assertRaisesRegex(RuntimeError, "missing or undetermined"):
            staging.source_status_preflight(
                self.version, self.document, missing_reference, self.pin
            )

    def test_activation_references_are_derived_from_structural_validation(self) -> None:
        self.assertEqual(
            staging.structural_activation_refs(self.version["index"]),
            {
                "integrityManifestRef": "structural-integrity:" + "a" * 64,
                "retrievalValidationRef": "structural-validation:" + "a" * 64,
            },
        )

    def test_admin_session_uses_the_success_envelope(self) -> None:
        with patch.object(staging, "admin_request", return_value=(200, {"ok": True, "data": {"session_token": "test"}})):
            self.assertEqual(staging.admin_session({"accounts": {"admin": {"email": "e", "password": "p"}}}), "test")

    def test_missing_or_extra_provisions_fail_before_activation(self) -> None:
        for items in (self.chunks["items"][:-1], self.chunks["items"] + [self.chunks["items"][0]]):
            with self.assertRaises(RuntimeError):
                staging.source_status_preflight(self.version, self.document, {"items": items, "total": len(items)}, self.pin)

    def test_process_identity_identifies_the_running_process(self) -> None:
        self.assertTrue(staging.process_identity(os.getpid()).isdigit())
        self.assertIsNone(staging.process_identity(99999999))

    def test_native_verification_rejects_divergent_source(self) -> None:
        fake = SimpleNamespace(manifest={"sha": "canonical"})
        with patch.object(staging, "git", side_effect=["canonical", "foreign"]):
            with self.assertRaisesRegex(RuntimeError, "canonical SHA changed"):
                staging.NativeStack.verify(fake, {})


if __name__ == "__main__":
    unittest.main()
