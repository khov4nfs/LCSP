"""Release vertical: interview-gated engineering assessment on the per-rule runtime.

Migrated from the deleted pipeline architecture
(``PlannedEngineeringInvestigationPipeline``,
``ManagedTargetedInvestigatorPipeline``, ``EngineeringRulePlanner``,
``ManagedInvestigatorExecutionStore``) to the per-``EngineeringRule`` runtime:

- ``analyze_rule`` (one rule -> one Repository Analyst dispatch, per-rule
  failure isolation; a failed resume never erases a prior accepted result),
- ``finalize_rule_results`` (applicability -> claims -> deterministic
  evaluator -> completion gate),
- ``register_business_needs`` (lazy targeted-need registration),
- the deterministic applicability gate (replaces ``EngineeringRulePlanner``),
- the per-rule ledger (``api.list_rule_assessments`` /
  ``api.put_rule_assessment``; replaces ``ManagedInvestigatorExecutionStore``).

Interview-gating semantics are unchanged: the Interview owns customer-context
reasoning, business-context needs are registered lazily, and a confirmed
answer resumes strictly the rule/criteria its server-owned need names
(``_bind_answer_to_need``). No absence semantics: ``FINAL_ABSENCE`` stays
disabled and ``NOT_OBSERVED`` never yields ``NON_COMPLIANT``.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_completion_gate import (
    apply_rule_completion_gate,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    ENGINEERING_RULE_EVALUATION_STATUSES,
    EngineeringRuleEvaluation,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    normalize_confirmed_structured_business_context,
)
from tools.common.capabilities.assessment.planning.engineering_rule.rule_applicability_gate import (
    APPLICABILITY_STATUSES,
    evaluate_applicability,
    legal_rule_id_index,
)
from tools.common.capabilities.assessment.rule_assessment.run import (
    analyze_rule,
    evaluate_rule_applicability,
    finalize_rule_results,
    register_business_needs,
    rule_runtime_version,
    usable_rule_result,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
    _bind_answer_to_need,
)
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    PostGuardContinuationStore,
)
from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule


CHECKPOINT_URL = os.environ.get('LCSP_TEST_CHECKPOINT_DATABASE_URL')
pytestmark = pytest.mark.skipif(
    not CHECKPOINT_URL,
    reason='release vertical requires the CI Postgres checkpoint service',
)

REPORT_ID = 'ter-release-vertical-1'
SNAPSHOT_ID = 'snapshot-release-vertical-1'
CATALOG_ID = 'catalog-release-vertical-1'
CORPUS_ID = 'corpus-release-vertical-1'
RULE_ID = 'ENG-RELEASE-VERTICAL-1'
SECOND_RULE_ID = 'ENG-RELEASE-VERTICAL-2'
LEGAL_RULE_ID = 'LEGAL-RELEASE-VERTICAL-1'
EVIDENCE_REF = 'EV-RELEASE-VERTICAL-1'
SOURCE_VERSION = f'{SNAPSHOT_ID}:abc123'
PGE_VERSION = f'{REPORT_ID}:v1'
COMMIT_SHA = 'abc123'
ARTIFACT_PINS = {
    'technicalEvidenceReportId': REPORT_ID,
    'repositorySnapshotId': SNAPSHOT_ID,
    'legalRuleCatalogVersionId': CATALOG_ID,
    'legalCorpusVersionId': CORPUS_ID,
}


# Initial CONTEXT_READY must resolve the minimum planning context in one confirmed answer.
INITIAL_SYSTEM_PURPOSE = (
    'AI-assisted recommendation: the AI model drafts recommendations in the customer '
    'onboarding workflow; a human reviewer approves every action before any status '
    'update; affected subjects are customers; data sources are customer profile '
    'records and repository code.'
)
TARGETED_DECISION_AUTHORITY = 'A human manager must approve before action'
TARGETED_QUESTION = 'Who approves the AI recommendation before action?'
TARGETED_OBSERVATION = 'Approval owner is unclear from the repository.'


def _confirmed_context(
    assessment_id: str,
    topic: str,
    statement: str,
    *,
    revision: int,
) -> dict[str, Any]:
    return {
        'assessmentId': assessment_id,
        'contextRevision': revision,
        'authority': 'CUSTOMER_CONFIRMED_CONFIRMED_ONLY',
        'statements': [
            {
                'statementId': f'stmt-{topic}',
                'topic': topic,
                'statement': statement,
                'normalizedValue': statement,
                'scope': {'topic': topic},
                'evidenceRefs': [EVIDENCE_REF],
                'respondentRef': 'actor:authenticated-release',
                'createdAt': '2026-09-05T00:00:00Z',
                'source': 'CUSTOMER_CONFIRMED',
                'resolutionState': 'CONFIRMED',
            }
        ],
        'limitations': ['customer-confirmed current statements only'],
        'sourceVersionRef': SOURCE_VERSION,
        'pgeVersion': PGE_VERSION,
        'guidanceVersion': 'guidance-release-vertical-1',
    }


def _normalized_context(assessment_id: str, outcome: str, revision: int, context: dict[str, Any]):
    return normalize_confirmed_structured_business_context(
        {
            'outcome': outcome,
            'contextRevision': revision,
            'confirmedContext': context,
        },
        assessment_id=assessment_id,
    )


def _engineering_rule(rule_id: str = RULE_ID, *, required: tuple[str, ...] = ('CONTROL',)) -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id=rule_id,
        legal_rule_id=LEGAL_RULE_ID,
        legal_rule_catalog_version_id=CATALOG_ID,
        legal_corpus_version_id=CORPUS_ID,
        concept='approval authority',
        legal_intent={},
        investigation_goals=('inspect approval authority',),
        starting_node_types=('AI_MODEL_INVOCATION',),
        target_node_types=('AI_MODEL_INVOCATION',),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=tuple(required),
        source_chunk_ids=('chunk-release-vertical-1',),
        source_locators=('Article 1',),
    )


def _rule_context(assessment_id: str, *, workflow_run_id: str | None = None) -> LCSPRunContext:
    return LCSPRunContext(
        assessment_id=assessment_id,
        user_id='customer-release-vertical-1',
        workflow_run_id=workflow_run_id or f'assessment-run:{assessment_id}',
        scan_job_id='scan-release-vertical-1',
        commit_sha=COMMIT_SHA,
        artifact_versions=dict(ARTIFACT_PINS),
    )


def _applicability_facts() -> dict[str, Any]:
    # The release legal rule authors no required/blocking facts, so the
    # deterministic gate reports NOT_GATED (eligible for analysis).
    return {
        'legal_rules': [{'legalRuleId': RULE_ID}, {'legalRuleId': SECOND_RULE_ID}],
        'ai_discovery': None,
        'confirmed_statements': (),
    }


class _ScriptedSpecialistFactory:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.invoke_count = 0

    def __call__(self, **_kwargs):
        factory = self

        class _Agent:
            def invoke(self, _payload, *, config=None, context=None):
                _ = config, context
                if not factory.responses:
                    raise AssertionError('unexpected extra Interview specialist invocation')
                factory.invoke_count += 1
                return {'structured_response': factory.responses.pop(0)}

        return _Agent()


class _VerticalApi:
    """Fake worker API: Interview turns plus the per-rule assessment ledger."""

    def __init__(self, assessment_id: str) -> None:
        self.assessment_id = assessment_id
        self.current_revision = 0
        self.processed_revision = -1
        self.private_revision: dict[str, Any] | None = None
        self.state: dict[str, Any] = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 0,
            'orchestrationRequested': True,
            'answerHistory': [],
        }
        self.targeted_need: dict[str, Any] | None = None
        self.initial_questions: list[dict[str, Any]] = []
        self.registered_needs: list[dict[str, Any]] = []
        self.rule_rows: list[dict[str, Any]] = []
        self.last_decision: dict[str, Any] | None = None

    # -- accepted evidence -------------------------------------------------
    def get_accepted_technical_evidence_report(self, report_id: str):
        assert report_id == REPORT_ID
        return {
            'id': REPORT_ID,
            'assessment_id': self.assessment_id,
            'user_id': 'customer-release-vertical-1',
            'snapshot_id': SNAPSHOT_ID,
            'scan_job_id': 'scan-release-vertical-1',
            'evidence_payload': {'evidence_graph': _program_graph()},
        }

    # --termine initial interview -------------------------------------------
    def get_interview_worker_state(self, assessment_id: str):
        assert assessment_id == self.assessment_id
        return dict(self.state)

    def post_interview_initial_question(self, assessment_id: str, payload):
        assert assessment_id == self.assessment_id
        self.initial_questions.append(dict(payload))
        self.state = {
            **dict(payload),
            'contextRevision': 0,
            'orchestrationRequested': False,
        }
        return dict(self.state)

    def submit_initial_answer(self) -> None:
        self.current_revision = 1
        self.private_revision = {
            'revision': 1,
            'actorId': 'user-release-vertical',
            'authenticatedActorId': 'user-release-vertical',
            'answer': {'freeText': 'The system provides recommendations only.'},
            'authority': 'CUSTOMER_STATED',
            'questionIntent': 'ASK',
            'questionControl': 'FREE_TEXT',
            'answerRequiresInterpretation': True,
            'governedEvidenceRefs': [EVIDENCE_REF],
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 1,
            'orchestrationRequested': True,
        }

    def submit_initial_confirmation(self) -> None:
        self.current_revision = 2
        self.private_revision = {
            'revision': 2,
            'actorId': 'user-release-vertical',
            'authenticatedActorId': 'user-release-vertical',
            'answer': {'confirmed': True},
            'authority': 'CUSTOMER_CONFIRMED',
            'questionIntent': 'CLARIFY',
            'questionControl': 'CONFIRM_ADJUST',
            'answerRequiresInterpretation': False,
            'governedEvidenceRefs': [EVIDENCE_REF],
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 2,
            'orchestrationRequested': True,
        }

    # -- per-rule ledger (replaces ManagedInvestigatorExecutionStore) -------
    def list_rule_assessments(self, assessment_id: str) -> list[dict[str, Any]]:
        assert assessment_id == self.assessment_id
        return [copy.deepcopy(row) for row in self.rule_rows]

    def put_rule_assessment(self, assessment_id: str, engineering_rule_id: str, payload: dict[str, Any]):
        assert assessment_id == self.assessment_id
        assert payload['engineeringRuleId'] == engineering_rule_id
        self.rule_rows.append(copy.deepcopy(payload))
        return {'ok': True}

    def post_scan_runtime_event(self, _scan_job_id, _payload):
        return {}

    def post_interview_targeted_need(self, assessment_id: str, payload: dict[str, Any]):
        """Register one BusinessContextNeed; artifact pins must propagate."""
        assert assessment_id == self.assessment_id
        assert payload['artifactVersions'] == ARTIFACT_PINS
        self.targeted_need = {
            'needId': payload['needId'],
            'engineeringRuleId': payload['engineeringRuleId'],
            'criterionId': payload['criterionId'],
            'resolutionCriterionIds': list(payload['resolutionCriterionIds']),
            'question': payload['question'],
            'observation': payload.get('observation'),
        }
        self.registered_needs.append(copy.deepcopy(payload))
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': self.current_revision,
            'orchestrationRequested': True,
        }
        return {'registered': True}

    # -- interview resume ----------------------------------------------------
    def get_interview_private_context(
        self,
        assessment_id: str,
        context_revision: int,
        *,
        source_version: str,
        pge_version: str,
    ):
        assert assessment_id == self.assessment_id
        assert source_version == SOURCE_VERSION
        assert pge_version == PGE_VERSION
        if context_revision != self.current_revision:
            status = 'STALE'
        elif context_revision <= self.processed_revision:
            status = 'DUPLICATE'
        else:
            status = 'CURRENT'
        result = {
            'status': status,
            'assessmentId': assessment_id,
            'threadId': f'interview:{assessment_id}',
            'workflowRunId': f'assessment-run:{assessment_id}',
            'actorId': 'user-release-vertical',
            'authenticatedActorId': 'user-release-vertical',
            'sourceVersion': SOURCE_VERSION,
            'pgeVersion': PGE_VERSION,
            # The release fixture represents an accepted, usable report.  Resume
            # must not enter the Root recovery branch reserved for unavailable
            # technical coverage.
            'technicalCoverageState': 'READY',
            'coverageLimitations': [],
            'governedEvidenceRefs': [EVIDENCE_REF],
            'publicState': dict(self.state),
            'privateRevision': (
                copy.deepcopy(self.private_revision)
                if isinstance(self.private_revision, dict)
                else None
            ),
        }
        if self.targeted_need is not None:
            result['targetedNeed'] = dict(self.targeted_need)
        return result

    def post_interview_agent_decision(self, assessment_id: str, payload):
        assert assessment_id == self.assessment_id
        expected = int(payload['expectedContextRevision'])
        assert expected == self.current_revision
        outcome = payload['outcome']
        guarded = {
            **dict(payload),
            'contextRevision': expected,
            'orchestrationRequested': False,
        }
        if outcome == 'CONTEXT_RESOLVED':
            assert self.targeted_need is not None
            confirmed = payload.get('confirmedContext') or {}
            assert confirmed.get('authority') == 'CUSTOMER_CONFIRMED_CONFIRMED_ONLY'
            # Server-owned stamping (mirrors the API): the confirmed statements
            # resolve the pending need; the model never writes need identity.
            stamped = []
            for statement in confirmed.get('statements') or []:
                statement = dict(statement)
                statement['sourceNeedId'] = self.targeted_need['needId']
                statement['resolvedCriterionIds'] = list(
                    self.targeted_need['resolutionCriterionIds']
                )
                stamped.append(statement)
            assert stamped
            guarded['confirmedContext'] = {**confirmed, 'statements': stamped}
            guarded['targetedNeed'] = dict(self.targeted_need)
            guarded['continuation'] = {
                'needId': self.targeted_need['needId'],
                'engineeringRuleId': self.targeted_need['engineeringRuleId'],
                'criterionId': self.targeted_need['criterionId'],
                'resolutionCriterionIds': list(self.targeted_need['resolutionCriterionIds']),
                'sourceVersion': SOURCE_VERSION,
                'pgeVersion': PGE_VERSION,
            }
        self.state = copy.deepcopy(guarded)
        self.last_decision = copy.deepcopy(guarded)
        if outcome in {'CONTEXT_READY', 'CONTEXT_RESOLVED'}:
            self.processed_revision = expected
        return copy.deepcopy(guarded)

    def submit_targeted_answer(self) -> None:
        self.current_revision = 3
        self.private_revision = {
            'revision': 3,
            'answer': {
                'freeText': 'A human manager must approve before action.'
            },
            'authority': 'CUSTOMER_STATED',
            'questionIntent': 'CLARIFY',
            'questionControl': 'FREE_TEXT',
            'answerRequiresInterpretation': True,
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 3,
            'orchestrationRequested': True,
        }

    def submit_targeted_confirmation(self) -> None:
        self.current_revision = 4
        self.private_revision = {
            'revision': 4,
            'answer': {'confirmed': True},
            'authority': 'CUSTOMER_CONFIRMED',
            'questionIntent': 'CLARIFY',
            'questionControl': 'CONFIRM_ADJUST',
            'answerRequiresInterpretation': False,
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 4,
            'orchestrationRequested': True,
        }


def _program_graph() -> dict[str, Any]:
    return {
        'graph_id': 'graph-release-vertical-1',
        'snapshot_id': SNAPSHOT_ID,
        'commit_sha': COMMIT_SHA,
        'node_count': 1,
        'edge_count': 0,
        'coverage_state': 'PARTIAL',
        'coverage_notes': ['dynamic configuration remains bounded but incomplete'],
        'partialCoveragePolicyDecision': {
            'policyDecisionRef': f'coverage-policy:{SNAPSHOT_ID}',
            'policyVersion': 'partial-coverage-policy-v1',
            'permittedForInterview': True,
            'limitations': ['dynamic configuration remains bounded but incomplete'],
        },
        'nodes': [
            {
                'node_id': 'node:ai',
                'node_type': 'AI_MODEL_INVOCATION',
                'label': 'responses.create',
                'source': {'file_path': 'src/service.py', 'symbol_ref': 'responses.create', 'start_line': 1, 'end_line': 3},
                'attributes': {},
                'semantic_types': [],
                'evidence_refs': [EVIDENCE_REF],
                'origin': 'DEEP_AGENT',
                'resolution_state': 'CORROBORATED',
                'support_refs': [],
            }
        ],
        'edges': [],
        'source_anchors': [],
        'evidence_refs': [EVIDENCE_REF],
        'graph_hash': 'sha256:release-vertical-graph',
    }


class _FakeAnalystDispatcher:
    """Fake repository-analyst dispatcher: persists ledger rows per dispatch.

    ``behaviors`` is consumed once per dispatch *attempt* (``analyze_rule``
    retries once, so a failure case needs two entries): ``'completed'``,
    ``'needs_context'``, or an ``Exception`` instance to raise.
    """

    def __init__(self, api: _VerticalApi, behaviors: list[Any]) -> None:
        self._api = api
        self._behaviors = list(behaviors)
        self.calls: list[dict[str, Any]] = []

    def dispatch(
        self,
        *,
        subagent_type: str,
        instruction: str,
        affected_rule_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        trigger: str | None = None,
        metadata: dict[str, Any] | None = None,
        thread_id: str | None = None,
        context: Any = None,
    ) -> dict[str, Any]:
        assert subagent_type == 'repository-analyst', subagent_type
        assert affected_rule_ids and len(affected_rule_ids) == 1
        assert trigger == 'RULE_ANALYSIS'
        assert thread_id
        task = json.loads(instruction[instruction.index('{'):])
        self.calls.append({
            'rule_id': affected_rule_ids[0],
            'thread_id': thread_id,
            'idempotency_key': idempotency_key,
            'has_prior': 'priorAcceptedResult' in task,
            'instruction': instruction,
        })
        assert task['engineeringRuleId'] == affected_rule_ids[0]
        if not self._behaviors:
            raise AssertionError('unexpected extra repository-analyst dispatch')
        behavior = self._behaviors.pop(0)
        if isinstance(behavior, Exception):
            raise behavior
        assert context is not None
        if behavior == 'completed':
            row = _completed_row(context)
        elif behavior == 'needs_context':
            row = _needs_context_row(context)
        else:  # pragma: no cover - guarded against fake misuse
            raise AssertionError(f'unknown analyst behavior: {behavior!r}')
        self._api.put_rule_assessment(context.assessment_id, affected_rule_ids[0], row)
        return {'status': 'COMPLETED'}


def _completed_row(context: LCSPRunContext) -> dict[str, Any]:
    rule_id = context.engineering_rule_ids[0]
    criteria = []
    for criterion_id in context.criterion_ids:
        evidence_ref = f'ev:{context.commit_sha}:src/service.py:1-3'
        criteria.append({
            'criterionId': criterion_id,
            'status': RULE_CRITERION_STATUSES['evidenceFound'],
            'evidenceKind': RULE_EVIDENCE_KINDS['supportsRequirement'],
            'evidenceRefs': [evidence_ref],
            'evidence': [{
                'ref': evidence_ref,
                'path': 'src/service.py',
                'startLine': 1,
                'endLine': 3,
                'provenance': {
                    'assessmentId': context.assessment_id,
                    'repositoryVersion': context.commit_sha,
                    'engineeringRuleId': rule_id,
                    'criterionId': criterion_id,
                    'validator': 'lcsp.rule_assessment.v1',
                },
            }],
            'technicalFacts': ['A human manager approves before action.'],
            'limitations': [],
        })
    return {
        'resultId': f'rar_release_{rule_id}_{context.context_revision}',
        'assessmentId': context.assessment_id,
        'engineeringRuleId': rule_id,
        'engineeringRuleVersion': context.engineering_rule_version,
        'repositoryVersion': context.commit_sha,
        'contextRevision': context.context_revision,
        'status': RULE_ANALYSIS_STATUSES['completed'],
        'criteria': criteria,
        'limitations': [],
        'execution': {'attempt': 1, 'runId': context.workflow_run_id},
    }


def _needs_context_row(context: LCSPRunContext) -> dict[str, Any]:
    rule_id = context.engineering_rule_ids[0]
    digest = hashlib.sha256(TARGETED_QUESTION.encode('utf-8')).hexdigest()[:12]
    criteria = []
    for criterion_id in context.criterion_ids:
        criteria.append({
            'criterionId': criterion_id,
            'status': RULE_CRITERION_STATUSES['businessContextRequired'],
            'evidenceRefs': [],
            'evidence': [],
            'technicalFacts': [],
            'limitations': [],
            'businessContextNeed': {
                # Deterministic id: re-registration of the same need is lazy.
                'needId': f'need:{rule_id}:{criterion_id}:{digest}',
                'question': TARGETED_QUESTION,
                'observation': TARGETED_OBSERVATION,
                'resolutionCriterionIds': [criterion_id],
            },
        })
    return {
        'resultId': f'rar_release_needs_{rule_id}_{context.context_revision}',
        'assessmentId': context.assessment_id,
        'engineeringRuleId': rule_id,
        'engineeringRuleVersion': context.engineering_rule_version,
        'repositoryVersion': context.commit_sha,
        'contextRevision': context.context_revision,
        'status': RULE_ANALYSIS_STATUSES['needsContext'],
        'criteria': criteria,
        'limitations': [],
        'execution': {'attempt': 1, 'runId': context.workflow_run_id},
    }


def _resume_message(assessment_id: str, *, revision: int, targeted: bool) -> dict:
    return {
        'assessmentId': assessment_id,
        'threadId': f'interview:{assessment_id}',
        'workflowRunId': f'assessment-run:{assessment_id}',
        'questionId': 'need-release-vertical-1' if targeted else 'question-initial-1',
        'contextRevision': revision,
        'sourceVersion': SOURCE_VERSION,
        'pgeVersion': PGE_VERSION,
        'resumeReason': (
            'BUSINESS_CONTEXT_RESOLUTION_REQUIRED'
            if targeted
            else 'INTERVIEW_AGENT_DECISION_REQUIRED'
        ),
    }


def _initial_interview_factory(assessment_id: str) -> _ScriptedSpecialistFactory:
    return _ScriptedSpecialistFactory(
        [
            {
                'expectedContextRevision': 0,
                'mode': 'INITIAL_INTERVIEW',
                'outcome': 'WAITING_FOR_CUSTOMER',
                'activeQuestion': {
                    'id': 'question-initial-1',
                    'intent': 'ASK',
                    'control': 'FREE_TEXT',
                    'prompt': 'What is the business purpose of this AI-supported flow?',
                    'frontier': {
                        'owner': 'CUSTOMER',
                        'materiality': 'MATERIAL',
                        'description': 'AI-supported flow business purpose',
                        'evidenceRefs': [EVIDENCE_REF],
                    },
                },
                'confirmedContext': {},
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 1,
                'mode': 'INITIAL_INTERVIEW',
                'outcome': 'CONTEXT_READY',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'system_purpose',
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 1,
                'mode': 'INITIAL_INTERVIEW',
                'outcome': 'CONTEXT_READY',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'system_purpose',
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 2,
                'mode': 'INITIAL_INTERVIEW',
                'outcome': 'CONTEXT_READY',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'system_purpose',
                    INITIAL_SYSTEM_PURPOSE,
                    revision=2,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
        ]
    )


def _targeted_interview_factory(assessment_id: str) -> _ScriptedSpecialistFactory:
    return _ScriptedSpecialistFactory(
        [
            {
                'expectedContextRevision': 2,
                'mode': 'BUSINESS_CONTEXT_RESOLUTION',
                'outcome': 'WAITING_FOR_CUSTOMER',
                'activeQuestion': {
                    'id': 'question-targeted-1',
                    'intent': 'CLARIFY',
                    'control': 'FREE_TEXT',
                    'prompt': 'Who must approve the recommendation before action?',
                    'frontier': {
                        'owner': 'CUSTOMER',
                        'materiality': 'MATERIAL',
                        'description': 'Who must approve the recommendation before action?',
                        'evidenceRefs': [EVIDENCE_REF],
                    },
                },
                'confirmedContext': {},
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 3,
                'mode': 'BUSINESS_CONTEXT_RESOLUTION',
                'outcome': 'CONTEXT_RESOLVED',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'decision_authority',
                    TARGETED_DECISION_AUTHORITY,
                    revision=3,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 3,
                'mode': 'BUSINESS_CONTEXT_RESOLUTION',
                'outcome': 'CONTEXT_RESOLVED',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'decision_authority',
                    TARGETED_DECISION_AUTHORITY,
                    revision=3,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 4,
                'mode': 'BUSINESS_CONTEXT_RESOLUTION',
                'outcome': 'CONTEXT_RESOLVED',
                'contextAuthority': 'CUSTOMER_CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'decision_authority',
                    TARGETED_DECISION_AUTHORITY,
                    revision=4,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
        ]
    )


def test_release_initial_interview_gates_rule_analysis_until_context_ready() -> None:
    """Root cause: rule analysis must never run on unconfirmed customer context.

    Fix: the release gate drives the real Interview resume boundary; the
    repository-analyst dispatcher stays untouched until CONTEXT_READY is
    guarded, and a duplicate delivery replays nothing.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    config = SimpleNamespace(langgraph_checkpoint_database_url=CHECKPOINT_URL)
    api = _VerticalApi(assessment_id)
    interview_factory = _initial_interview_factory(assessment_id)
    dispatcher = RootSubagentDispatcher(agent_factory=interview_factory)
    analyst = _FakeAnalystDispatcher(api, ['completed'])
    store = PostGuardContinuationStore(CHECKPOINT_URL)

    gated = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
    )
    gated.handle(
        {
            'assessmentId': assessment_id,
            'evidenceReportId': REPORT_ID,
            'workflowRunId': f'assessment-run:{assessment_id}',
        },
        'corr-release-bootstrap',
    )
    assert len(api.initial_questions) == 1
    assert analyst.calls == []
    assert api.list_rule_assessments(assessment_id) == []

    captured: list[tuple[dict[str, Any], str]] = []

    def downstream(payload: dict[str, Any], correlation_id: str) -> None:
        captured.append((payload, correlation_id))

    api.submit_initial_answer()
    initial_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=downstream,
        continuation_store=store,
    )
    initial_resume.handle(
        _resume_message(assessment_id, revision=1, targeted=False),
        'corr-release-initial-answer',
    )
    # A FREE_TEXT answer always needs interpretation: the worker synthesizes a
    # CONFIRM_ADJUST question instead of treating it as confirmed context.
    assert api.state['activeQuestion']['control'] == 'CONFIRM_ADJUST'
    assert captured == []
    assert analyst.calls == []

    api.submit_initial_confirmation()
    initial_resume.handle(
        _resume_message(assessment_id, revision=2, targeted=False),
        'corr-release-initial-confirmed',
    )
    assert len(captured) == 1
    assert captured[0][0]['outcome'] == 'CONTEXT_READY'
    assert captured[0][0]['contextRevision'] == 2
    # The first rule analysis may only start now; nothing ran before the guard.
    assert analyst.calls == []

    confirmed = _normalized_context(
        assessment_id,
        'CONTEXT_READY',
        2,
        _confirmed_context(assessment_id, 'system_purpose', INITIAL_SYSTEM_PURPOSE, revision=2),
    )
    assert confirmed.context_revision == 2
    assert confirmed.authority == 'CUSTOMER_CONFIRMED_CONFIRMED_ONLY'
    assert confirmed.statements[0].topic == 'system_purpose'

    initial_resume.handle(
        _resume_message(assessment_id, revision=2, targeted=False),
        'corr-release-initial-replay',
    )
    assert interview_factory.invoke_count == 4
    assert len(captured) == 1
    assert analyst.calls == []


