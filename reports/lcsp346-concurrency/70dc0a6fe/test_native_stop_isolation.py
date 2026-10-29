"""Provider-free acceptance probe against the exact PR source.

This uses the real Root runner, native LangGraph checkpoints and control
middleware. Only the API tool plane and model responses are deterministic
stand-ins. It is not a production Stop/Continue acceptance result.
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.runner import run_assessment_root
from test_assessment_root_agent import FakeClient, RootScriptedModel, _call, complete_root_messages


def test_stop_a_does_not_stop_b_and_continue_restores_only_as_checkpoint(tmp_path):
    class Client(FakeClient):
        def __init__(self, account):
            super().__init__()
            self.account = account
            self.thread, self.execution, self.snapshot, self.control_request = (str(uuid4()) for _ in range(4))
            self.control = 'RUNNING'
            self.checkpoint = None
            self.states = []

        def claim(self, assessment):
            return {**super().claim(assessment), 'threadId': self.thread,
                    'executionId': self.execution, 'resumeCheckpointId': self.checkpoint}

        def context(self):
            return {**super().context(), 'threadId': self.thread,
                    'repositorySnapshotId': self.snapshot,
                    'repositoryCommit': ('a' if self.account == 'A' else 'b') * 40}

        def root_control(self):
            return {'state': self.control, 'targetRunId': self.execution, 'requestId': self.control_request}

        def finish(self, state, **metadata):
            self.states.append(state)
            if metadata.get('checkpoint_id'):
                self.checkpoint = metadata['checkpoint_id']
            return super().finish(state, **metadata)

    a, b = Client('A'), Client('B')
    aid, bid = str(uuid4()), str(uuid4())
    started = [threading.Event(), threading.Event()]
    released = [threading.Event(), threading.Event()]

    class Model(RootScriptedModel):
        index: int

        def _generate(self, messages, **kwargs):
            if not self.prompts:
                started[self.index].set()
                assert released[self.index].wait(15)
            answer = super()._generate(messages, **kwargs)
            if self.index == 0:
                a.control = 'STOP_REQUESTED'
            return answer

    saver = InMemorySaver()
    backends = []
    for client in [a, b]:
        path = tmp_path / client.account
        path.mkdir()
        backends.append(FilesystemBackend(root_dir=path, virtual_mode=True))

    def run(client, assessment, backend, model):
        return run_assessment_root(client, assessment, backend_factory=lambda *_: (backend, None),
                                   model=model, checkpointer=saver, governance=())

    with ThreadPoolExecutor(max_workers=2) as pool:
        fa = pool.submit(run, a, aid, backends[0], Model(index=0, responses=[_call('accept_case_fact', {
            'kind': 'FACT', 'statement': 'Fixture-only bounded source fact.',
            'evidence_ids': ['66666666-6666-4666-8666-666666666666'],
        }, 'source-fact')]))
        fb = pool.submit(run, b, bid, backends[1], Model(index=1, responses=complete_root_messages()))
        try:
            assert all(event.wait(10) for event in started), 'Both native Roots must reach inference together'
            released[0].set()
            paused = fa.result(timeout=10)
            assert paused['state'] == 'PAUSED'
            assert paused['threadId'] == a.thread and paused['executionId'] == a.execution
            assert paused['checkpointId'] == a.checkpoint
            assert not fb.done() and not b.states and b.control == 'RUNNING'
            assert not any(kind == 'fact' for kind, _ in a.calls)
            b_checkpoint = saver.get_tuple({'configurable': {'thread_id': b.thread}}).config['configurable']['checkpoint_id']
            a.control = 'RUNNING'
            resumed = pool.submit(run, a, aid, backends[0], RootScriptedModel(responses=complete_root_messages())).result(timeout=10)
            assert resumed['state'] == 'SUCCEEDED'
            assert resumed['threadId'] == paused['threadId'] and resumed['executionId'] == paused['executionId']
            assert sum(kind == 'fact' for kind, _ in a.calls) == 1
            assert not fb.done() and not b.states
            assert saver.get_tuple({'configurable': {'thread_id': b.thread}}).config['configurable']['checkpoint_id'] == b_checkpoint
            released[1].set()
            assert fb.result(timeout=10)['state'] == 'SUCCEEDED'
        finally:
            for event in released:
                event.set()
    assert a.states == ['PAUSED', 'SUCCEEDED'] and b.states == ['SUCCEEDED']
    assert a.checkpoint != b.checkpoint
