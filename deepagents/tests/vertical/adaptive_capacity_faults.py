"""Owned-process active faults on real API/PG/MQ/native Root; provider and repo are fixtures.

The separate HTTP model adapter deliberately survives Agent Server death. A recorded
model request is an actual fixture HTTP operation, never a paid provider/invoice claim.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import TypedDict
from unittest.mock import patch
from urllib.parse import quote

input_file = Path(sys.argv[1]).resolve()
fixture_name = input_file.parent.name
if input_file.name != "input.json" or not re.fullmatch(r"lcsp364-active-faults-[A-Za-z0-9]+", fixture_name):
    raise ValueError("Owned LCSP-364 fixture input required")
directory = Path(tempfile.gettempdir()) / fixture_name
if directory.resolve() != input_file.parent or directory.stat().st_uid != os.getuid():
    raise ValueError("Fixture directory must be owned under the system temporary directory")
data = json.loads(input_file.read_text())
assert directory == Path(data["dir"]), "Fixture directory mismatch"
root = Path(__file__).resolve().parents[3]
fixture_prefix = "lcsp364.active-faults." + directory.name.rsplit("-", 1)[-1]
os.environ.update(NESTJS_API_BASE_URL=data["base"], DATABASE_URL=data["databaseUrl"],
    LANGGRAPH_CHECKPOINT_DATABASE_URL=data["checkpointDatabaseUrl"], LCSP_AGENT_RUNTIME_MODE="production",
    LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS="2", LCSP_AGENT_SERVER_MAX_CONCURRENT_JOBS="2",
    LCSP_AGENT_SERVER_URL="http://127.0.0.1:3432", RABBITMQ_URL="amqp://guest:guest@127.0.0.1:5678/",
    LCSP_ROOT_CAPACITY_RABBITMQ_MANAGEMENT_URL="http://127.0.0.1:15678",
    LCSP_AGENT_RUNTIME_RABBITMQ_QUEUE_PREFIX=fixture_prefix,
    RABBITMQ_EXCHANGE=fixture_prefix, LANGCHAIN_TRACING_V2="false",
    LCSP_AGENT_SERVER_LOCK_PATH=str(directory/"server.lock"))

import httpx
import pika
import psycopg

key = os.environ["WORKER_API_KEY"]
jobs = {j["label"]: j for j in data["jobs"]}
held = {jobs[label]["assessmentId"] for label in ["active", "short", "crash"]}


def http(method, path, body=None, *, lease=None):
    headers={"x-worker-api-key":key}
    if lease: headers["x-assessment-lease"]=lease
    response=httpx.request(method,data["base"]+path,json=body,headers=headers,timeout=10)
    return response.status_code,response.json()


def server_mode():
    import uvicorn
    from deepagents.backends import FilesystemBackend
    from langgraph.graph import StateGraph, START, END
    from langgraph.runtime import Runtime
    from assessment_root.boundary import AssessmentRootBoundary
    from assessment_root.runner import run_assessment_root
    from tools.common.capabilities.agent_runtime import local_server
    from vertical.scripted_root import DynamicScriptedModel, full_script, _call

    class Model(DynamicScriptedModel):
        assessment_id: str
        step: int=0
        def _generate(self,messages,**kwargs):
            payload={"assessmentId":self.assessment_id,"step":self.step,"serverPid":os.getpid(),"invocationId":str(uuid.uuid4())}
            self.step+=1
            response=httpx.post("http://127.0.0.1:3434/model",json=payload,timeout=180)
            response.raise_for_status()
            return super()._generate(messages,**kwargs)

    def runner(client,assessment_id,**kwargs):
        original=client.claim
        def claim(identity):
            result=original(identity)
            file=directory/("claim-"+identity+".json")
            file.write_text(json.dumps(result));file.chmod(0o600)
            return result
        client.claim=claim
        captured={}
        steps=full_script(captured)+[lambda m:_call("request_finalization",{},"finalize"),
            lambda m:_call("submit_final_report",{"summary":"SYNTHETIC active-fault regression report.","findings":[{"assessment_rule_id":rule,"summary":"Accepted fixture decision.","recommendations":[]} for rule in ["ER-DEF","ER-RET","ER-XREF"]]},"report")]
        kwargs.update(model=Model(responses=[],steps=steps,assessment_id=assessment_id),governance=(),
            backend_factory=lambda claim,context:(FilesystemBackend(root_dir=data["repoDir"],virtual_mode=True),None))
        return run_assessment_root(client,assessment_id,**kwargs)

    boundary=AssessmentRootBoundary(SimpleNamespace(nestjs_api_base_url=data["base"],worker_api_key=key),runner=runner)
    class State(TypedDict):
        messages:list
        result:dict
    def graph(*,checkpointer,store):
        def execute(state,runtime:Runtime):
            return {"result":boundary.handle(runtime.context["system_event"],"active-fault-fixture")}
        builder=StateGraph(State,context_schema=dict)
        builder.add_node("registered_assessment_boundary",execute);builder.add_edge(START,"registered_assessment_boundary");builder.add_edge("registered_assessment_boundary",END)
        return builder.compile(checkpointer=checkpointer,store=store)
    restore=local_server.LocalAgentRuntime._execute_restored_run
    def delayed_restore(self,*args):
        deadline=time.monotonic()+120
        while not (directory/"resume-restored").exists():
            assert time.monotonic()<deadline,"owned recovery barrier timed out"
            time.sleep(.02)
        return restore(self,*args)
    with patch.dict(sys.modules,{"agent":SimpleNamespace(create_root_agent=graph)}),patch.object(local_server.LocalAgentRuntime,"_execute_restored_run",delayed_restore):
        uvicorn.run(local_server.app,host="127.0.0.1",port=3432,log_level="warning")


def bridge_mode():
    from tools.common.capabilities.agent_runtime import rabbitmq_consumer
    logging.basicConfig(level=logging.INFO)
    rabbitmq_consumer.run_consumer()


def main():
    """Business purpose: Exercise owned-process Root failures against real API, PG and MQ authority.

    Business rules:
    - Only the external model and repository are fixtures; real admission, fencing and recovery must hold.
    Execution flow:
    1. Launch owned server/bridge processes, inject faults and verify durable execution/checkpoint state.
    Failure cases:
    - Failed progress or authority assertions fail the scenario and emit allowlisted child diagnostics.
    Side effects:
    - Creates fixture requests and checkpoints, terminates owned processes and writes sanitized evidence.
    """
    events=[];scenarios={};children=[];requests=[];request_lock=threading.Lock();timeline=[]
    child_names={}
    release_signals = {identity: directory / ('release-' + identity) for identity in held}
    class Provider(BaseHTTPRequestHandler):
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            payload.update(startedAt=time.time(),finishedAt=None)
            with request_lock: requests.append(payload)
            release_signal = release_signals.get(payload['assessmentId'])
            if payload['step']==0 and release_signal is not None:
                while not release_signal.exists(): time.sleep(.02)
            with request_lock:payload['finishedAt']=time.time()
            try:
                self.send_response(200);self.end_headers();self.wfile.write(b'{"fixture":true}')
            except (BrokenPipeError,ConnectionResetError):pass
        def log_message(self,*args):pass
    provider=ThreadingHTTPServer(('127.0.0.1',3434),Provider);provider.daemon_threads=True
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    db=psycopg.connect(data['databaseUrl'].split('?')[0],autocommit=True)
    checkpoint=psycopg.connect(data['checkpointDatabaseUrl'],autocommit=True)
    connection=pika.BlockingConnection(pika.URLParameters(os.environ['RABBITMQ_URL']));channel=connection.channel();channel.confirm_delivery()
    def launch(mode,name):
        file=directory/(name+'.log');out=file.open('a');file.chmod(0o600)
        process=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),sys.argv[1],mode],cwd=root/'deepagents',env=os.environ.copy(),stdout=out,stderr=subprocess.STDOUT)
        out.close();children.append(process);child_names[process]=name;return process
    def wait(condition,label,timeout=45):
        deadline=time.monotonic()+timeout
        while True:
            try:
                if condition():return
            except (httpx.HTTPError,FileNotFoundError,TypeError):pass
            assert time.monotonic()<deadline,label
            time.sleep(.1)
    def native():
        response=httpx.get('http://127.0.0.1:3432/internal/execution-capacity',headers={'x-worker-api-key':key},timeout=3)
        response.raise_for_status();return response.json()['data']
    def slots():return [r[0] for r in db.execute('SELECT to_jsonb(t) FROM "AssessmentRootExecutionSlot" t ORDER BY "admittedAt"')]
    def first_count(label):
        with request_lock:return sum(r['assessmentId']==jobs[label]['assessmentId'] and r['step']==0 for r in requests)
    def complete(label):return db.execute('SELECT "lifecycleState" FROM "Assessment" WHERE id=%s',[jobs[label]['assessmentId']]).fetchone()[0]=='COMPLETE'
    def publish(label):
        job=jobs[label];payload=job['message'];actor=payload.get('actor') or {}
        channel.basic_publish(exchange=os.environ['RABBITMQ_EXCHANGE'],routing_key='command.assessment.root.requested.v1',body=json.dumps(payload).encode(),mandatory=True,properties=pika.BasicProperties(content_type='application/json',delivery_mode=2,message_id=job['commandId'],headers={'user_id':actor['id'],'x-correlation-id':payload['correlationId']}))
        db.execute('UPDATE "OutboxMessage" SET status=\'PUBLISHED\',"publishedAt"=clock_timestamp() WHERE id=%s',[job['commandId']])
    def record(name,**fields):
        point={'at':time.time(),'event':name,'heldPhysicalRunIds':[s['runId'] for s in slots() if s['releasedAt'] is None],**fields}
        try:point['native']=native()
        except httpx.HTTPError:point['nativeObservation']='UNAVAILABLE'
        events.append(point)
    def replay(command):
        response=httpx.post(data['base']+'/internal/outbox/dlq/'+quote(command,safe='')+'/replay',headers={'Authorization':'Bearer '+data['adminToken']},json={},timeout=10)
        return response.status_code
    def state_sample():
        try:timeline.append({'at':time.time(),'native':native(),'heldSlots':sum(s['releasedAt'] is None for s in slots())})
        except Exception:pass
    failure=None
    try:
        server=launch('--server','server-before')
        wait(lambda:httpx.get('http://127.0.0.1:3432/ok',timeout=2).status_code==200,'native server unavailable')
        bridge_a=launch('--bridge','bridge-a');bridge_b=launch('--bridge','bridge-b')
        queue=fixture_prefix+'.assessment_root_requested'
        def consumers_ready():
            try:return channel.queue_declare(queue,passive=True).method.consumer_count==2
            except Exception:return False
        # Connection-thread setup is observed through management to avoid closing a channel on missing passive queue.
        wait(lambda: all('Starting Agent Runtime RabbitMQ consumer' in (directory/(n+'.log')).read_text() for n in ['bridge-a','bridge-b']),'two bridges did not bind')
        wait(lambda:db.execute('SELECT effective FROM "AssessmentRootCapacity"').fetchone()[0]==2,'measured native capacity unavailable')
        for label in ['active','short','queued']:publish(label)
        wait(lambda:first_count('active')==1 and first_count('short')==1,'two real native model calls did not start')
        assert native()['activeNativeRoots']==2
        assert db.execute('SELECT "currentExecutionId" FROM "AssessmentRuntime" WHERE "assessmentId"=%s',[jobs['queued']['assessmentId']]).fetchone()[0] is None
        from tools.common.capabilities.agent_runtime.agent_server_client import agent_thread_id
        thread=agent_thread_id('assessment_root_requested',jobs['active']['message'],jobs['active']['message']['correlationId'])
        wait(lambda:any(thread in (directory/(name+'.log')).read_text() for name in ['bridge-a','bridge-b']),'active delivery ownership absent')
        bridge=next(p for p,name in [(bridge_a,'bridge-a'),(bridge_b,'bridge-b')] if thread in (directory/(name+'.log')).read_text())
        bridge.send_signal(signal.SIGTERM);time.sleep(.4)
        assert bridge.poll() is None and native()['activeNativeRoots']==2 and sum(s['releasedAt'] is None for s in slots())==2
        record('BRIDGE_SIGTERM_DURING_ACTIVE_MODEL',pid=bridge.pid);scenarios['activeGracefulBridgeDrain']='PASS'
        bridge.kill();bridge.wait(10);record('BRIDGE_SIGKILL_DURING_ACTIVE_MODEL',pid=bridge.pid)
        time.sleep(.5);assert first_count('active')==first_count('short')==1
        scenarios['activeAbruptBridgeRedelivery']='PASS'
        (directory/('release-'+jobs['short']['assessmentId'])).touch()
        independent={jobs[label]['assessmentId'] for label in ['short','queued']}
        wait(lambda:complete('short') and complete('queued') and all(s['releasedAt'] for s in slots() if s['assessmentId'] in independent),'independent short/queued Root did not physically quiesce',70)
        assert first_count('active')==1
        record('QUEUED_ROOT_PROGRESS_WITH_LONG_ROOT_ALIVE');scenarios['twoOwnerFairBackpressure']='PASS'
        route=directory/'route.tmp';route.write_text(json.dumps({'port':data['apiPorts'][1]}));route.replace(directory/'route.json')
        os.kill(data['apiPids'][0],signal.SIGKILL)
        assert http('GET','/health')[0]==200 and native()['activeNativeRoots']==1
        record('API_PROCESS_KILLED_OTHER_REPLICA_AVAILABLE',pid=data['apiPids'][0]);scenarios['apiReplicaFailure']='PASS'
        active=jobs['active']['assessmentId'];claim=json.loads((directory/('claim-'+active+'.json')).read_text())
        db.execute('UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE "assessmentId"=%s',[active])
        assert http('POST',f'/internal/assessment-runtime/{active}/heartbeat',{},lease=claim['leaseToken'])[0]==403
        assert any(s['assessmentId']==active and s['releasedAt'] is None for s in slots())
        publish('active');time.sleep(.3);assert first_count('active')==1
        record('EXPIRED_LEASE_DID_NOT_RELEASE_LIVE_PHYSICAL_ROOT');scenarios['liveLeaseExpiry']='PASS'
        publish('crash');publish('after-crash')
        wait(lambda:first_count('crash')==1 and native()['activeNativeRoots']==2,'second active Root for crash missing')
        old=db.execute('SELECT "hostId","incarnationId" FROM "AssessmentRootCapacity"').fetchone()
        crash=jobs['crash']['assessmentId'];old_claim=json.loads((directory/('claim-'+crash+'.json')).read_text());old_slot=next(s for s in slots() if s['assessmentId']==crash)
        server.kill();server.wait(10)
        with request_lock:assert sum(r['finishedAt'] is None for r in requests)>=2
        assert sum(s['releasedAt'] is None for s in slots())==2
        record('SERVER_SIGKILL_EXTERNAL_FIXTURE_REQUESTS_SURVIVE',pid=server.pid,heldSlots=2)
        replacement=launch('--server','server-after')
        wait(lambda:db.execute('SELECT "incarnationId" FROM "AssessmentRootCapacity"').fetchone()[0]!=old[1],'server incarnation did not change')
        heartbeat=http('POST',f'/internal/assessment-runtime/{crash}/heartbeat',{},lease=old_claim['leaseToken'])[0]
        late_finish=http('POST',f'/internal/assessment-runtime/{crash}/finish',{'state':'FAILED','checkpointId':str(uuid.uuid4())},lease=old_claim['leaseToken'])[0]
        stale_claim=http('POST',f'/internal/assessment-runtime/{crash}/claim',{'runtimeRunId':old_slot['runId']})[0]
        old_claim_status=http('POST',f'/internal/assessment-runtime/{crash}/claim',{'runtimeRunId':old_slot['runId'],'runtimeIncarnationId':str(old[1])})[0]
        stale_quiesce=http('POST','/internal/assessment-root-capacity/quiesce',{'hostId':old[0],'incarnationId':str(old[1]),'runId':old_slot['runId']})[0]
        record('STALE_REQUESTS_BEFORE_REPLACEMENT_ROOT_RECLAIM',heartbeatStatus=heartbeat,lateFinishStatus=late_finish,compatibilityClaimStatus=stale_claim,oldIncarnationClaimStatus=old_claim_status,oldIncarnationQuiesceStatus=stale_quiesce)
        scenarios['staleLeaseAndClaimFencing']='PASS' if heartbeat==403 and late_finish==403 and stale_claim in [403,409,422,429] and old_claim_status==409 and stale_quiesce==409 else 'FAILED'
        (directory/'hold-capacity-reports').touch();(directory/'fail-quiesce-once').touch();(directory/'resume-restored').touch()
        wait(lambda: first_count('active')>1 or first_count('crash')>1 or all(r[0]=='FAILED' for r in db.execute('SELECT "executionState" FROM "AssessmentRuntime" WHERE "assessmentId"=ANY(%s)',[[active,crash]])),'restored running Roots neither fail closed nor resume',30)
        auto_replayed=first_count('active')>1 or first_count('crash')>1
        scenarios['uncertainModelReplayRefused']='FAILED' if auto_replayed else 'PASS'
        assert not auto_replayed,'A running Root repeated an uncertain model step automatically after server crash'
        wait(lambda: not (directory/'fail-quiesce-once').exists(),'lost quiescence injection not reached',10)
        wait(lambda: sum(s['releasedAt'] is None for s in slots() if s['assessmentId'] in [active,crash])==1,'lost quiescence did not settle to exactly one withheld slot',10)
        withheld=next(s for s in slots() if s['releasedAt'] is None and s['assessmentId'] in [active,crash])
        status=replay(withheld['commandId'])
        assert status==409,f'Operator replay admitted work before physical release (status={status})'
        record('OPERATOR_REPLAY_REFUSED_BEFORE_QUIESCENCE',commandId=withheld['commandId'])
        (directory/'hold-capacity-reports').unlink()
        wait(lambda:complete('after-crash'),'queued independent Root did not progress after confirmed death',60)
        wait(lambda:not any(s['releasedAt'] is None for s in slots()),'lost quiescence receipt did not reconcile',20)
        assert (directory/'proxy.jsonl').exists(),'quiescence-loss injection was not exercised'
        scenarios['lostQuiescenceRecovery']='PASS';scenarios['queuedRootAfterCrash']='PASS'
        assert scenarios['staleLeaseAndClaimFencing']=='PASS','A stale Root lease or delayed compatibility claim regained authority'
        before=db.execute('SELECT "threadId","checkpointId" FROM "AssessmentRuntime" WHERE "assessmentId"=%s',[active]).fetchone()
        command_state=db.execute('SELECT status,"errorMessage" FROM "OutboxMessage" WHERE id=%s',[jobs['active']['commandId']]).fetchone()
        assert command_state==('DLQ','SERVER_INCARNATION_FENCED'),command_state
        replay_status=replay(jobs['active']['commandId'])
        assert replay_status in [200,201],f'Authorized quiescent operator recovery rejected: {replay_status}'
        (directory/('release-'+active)).touch();publish('active')
        wait(lambda:complete('active'),'Explicit operator replay did not resume the canonical Root',60)
        wait(lambda:all(s['releasedAt'] for s in slots()),'Operator retry did not drain',15)
        after=db.execute('SELECT "threadId","checkpointId" FROM "AssessmentRuntime" WHERE "assessmentId"=%s',[active]).fetchone()
        assert before[0]==after[0] and before[1]
        parents=dict(checkpoint.execute('SELECT checkpoint_id,parent_checkpoint_id FROM checkpoints WHERE thread_id=%s AND checkpoint_ns=\'\'',[str(after[0])]).fetchall())
        # Successful completion deliberately clears the API resume pointer. Native
        # persisted history, rather than that pointer, proves the completed ancestry.
        current=max(parents);chain=[]
        while current is not None:
            assert current not in chain;chain.append(current);current=parents[current]
        assert before[1] in chain,'Operator replay broke canonical checkpoint ancestry'
        assert first_count('active')==2,'Replay created extra first-step model attempts beyond the explicit retry'
        audits=db.execute('SELECT "eventType",count(*) FROM "AuditEvent" WHERE "actorId"=%s GROUP BY "eventType"',[data['adminId']]).fetchall()
        assert sum(count for event,count in audits if event=='OUTBOX_DLQ_REPLAYED')==1, audits
        assert sum(count for event,count in audits if event=='OUTBOX_DLQ_REPLAY_DENIED')==1, audits
        record('AUDITED_OPERATOR_REPLAY_RECOVERED_SAME_THREAD',checkpointParentLinks=chain.index(before[1]),auditCounts=dict(audits))
        scenarios['operatorRecoveryAndCheckpointAncestry']='PASS'
        state_sample()
    except BaseException as error:
        failure=error
    finally:
        for job in jobs.values():(directory/('release-'+job['assessmentId'])).touch()
        (directory/'resume-restored').touch()
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
                try:process.wait(8)
                except subprocess.TimeoutExpired:process.kill();process.wait(5)
        diagnostics=None
        if failure is not None:
            # Never publish raw private logs: copy only fixed markers/codes and process status.
            instruction_codes=("BUNDLE_MISSING","BUNDLE_APPROVAL_UNTRUSTED","BUNDLE_UNAPPROVED",
                "BUNDLE_REVOKED","BUNDLE_STALE","BUNDLE_CORRUPT","SOURCE_INVENTORY_MISMATCH",
                "INSTRUCTION_ENTRY_MISSING","INSTRUCTION_DIGEST_MISMATCH")
            diagnostics={"fixtureModelRequests":len(requests),"childProcesses":[]}
            for process in children:
                name=child_names[process]
                log=(directory/(name+'.log')).read_text(encoding='utf-8',errors='replace')
                diagnostics["childProcesses"].append({"name":name,"exitCode":process.poll(),
                    "rootFailures":log.count("ASSESSMENT_ROOT_RUN_FAILED"),
                    "runtimeInstructionFailure":"RuntimeInstructionBundleError" in log,
                    "instructionErrorCodes":[code for code in instruction_codes if code in log],
                    "bridgeStarted":"Starting Agent Runtime RabbitMQ consumer" in log})
            print(json.dumps({"activeFaultDiagnostics":diagnostics}),flush=True)
        provider.shutdown();provider.server_close()
        if failure is None:
            # Delete only queues/exchange named by this owned, unique fixture.
            reply=httpx.get('http://127.0.0.1:15678/api/queues/%2F',auth=('guest','guest'),timeout=10)
            reply.raise_for_status()
            for queue in reply.json():
                if queue['name'].startswith(fixture_prefix+'.'):channel.queue_delete(queue['name'])
            channel.exchange_delete(os.environ['RABBITMQ_EXCHANGE'])
        runtime=[r[0] for r in db.execute('SELECT to_jsonb(r)-\'leaseToken\' FROM "AssessmentRuntime" r')]
        payload={'scope':'ISOLATED_PROVIDER_FREE_ACTIVE_REAL_PROCESSES_PG_MQ_NATIVE_ROOT','status':'FAILED' if failure else 'PASS','errorType':type(failure).__name__ if failure else None,'error':str(failure) if failure else None,'paidProviderCalls':0,'modelAdapter':'OWNED_EXTERNAL_HTTP_FIXTURE_SURVIVES_SERVER_DEATH','scenarios':scenarios,'events':events,'fixtureModelRequests':requests,'physicalSlots':slots(),'runtime':runtime,'timeline':timeline,'limitations':['Synthetic legal/business facts and model responses','Local repository filesystem, not production sandbox workload','No paid provider or production failure injection claim']}
        if diagnostics is not None:payload['childProcessDiagnostics']=diagnostics
        Path(data['output']).write_text(json.dumps(payload,indent=2,default=str))
        checkpoint.close();db.close();connection.close()
    if failure:raise failure
    print(json.dumps({'status':'PASS','scenarios':scenarios}))


if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[2]=='--server':
        from approved_bundle_fixture import offline_instruction_bundle
        # Each incarnation owns one context spanning the server and all Root workers.
        with offline_instruction_bundle():
            server_mode()
    elif len(sys.argv)>2 and sys.argv[2]=='--bridge':bridge_mode()
    else:main()