def test_release_rule_registers_need_lazily_then_resolves_compliant() -> None:
    """Root cause: customer-owned facts must pause analysis, not fail it.

    Fix: a NEEDS_CONTEXT assessment registers its business-context need (with
    artifact pins) and the resumed analysis concludes COMPLIANT; the
    Interview-owned confirmed text travels verbatim into the analyst task.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    api = _VerticalApi(assessment_id)
    rule = _engineering_rule()
    context = _rule_context(assessment_id)

    # The deterministic applicability gate replaces EngineeringRulePlanner:
    # a legal rule authoring no facts is NOT_GATED and eligible for analysis.
    applicability = evaluate_rule_applicability([rule], _applicability_facts())
    assert applicability[RULE_ID]['status'] == APPLICABILITY_STATUSES['not_gated']

    confirmed_initial = _normalized_context(
        assessment_id, 'CONTEXT_READY', 2,
        _confirmed_context(assessment_id, 'system_purpose', INITIAL_SYSTEM_PURPOSE, revision=2),
    )
    analyst = _FakeAnalystDispatcher(api, ['needs_context', 'completed'])
    needs_row = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=analyst,
        api=api,
        confirmed_context=confirmed_initial,
    )
    assert needs_row['status'] == RULE_ANALYSIS_STATUSES['needsContext']
    assert analyst.calls[0]['has_prior'] is False
    assert INITIAL_SYSTEM_PURPOSE in analyst.calls[0]['instruction']

    registered = register_business_needs(
        rule=rule,
        assessment=needs_row,
        context=context,
        api=api,
        user_id='customer-release-vertical-1',
    )
    assert len(registered) == 1
    need_id = registered[0]
    assert api.targeted_need is not None
    assert api.targeted_need['needId'] == need_id
    assert api.targeted_need['engineeringRuleId'] == RULE_ID
    assert api.targeted_need['resolutionCriterionIds'] == ['CONTROL']
    assert api.registered_needs[0]['artifactVersions'] == ARTIFACT_PINS

    # Lazy registration: an assessment whose criteria are all decided
    # registers nothing, and the same need re-registers under the same id.
    assert (
        register_business_needs(
            rule=rule, assessment=needs_row, context=context, api=api,
            user_id='customer-release-vertical-1',
        )
        == [need_id]
    )
    decided = _completed_row(
        _rule_context_for(api, assessment_id, rule, revision=2, run_id='run-decided'),
    )
    assert (
        register_business_needs(
            rule=rule, assessment=decided, context=context, api=api,
            user_id='customer-release-vertical-1',
        )
        == []
    )

    targeted_confirmed = _normalized_context(
        assessment_id, 'CONTEXT_RESOLVED', 4,
        _confirmed_context(
            assessment_id, 'decision_authority', TARGETED_DECISION_AUTHORITY, revision=4
        ),
    )
    resumed = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=analyst,
        api=api,
        confirmed_context=targeted_confirmed,
        prior_result=needs_row,
    )
    assert resumed['status'] == RULE_ANALYSIS_STATUSES['completed']
    assert resumed['contextRevision'] == 4
    assert analyst.calls[1]['has_prior'] is True
    assert TARGETED_DECISION_AUTHORITY in analyst.calls[1]['instruction']

    evaluations = finalize_rule_results(
        assessment_id=assessment_id,
        rules=[rule],
        api=api,
        applicability_facts=_applicability_facts(),
        context_revision=4,
        commit_sha=COMMIT_SHA,
    )
    assert len(evaluations) == 1
    assert evaluations[0].engineering_rule_id == RULE_ID
    assert evaluations[0].status == 'COMPLIANT'
    rows = api.list_rule_assessments(assessment_id)
    assert usable_rule_result(
        rule, rows[-1], commit_sha=COMMIT_SHA, applicability_status='NOT_GATED'
    )


def _rule_context_for(
    api: _VerticalApi, assessment_id: str, rule: EngineeringRule, *, revision: int, run_id: str
) -> LCSPRunContext:
    return LCSPRunContext(
        assessment_id=assessment_id,
        user_id='customer-release-vertical-1',
        workflow_run_id=run_id,
        scan_job_id='scan-release-vertical-1',
        commit_sha=COMMIT_SHA,
        artifact_versions=dict(ARTIFACT_PINS),
        engineering_rule_ids=(rule.engineering_rule_id,),
        engineering_rule_version=rule_runtime_version(rule),
        criterion_ids=tuple(rule.required_evidence),
        context_revision=revision,
    )


def test_release_failed_resume_never_erases_prior_accepted_result() -> None:
    """Root cause: a crashing resume must not wipe the accepted ledger row.

    Fix: ``analyze_rule`` returns the prior accepted result when both resume
    attempts fail; the ledger still holds exactly the prior row.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    api = _VerticalApi(assessment_id)
    rule = _engineering_rule()
    context = _rule_context(assessment_id)
    confirmed = _normalized_context(
        assessment_id, 'CONTEXT_READY', 2,
        _confirmed_context(assessment_id, 'system_purpose', INITIAL_SYSTEM_PURPOSE, revision=2),
    )

    prior = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=_FakeAnalystDispatcher(api, ['completed']),
        api=api,
        confirmed_context=confirmed,
    )
    assert prior['status'] == RULE_ANALYSIS_STATUSES['completed']
    rows_before = api.list_rule_assessments(assessment_id)
    assert len(rows_before) == 1

    failing = _FakeAnalystDispatcher(api, [RuntimeError('analyst down'), RuntimeError('analyst down')])
    resumed = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=failing,
        api=api,
        confirmed_context=confirmed,
        prior_result=prior,
    )
    assert resumed == prior
    assert api.list_rule_assessments(assessment_id) == rows_before

    evaluations = finalize_rule_results(
        assessment_id=assessment_id,
        rules=[rule],
        api=api,
        applicability_facts=_applicability_facts(),
        context_revision=2,
        commit_sha=COMMIT_SHA,
    )
    assert evaluations[0].status == 'COMPLIANT'


