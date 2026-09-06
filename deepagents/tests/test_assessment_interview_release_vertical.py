from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Annotated, Any, TypedDict
from uuid import uuid4

import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from orchestration.dispatcher import RootSubagentDispatcher
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket
from tools.common.capabilities.assessment.investigation.engineering_rule import (
    managed_targeted_investigator as managed,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
    _ConfirmedContextPipeline,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    ManagedTargetedInvestigatorPipeline,
    _ExactResumePlanner,
    _ResumedHandoffInvestigator,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.planned_pipeline import (
    PlannedEngineeringInvestigationPipeline,
)
from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    EngineeringRulePlanner,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
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
LEGAL_RULE_ID = 'LEGAL-RELEASE-VERTICAL-1'
EVIDENCE_REF = 'EV-RELEASE-VERTICAL-1'
NEED_ID = 'need-release-vertical-1'
SOURCE_VERSION = f'{SNAPSHOT_ID}:abc123'
PGE_VERSION = f'{REPORT_ID}:v1'
ARTIFACT_PINS = {
    'technicalEvidenceReportId': REPORT_ID,
    'repositorySnapshotId': SNAPSHOT_ID,
    'legalRuleCatalogVersionId': CATALOG_ID,
    'legalCorpusVersionId': CORPUS_ID,
}


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
                'evidenceRefs': ['evidence:customer:release'],
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


def _context_answers(context: dict[str, Any]) -> dict[str, Any]:
    return {
        str(item['topic']): item.get('normalizedValue', item.get('statement'))
        for item in context.get('statements') or []
        if isinstance(item, dict) and item.get('topic')
    }


class _DurableState(TypedDict, total=False):
    messages: Annotated[list[Any], add_messages]
    structured_response: dict[str, Any]


def _program_graph() -> dict[str, Any]:
    return {
        'graph_id': 'graph-release-vertical-1',
        'snapshot_id': SNAPSHOT_ID,
        'commit_sha': 'abc123',
        'node_count': 1,
        'edge_count': 0,
        'coverage_state': 'PARTIAL',
        'coverage_notes': ['dynamic configuration remains bounded but incomplete'],
        'nodes': [
            {
                'node_id': 'node:ai',
                'node_type': 'AI_MODEL_INVOCATION',
                'label': 'responses.create',
                'source': {'file_path': 'src/service.py', 'symbol_ref': 'responses.create', 'start_line': 1, 'end_line': 3},
                'attributes': {},
                'semantic_types': [],
                'evidence_refs': [EVIDENCE_REF],
                'origin': 'STATIC_ANALYSIS',
                'resolution_state': 'CORROBORATED',
                'support_refs': [],
            }
        ],
        'edges': [],
        'source_anchors': [],
        'evidence_refs': [EVIDENCE_REF],
        'graph_hash': 'sha256:release-vertical-graph',
    }


def _report(assessment_id: str) -> dict[str, Any]:
    return {
        'id': REPORT_ID,
        'assessment_id': assessment_id,
        'user_id': 'customer-release-vertical-1',
        'snapshot_id': SNAPSHOT_ID,
        'scan_job_id': 'scan-release-vertical-1',
        'schema_version': '2.0.0',
        'evidence_payload': {'evidence_graph': _program_graph()},
    }


def _engineering_rule() -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id=RULE_ID,
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
        required_evidence=('CONTROL',),
        source_chunk_ids=('chunk-release-vertical-1',),
        source_locators=('Article 1',),
    )


class _Retriever:
    def index_corpus(self, _corpus_version_id, _chunks):
        return None


class _RuleService:
    def get_or_compile(self, **_kwargs):
        return ([_engineering_rule()], True)


class _QueryExecutor:
    def __init__(self) -> None:
        self.confirmed_contexts: list[dict[str, Any]] = []

    def execute(self, engineering_rule, _graph, confirmed_customer_context=None):
        context = dict(confirmed_customer_context or {})
        self.confirmed_contexts.append(context)
        return InvestigationPacket(
            engineering_rule_id=engineering_rule.engineering_rule_id,
            concept=engineering_rule.concept,
            investigation_goals=engineering_rule.investigation_goals,
            initial_results=(
                {
                    'nodes': [_program_graph()['nodes'][0]],
                    'evidenceRefs': [EVIDENCE_REF],
                    'materialHitCount': 1,
                },
            ),
            starting_node_types=engineering_rule.starting_node_types,
            target_node_types=engineering_rule.target_node_types,
            evidence_refs=(EVIDENCE_REF,),
            confirmed_customer_context=context,
            required_evidence=engineering_rule.required_evidence,
        )


