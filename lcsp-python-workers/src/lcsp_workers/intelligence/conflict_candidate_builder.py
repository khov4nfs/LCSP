"""Build deterministic conflict candidates from technical and wizard profiles."""

from __future__ import annotations

from typing import Any


class ConflictCandidateBuilder:
    """Detect explicit manager-answer contradictions supported by technical evidence."""

    def build(
        self,
        *,
        technical_profile: dict[str, Any],
        wizard_profile: dict[str, Any] | None,
        has_validated_invocation: bool,
    ) -> list[dict[str, Any]]:
        """Build conflict records when wizard answers deny detected AI use.

        Args:
            technical_profile: Aggregated technical profile from scan evidence.
            wizard_profile: Optional manager/wizard answer profile.
            has_validated_invocation: Whether a validated model-invocation claim exists.

        Returns:
            Conflict candidate dictionaries; empty when no material contradiction
            can be established from the supplied profiles.
        """
        if not wizard_profile:
            return []

        conflicts: list[dict[str, Any]] = []
        answers = wizard_profile.get("answers")
        answers = answers if isinstance(answers, dict) else {}
        wizard_says_no_ai = (
            answers.get("aiUse") is False
            or str(answers.get("usesAi", "")).lower() == "false"
            or str(answers.get("aiPurpose", "")).lower() in {"none", "no_ai"}
        )
        ai_detected = str(
            technical_profile.get("ai_detected")
            or technical_profile.get("aiDetected")
            or ""
        ).lower()
        invocation_count = int(
            technical_profile.get("model_invocation_count")
            or technical_profile.get("modelInvocationCount")
            or 0
        )

        if wizard_says_no_ai and (
            ai_detected == "confirmed" or invocation_count > 0 or has_validated_invocation
        ):
            conflicts.append(
                {
                    "conflict_id": "conflict_wizard_no_ai_invocation",
                    "conflict_type": "WIZARD_NO_AI_BUT_INVOCATION_EXISTS",
                    "evidence_refs": list(
                        technical_profile.get("evidence_refs")
                        or technical_profile.get("evidenceRefs")
                        or []
                    ),
                }
            )
        return conflicts