def test_release_per_rule_failure_isolation() -> None:
    """Root cause: one failed rule must not invalidate completed sibling rules.

    Fix: the per-rule loop persists FAILED for the broken rule only; the
    prior completed row stays usable and finalizes COMPLIANT.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    api = _VerticalApi(assessment_id)
    first, second = _engineering_rule(RULE_ID), _engineering_rule(SECOND_RULE_ID)
    context = _rule_context(assessment_id)
    confirmed = _normalized_context(
        assessment_id, 'CONTEXT_READY', 2,
        _confirmed_context(assessment_id, 'system_purpose', INITIAL_SYSTEM_PURPOSE, revision=2),
    )

    completed = analyze_rule(
        rule=first,
        context=context,
        dispatcher=_FakeAnalystDispatcher(api, ['completed']),
        api=api,
        confirmed_context=confirmed,
    )
    assert completed['status'] == RULE_ANALYSIS_STATUSES['completed']

    failing = _FakeAnalystDispatcher(api, [RuntimeError('boom'), RuntimeError('boom')])
    failed = analyze_rule(
        rule=second,
        context=context,
        dispatcher=failing,
        api=api,
        confirmed_context=confirmed,
    )
    assert failed['status'] == RULE_ANALYSIS_STATUSES['failed']

    rows = api.list_rule_assessments(assessment_id)
    by_rule = {row['engineeringRuleId']: row for row in rows}
    assert by_rule[RULE_ID]['status'] == RULE_ANALYSIS_STATUSES['completed']
    assert by_rule[SECOND_RULE_ID]['status'] == RULE_ANALYSIS_STATUSES['failed']
    assert not usable_rule_result(
        second, by_rule[SECOND_RULE_ID], commit_sha=COMMIT_SHA, applicability_status='NOT_GATED'
    )

    evaluations = finalize_rule_results(
        assessment_id=assessment_id,
        rules=[first, second],
        api=api,
        applicability_facts=_applicability_facts(),
        context_revision=2,
        commit_sha=COMMIT_SHA,
    )
    by_id = {item.engineering_rule_id: item for item in evaluations}
    assert by_id[RULE_ID].status == 'COMPLIANT'
    # No absence semantics: the failed rule defers to UNKNOWN, never concluding.
    assert by_id[SECOND_RULE_ID].status == 'UNKNOWN'


def test_release_applicability_and_completion_gates_replace_planner() -> None:
    """Root cause: the deleted planner used to decide eligibility/conclusion.

    Fix: the deterministic applicability gate decides eligibility, an
    explicitly NOT_APPLICABLE rule finalizes without analysis, the completion
    gate withholds partial conclusions, and NOT_OBSERVED never turns
    NON_COMPLIANT.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    api = _VerticalApi(assessment_id)
    rule = _engineering_rule()

    by_legal = legal_rule_id_index([RULE_ID])
    gate = evaluate_applicability(
        [{'legalRuleId': RULE_ID}],
        ai_discovery=None,
        confirmed_statements=(),
        engineering_rule_ids_by_legal=by_legal,
    )
    assert gate[RULE_ID]['status'] == APPLICABILITY_STATUSES['not_gated']

    not_applicable = finalize_rule_results(
        assessment_id=assessment_id,
        rules=[rule],
        api=api,
        applicability_facts=_applicability_facts(),
        context_revision=2,
        applicability={RULE_ID: {'status': APPLICABILITY_STATUSES['not_applicable']}},
        commit_sha=COMMIT_SHA,
    )
    assert not_applicable[0].status == 'NOT_APPLICABLE'
    assert api.list_rule_assessments(assessment_id) == []

    terminal = EngineeringRuleEvaluation(
        engineering_rule_id=RULE_ID,
        legal_rule_id=LEGAL_RULE_ID,
        concept='approval authority',
        status=ENGINEERING_RULE_EVALUATION_STATUSES['compliant'],
        reason='evidence shows the requirement is met',
        evidence_refs=(EVIDENCE_REF,),
        source_chunk_ids=('chunk-release-vertical-1',),
        source_locators=('Article 1',),
        confidence=0.9,
        limitations=(),
    )
    gated_eval, provenance = apply_rule_completion_gate(
        terminal,
        {
            'ruleId': RULE_ID,
            'ruleConclusionReady': False,
            'unresolvedCriterionIds': ['CONTROL'],
            'activeNeedIds': [],
            'applicability': 'MATCHED',
            'contextRevision': 2,
        },
    )
    assert gated_eval.status == 'UNKNOWN'
    assert provenance is not None and provenance['withheldStatus'] == 'COMPLIANT'

    # NOT_OBSERVED is epistemic ("not established by this investigation"):
    # it finalizes UNKNOWN, never NON_COMPLIANT.
    observed_only = _completed_row(
        _rule_context_for(api, assessment_id, rule, revision=2, run_id='run-not-observed'),
    )
    observed_only['status'] = RULE_ANALYSIS_STATUSES['unresolved']
    observed_only['criteria'] = [{
        'criterionId': 'CONTROL',
        'status': RULE_CRITERION_STATUSES['notObserved'],
        'evidenceRefs': [],
        'evidence': [],
        'technicalFacts': [],
        'limitations': ['ENGINEERING_EVIDENCE_INSUFFICIENT'],
    }]
    observed_only['limitations'] = ['ENGINEERING_EVIDENCE_INSUFFICIENT']
    api.put_rule_assessment(assessment_id, RULE_ID, observed_only)
    evaluations = finalize_rule_results(
        assessment_id=assessment_id,
        rules=[rule],
        api=api,
        applicability_facts=_applicability_facts(),
        context_revision=2,
        commit_sha=COMMIT_SHA,
    )
    assert evaluations[0].status == 'UNKNOWN'
    assert evaluations[0].status != 'NON_COMPLIANT'