class _RecordingPlanner(EngineeringRulePlanner):
    def __init__(self) -> None:
        super().__init__()
        self.calls = 0

    def plan(self, **kwargs):
        self.calls += 1
        return super().plan(**kwargs)


class _SnapshotClient:
    def download_snapshot_archive(self, _request):
        return b'release-vertical-snapshot'


class _Workspace:
    def __init__(self, path) -> None:
        self.path = path

    def materialize(self, _job_id, _archive, *, snapshot_id):
        assert snapshot_id == SNAPSHOT_ID
        return SimpleNamespace(
            workspace_path=self.path,
            extracted_files=1,
            skipped_files=0,
            coverage_limited=False,
        )

    def cleanup(self, _job_id):
        return None


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
        self.targeted_continuation: dict[str, Any] | None = None
        self.classification_callbacks: list[Any] = []
        self.initial_questions: list[dict[str, Any]] = []

    def get_accepted_technical_evidence_report(self, report_id: str):
        assert report_id == REPORT_ID
        return _report(self.assessment_id)

    def get_active_legal_rule_catalog(self):
        return {
            'versionId': CATALOG_ID,
            'rules': [{'legalRuleId': LEGAL_RULE_ID, 'status': 'APPROVED'}],
        }

    def get_active_legal_corpus(self):
        return {'versionId': CORPUS_ID}

    def get_legal_corpus_chunks(self, corpus_version_id: str):
        assert corpus_version_id == CORPUS_ID
        return {
            'chunks': [
                {
                    'id': 'chunk-release-vertical-1',
                    'content': 'Governed legal source fixture for the release gate.',
                }
            ]
        }

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
            'answer': {'freeText': 'The system provides recommendations only.'},
            'authority': 'CUSTOMER_STATED',
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 1,
            'orchestrationRequested': True,
        }

    def post_interview_targeted_need(self, assessment_id: str, payload):
        assert assessment_id == self.assessment_id
        assert payload['artifactVersions'] == ARTIFACT_PINS
        self.targeted_need = {
            'needId': payload['needId'],
            'businessContextNeed': payload['businessContextNeed'],
            'resolutionCriteria': list(payload['resolutionCriteria']),
            'originatingInvestigationReference': payload[
                'originatingInvestigationReference'
            ],
        }
        self.targeted_continuation = {
            'originatingInvestigationReference': payload[
                'originatingInvestigationReference'
            ],
            'investigatorExecutionId': payload['investigatorExecutionId'],
            'workflowRunId': payload['workflowRunId'],
            'checkpointId': payload['checkpointId'],
            'affectedRuleIds': list(payload['affectedRuleIds']),
            'artifactVersions': dict(payload['artifactVersions']),
            'sourceVersion': SOURCE_VERSION,
            'pgeVersion': PGE_VERSION,
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': self.current_revision,
            'orchestrationRequested': True,
        }
        return dict(self.state)

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
            'sourceVersion': SOURCE_VERSION,
            'pgeVersion': PGE_VERSION,
            'publicState': dict(self.state),
            'privateRevision': (
                dict(self.private_revision)
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
            assert self.targeted_continuation is not None
            confirmed = payload.get('confirmedContext') or {}
            answers = _context_answers(confirmed)
            for criterion in self.targeted_need['resolutionCriteria']:
                assert criterion in answers
            guarded['continuation'] = dict(self.targeted_continuation)
        self.state = guarded
        if outcome in {'CONTEXT_READY', 'CONTEXT_RESOLVED'}:
            self.processed_revision = expected
        return dict(guarded)

    def submit_targeted_answer(self) -> None:
        self.current_revision = 2
        self.private_revision = {
            'revision': 2,
            'answer': {
                'freeText': 'A human manager must approve before action.'
            },
            'authority': 'CUSTOMER_CONFIRMED',
        }
        self.state = {
            'outcome': 'WAITING_FOR_CUSTOMER',
            'contextRevision': 2,
            'orchestrationRequested': True,
        }

    def post_classification_callback(self, payload):
        self.classification_callbacks.append(payload)
        return {'accepted': True}


def _durable_create_agent_factory(run_counter: list[int]):
    def create_agent(**kwargs):
        checkpointer = kwargs['checkpointer']
        builder = StateGraph(_DurableState)

        def investigator(state: _DurableState):
            run_counter.append(1)
            if len(state.get('messages') or []) <= 1:
                structured = {
                    'status': 'NEEDS_INPUT',
                    'artifact_versions': dict(ARTIFACT_PINS),
                    'claims': [],
                    'limitations': [],
                    'missing_input': 'Customer approval authority is required.',
                    'business_context_need': {
                        'need_id': NEED_ID,
                        'business_context_need': (
                            'Who approves the AI recommendation before action?'
                        ),
                        'resolution_criteria': ['decision_authority'],
                    },
                    'next_step': 'RESOLVE',
                }
            else:
                structured = {
                    'status': 'READY',
                    'artifact_versions': dict(ARTIFACT_PINS),
                    'claims': [
                        {
                            'claim_id': 'claim-release-vertical-1',
                            'engineering_rule_id': RULE_ID,
                            'claim_type': 'RULE_REQUIREMENT_MET',
                            'value': True,
                            'evidence_refs': [EVIDENCE_REF],
                            'graph_path_refs': [],
                            'source_anchor_refs': [],
                            'confidence': 0.95,
                            'limitations': [],
                            'criterion': 'CONTROL',
                        }
                    ],
                    'limitations': [],
                    'missing_input': None,
                    'business_context_need': None,
                    'next_step': 'GATE',
                }
            return {'structured_response': structured}

        builder.add_node('investigator', investigator)
        builder.add_edge(START, 'investigator')
        builder.add_edge('investigator', END)
        return builder.compile(checkpointer=checkpointer)

    return create_agent


def _resume_message(assessment_id: str, *, revision: int, targeted: bool) -> dict:
    return {
        'assessmentId': assessment_id,
        'threadId': f'interview:{assessment_id}',
        'questionId': NEED_ID if targeted else 'question-initial-1',
        'contextRevision': revision,
        'sourceVersion': SOURCE_VERSION,
        'pgeVersion': PGE_VERSION,
        'resumeReason': (
            'TARGETED_INTERVIEW_REQUIRED'
            if targeted
            else 'INTERVIEW_AGENT_DECISION_REQUIRED'
        ),
    }


def test_release_gate_crosses_production_boundaries_and_exact_resume_is_replay_safe(
    monkeypatch,
    tmp_path,
) -> None:
    assessment_id = f'assessment-release-{uuid4().hex}'
    config = SimpleNamespace(langgraph_checkpoint_database_url=CHECKPOINT_URL)
    api = _VerticalApi(assessment_id)
    interview_factory = _ScriptedSpecialistFactory(
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
                'contextAuthority': 'CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'system_purpose',
                    'AI-assisted recommendation',
                    revision=1,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 1,
                'mode': 'TARGETED_INTERVIEW',
                'outcome': 'WAITING_FOR_CUSTOMER',
                'activeQuestion': {
                    'id': 'question-targeted-1',
                    'intent': 'CLARIFY',
                    'control': 'FREE_TEXT',
                    'prompt': 'Who must approve the recommendation before action?',
                    'needId': NEED_ID,
                },
                'confirmedContext': {},
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
            {
                'expectedContextRevision': 2,
                'mode': 'TARGETED_INTERVIEW',
                'outcome': 'CONTEXT_RESOLVED',
                'contextAuthority': 'CONFIRMED',
                'confirmedContext': _confirmed_context(
                    assessment_id,
                    'decision_authority',
                    'A human manager must approve before action',
                    revision=2,
                ),
                'flags': [],
                'blockedActions': [],
                'targetedResolution': {},
            },
        ]
    )
    dispatcher = RootSubagentDispatcher(agent_factory=interview_factory)
    run_counter: list[int] = []
    monkeypatch.setattr(
        managed,
        'create_agent',
        _durable_create_agent_factory(run_counter),
    )

    architecture = tmp_path / 'openwiki' / 'architecture'
    architecture.mkdir(parents=True)
    (architecture / 'overview.md').write_text(
        '# Runtime Architecture\n\nThe AI model invocation feeds a human review workflow before approval.',
        encoding='utf-8',
    )
    workspace = _Workspace(tmp_path)
    initial_query = _QueryExecutor()
    planner = _RecordingPlanner()
    planned = PlannedEngineeringInvestigationPipeline(
        api_client=api,
        retriever=_Retriever(),
        rule_service=_RuleService(),
        query_executor=initial_query,
        planner=planner,
    )
    managed_pipeline = ManagedTargetedInvestigatorPipeline(
        delegate=planned,
        config=config,
        api_client=api,
    )
    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
        investigation_pipeline=managed_pipeline,
        snapshot_client=_SnapshotClient(),
        code_workspace=workspace,
        triage_trigger_publisher=lambda _payload: None,
    )
    event = {
        'assessmentId': assessment_id,
        'evidenceReportId': REPORT_ID,
        'workflowRunId': f'assessment-run:{assessment_id}',
    }

    boundary.handle(event, 'corr-release-bootstrap')
    assert len(api.initial_questions) == 1
    assert planner.calls == 0
    assert run_counter == []

    api.submit_initial_answer()
    store = PostGuardContinuationStore(CHECKPOINT_URL)

    def continue_initial_after_guard(_payload, correlation_id):
        boundary.handle(event, correlation_id)

    initial_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=continue_initial_after_guard,
        continuation_store=store,
    )
    initial_resume.handle(
        _resume_message(assessment_id, revision=1, targeted=False),
        'corr-release-initial-answer',
    )

    assert planner.calls == 1
    assert initial_query.confirmed_contexts[0]['contextRevision'] == 1
    assert initial_query.confirmed_contexts[0]['authority'] == (
        'CUSTOMER_CONFIRMED_CONFIRMED_ONLY'
    )
    assert initial_query.confirmed_contexts[0]['answers'] == {
        'system_purpose': 'AI-assisted recommendation'
    }
    assert run_counter == [1]
    assert api.targeted_need is not None
    assert api.targeted_need['needId'] == NEED_ID
    assert 'checkpointId' not in api.targeted_need
    assert 'investigatorExecutionId' not in api.targeted_need
    assert api.targeted_continuation is not None
    original_checkpoint = api.targeted_continuation['checkpointId']
    assert original_checkpoint
    assert api.classification_callbacks == []

    targeted_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
        continuation_store=store,
    )
    targeted_resume.handle(
        _resume_message(assessment_id, revision=1, targeted=True),
        'corr-release-targeted-question',
    )
    assert api.state['outcome'] == 'WAITING_FOR_CUSTOMER'
    assert api.state['activeQuestion']['needId'] == NEED_ID

    api.submit_targeted_answer()
    completion_query = _QueryExecutor()

    def complete_with_production_gate(**kwargs):
        continuation = kwargs['continuation']
        confirmed_context = kwargs['confirmed_context']
        affected = tuple(continuation['affectedRuleIds'])
        completion = PlannedEngineeringInvestigationPipeline(
            api_client=api,
            retriever=_Retriever(),
            rule_service=_RuleService(),
            query_executor=completion_query,
            planner=_ExactResumePlanner(affected),
            investigator=_ResumedHandoffInvestigator(
                affected_rule_ids=affected,
                handoff=kwargs['resumed_handoff'],
            ),
        )
        EngineeringAssessmentBoundary(
            config,
            api_client=api,
            investigation_pipeline=_ConfirmedContextPipeline(
                completion,
                confirmed_context,
            ),
            snapshot_client=_SnapshotClient(),
            code_workspace=workspace,
            triage_trigger_publisher=lambda _payload: None,
        ).handle(
            {
                'assessmentId': assessment_id,
                'evidenceReportId': REPORT_ID,
                'workflowRunId': f"{continuation['workflowRunId']}:gate:2",
            },
            kwargs['correlation_id'],
        )

    targeted_resume._investigation_completer = complete_with_production_gate
    resolved_message = _resume_message(
        assessment_id,
        revision=2,
        targeted=True,
    )
    targeted_resume.handle(
        resolved_message,
        'corr-release-targeted-resolved',
    )

    assert api.state['outcome'] == 'CONTEXT_RESOLVED'
    assert run_counter == [1, 1]
    assert completion_query.confirmed_contexts[0]['contextRevision'] == 2
    assert completion_query.confirmed_contexts[0]['answers'] == {
        'decision_authority': 'A human manager must approve before action'
    }
    assert len(api.classification_callbacks) == 1
    callback = api.classification_callbacks[0]
    assert callback.assessment_id == assessment_id
    assert callback.guardrail_status == 'PASSED'
    assert callback.classification_data['summary']['total'] == 1
    assert callback.classification_data['summary']['compliant'] == 1

    targeted_resume.handle(
        resolved_message,
        'corr-release-targeted-replay',
    )
    assert interview_factory.invoke_count == 4
    assert run_counter == [1, 1]
    assert len(api.classification_callbacks) == 1