def test_release_targeted_resume_binding_is_strict_and_replay_safe() -> None:
    """Root cause: a confirmed answer must resume exactly its own need/rule.

    Fix: the targeted resume boundary guards CONTEXT_RESOLVED, the
    server-stamped continuation binds strictly via ``_bind_answer_to_need``,
    and the post-guard store makes duplicate delivery a no-op.
    """
    assessment_id = f'assessment-release-{uuid4().hex}'
    config = SimpleNamespace(langgraph_checkpoint_database_url=CHECKPOINT_URL)
    api = _VerticalApi(assessment_id)
    api.current_revision = 2
    api.processed_revision = 2
    api.state = {
        'outcome': 'CONTEXT_READY',
        'contextRevision': 2,
        'orchestrationRequested': False,
    }
    rule = _engineering_rule()

    analyst = _FakeAnalystDispatcher(api, ['needs_context'])
    needs_row = analyze_rule(
        rule=rule,
        context=_rule_context(assessment_id),
        dispatcher=analyst,
        api=api,
        confirmed_context=_normalized_context(
            assessment_id, 'CONTEXT_READY', 2,
            _confirmed_context(assessment_id, 'system_purpose', INITIAL_SYSTEM_PURPOSE, revision=2),
        ),
    )
    registered = register_business_needs(
        rule=rule, assessment=needs_row, context=_rule_context(assessment_id),
        api=api, user_id='customer-release-vertical-1',
    )
    assert registered == [api.targeted_need['needId']]

    interview_factory = _targeted_interview_factory(assessment_id)
    dispatcher = RootSubagentDispatcher(agent_factory=interview_factory)
    store = PostGuardContinuationStore(CHECKPOINT_URL)
    captured: list[tuple[dict[str, Any], str]] = []
    targeted_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=lambda payload, correlation_id: captured.append((payload, correlation_id)),
        continuation_store=store,
    )
    targeted_resume.handle(
        _resume_message(assessment_id, revision=2, targeted=True),
        'corr-release-targeted-question',
    )
    assert api.state['outcome'] == 'WAITING_FOR_CUSTOMER'

    api.submit_targeted_answer()
    targeted_resume.handle(
        _resume_message(assessment_id, revision=3, targeted=True),
        'corr-release-targeted-answer',
    )
    assert api.state['activeQuestion']['control'] == 'CONFIRM_ADJUST'

    api.submit_targeted_confirmation()
    targeted_resume.handle(
        _resume_message(assessment_id, revision=4, targeted=True),
        'corr-release-targeted-resolved',
    )
    assert len(captured) == 1
    assert captured[0][0]['outcome'] == 'CONTEXT_RESOLVED'
    assert captured[0][0]['contextRevision'] == 4

    # Strict answer binding on the boundary-produced guarded decision.
    decision = api.last_decision
    assert decision is not None and 'continuation' in decision
    typed = _normalized_context(
        assessment_id, 'CONTEXT_RESOLVED', 4, decision['confirmedContext']
    )
    assert _bind_answer_to_need(decision['continuation'], typed) == RULE_ID

    foreign_continuation = {**decision['continuation'], 'needId': 'need:foreign'}
    try:
        _bind_answer_to_need(foreign_continuation, typed)
    except RuntimeError:
        pass
    else:  # pragma: no cover - the guard must fail closed
        raise AssertionError('foreign needId must not bind')

    foreign_criterion = {
        **decision['continuation'],
        'resolutionCriterionIds': ['SOME_OTHER_CRITERION'],
    }
    try:
        _bind_answer_to_need(foreign_criterion, typed)
    except RuntimeError:
        pass
    else:  # pragma: no cover - the guard must fail closed
        raise AssertionError('foreign criterion must not bind')

    # Exact resume is replay safe: duplicate delivery dispatches no new
    # Interview turn, captures no new continuation, registers no new need.
    before = (interview_factory.invoke_count, len(captured), len(api.registered_needs))
    targeted_resume.handle(
        _resume_message(assessment_id, revision=4, targeted=True),
        'corr-release-targeted-replay',
    )
    assert (interview_factory.invoke_count, len(captured), len(api.registered_needs)) == before
    assert interview_factory.invoke_count == 4

    # The post-guard store itself is pending/completed keyed and replay safe.
    record = store.get(
        assessment_id=assessment_id, context_revision=4, outcome='CONTEXT_RESOLVED'
    )
    assert record is not None and record.completed
