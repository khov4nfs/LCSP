#!/usr/bin/env bash
# Verifies the multi-repository migrations against seeded legacy data and a two-repo case.
# Uses a disposable Postgres container (port 55436) created by the repo's own helper script.
set -u
cd "$(dirname "$0")/../.."
C=lcsp-api-test-postgres-55436-lcsp_multirepo_check
M1=prisma/migrations/20261126090000_assessment_case_repository_set
M2=prisma/migrations/20261126100000_assessment_repository_set_guards
HOLD=$(mktemp -d)
export LCSP_TEST_POSTGRES_PORT=55436 LCSP_TEST_POSTGRES_DB=lcsp_multirepo_check LCSP_TEST_POSTGRES_USER=postgres LCSP_TEST_POSTGRES_PASSWORD=postgres
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55436/lcsp_multirepo_check?schema=public" PRISMA_MIGRATION_MODE=true
P() { docker exec -i $C psql -U postgres -d lcsp_multirepo_check -v ON_ERROR_STOP=1 "$@"; }
restore() { [ -d "$HOLD/m1" ] && mv "$HOLD/m1" "$M1"; [ -d "$HOLD/m2" ] && mv "$HOLD/m2" "$M2"; }
trap restore EXIT

docker rm -f $C >/dev/null 2>&1
node test/scripts/ensure-test-postgres.mjs >/dev/null 2>&1 || { echo "cannot start test postgres"; exit 1; }

echo "== 1. apply all migrations except the two new ones"
mv "$M1" "$HOLD/m1"; mv "$M2" "$HOLD/m2"
pnpm exec prisma migrate deploy 2>&1 | tail -1

echo "== 2. seed legacy data (a1 plain, a2 fenced, a3 unpinned)"
H="sha256:$(printf '0%.0s' $(seq 64))"
P -q <<SQL
insert into "User"(id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt") values ('u1','u1@example.test','x',true,0,now());
insert into "Assessment"(id,"ownerId",name,"updatedAt") values ('a1','u1','A1',now()),('a2','u1','A2',now()),('a3','u1','A3',now());
insert into "RepositoryConnection"(id,"repositoryName","repositoryId","userId","repositoryFullName","defaultBranch",permissions,"installationId") values
 ('c1','Notice_Service.v2','r1','u1','Acme/Notice_Service.v2','main','{}','inst1'),('c2','svc','r2','u1','Acme/svc','main','{}','inst2');
insert into "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId","sourcePathPrefix") values
 ('s1','a1','c1','r1','Acme/Notice_Service.v2','132B5D796B32BF2F4454990B64DF7D0435E28161','{}','u1','tài-liệu/é'),
 ('s2','a2','c2','r2','Acme/svc','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','u1',NULL);
insert into "RepositoryScanJob"(id,"assessmentId","snapshotId","idempotencyKey","triggerSource","correlationId","updatedAt") values
 ('job1','a1','s1','k1','TRUSTED','c',now()),('job2','a2','s2','k2','TRUSTED','c',now());
insert into "AssessmentCase"("assessmentId","updatedAt","repositorySnapshotId","repositoryScanJobId","repositoryCommit") values
 ('a1',now(),'s1','job1','132b5d796b32bf2f4454990b64df7d0435e28161'),('a2',now(),'s2','job2','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
insert into "AssessmentCase"("assessmentId","updatedAt") values ('a3',now());
insert into "AssessmentEvidence"("evidenceId","assessmentId",type,"repositoryCommit","contentSha256",payload) values
 ('00000000-0000-0000-0000-000000000001','a1','REPOSITORY_SOURCE','132b5d796b32bf2f4454990b64df7d0435e28161','$H','{}'),
 ('00000000-0000-0000-0000-000000000003','a2','REPOSITORY_SOURCE','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','$H','{}');
alter table "AssessmentExecutionIsolation" disable trigger lcsp_execution_isolation_guard;
insert into "AssessmentExecutionIsolation"("assessmentId","writerRole","actorId",reason) values ('a2','some_other_role','u1','test');
alter table "AssessmentExecutionIsolation" enable trigger lcsp_execution_isolation_guard;
SQL

echo "== 3. apply the two new migrations on top of the legacy data"
restore
pnpm exec prisma migrate deploy 2>&1 | grep -E "successfully|Error|error" | head -3

echo "== 4. backfill result"
P -At -c "select r.\"assessmentId\",r.\"repositoryKey\",coalesce(r.\"sourcePathPrefix\",'<null>'),c.\"repositoryCount\",left(c.\"repositorySetDigest\",19) from \"AssessmentCaseRepository\" r join \"AssessmentCase\" c using(\"assessmentId\") order by 1"
P -At -c "select \"evidenceId\"::text,\"assessmentId\",coalesce(\"repositoryKey\",'<null>') from \"AssessmentEvidence\" order by 1"
P -At -c "select \"assessmentId\",\"repositoryCount\" from \"AssessmentCase\" where \"assessmentId\"='a3'"

echo "== 5. two-repo case (a9) guard matrix"
P -q <<SQL
insert into "Assessment"(id,"ownerId",name,"updatedAt") values ('a9','u1','A9',now());
insert into "RepositoryConnection"(id,"repositoryName","repositoryId","userId","repositoryFullName","defaultBranch",permissions,"installationId") values
 ('cA','web','rA','u1','acme/web','main','{}','i1'),('cB','api','rB','u1','acme/api','main','{}','i2');
insert into "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId","sourcePathPrefix") values
 ('sA','a9','cA','rA','acme/web','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','u1','apps/web'),
 ('sB','a9','cB','rB','acme/api','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}','u1',NULL);
insert into "RepositoryScanJob"(id,"assessmentId","snapshotId","idempotencyKey","triggerSource","correlationId","updatedAt") values
 ('jA','a9','sA','kA','TRUSTED','c',now()),('jB','a9','sB','kB','TRUSTED','c',now());
insert into "AssessmentCase"("assessmentId","updatedAt","repositorySnapshotId","repositoryScanJobId","repositoryCommit") values
 ('a9',now(),'sA','jA','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
insert into "AssessmentCaseRepository"("assessmentId","repositoryKey",ordinal,"connectionId","repositoryId","repositoryFullName","repositorySnapshotId","repositoryScanJobId","repositoryCommit","sourcePathPrefix") values
 ('a9','web',0,'cA','rA','acme/web','sA','jA','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','apps/web'),
 ('a9','api',1,'cB','rB','acme/api','sB','jB','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',NULL);
SQL
FAILS=0
t() { out=$(docker exec -i $C psql -U postgres -d lcsp_multirepo_check -v ON_ERROR_STOP=1 -c "$3" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then got=OK; else got=DENY; fi
  if [ "$got" = "$2" ]; then r=PASS; else r=FAIL; FAILS=$((FAILS+1)); fi
  printf '%-4s %-58s expect=%-4s got=%-4s %s\n' $r "$1" $2 $got "$( [ $got = DENY ] && echo "$out" | grep -m1 ERROR | cut -c1-90)"; }
ins() { echo "insert into \"AssessmentEvidence\"(\"evidenceId\",\"assessmentId\",type,\"repositoryCommit\",\"repositoryKey\",\"contentSha256\",payload) values ('$1','a9','REPOSITORY_SOURCE','$2',$3,'$H','{}')"; }
A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; CC=cccccccccccccccccccccccccccccccccccccccc
t "evidence bound to primary repo"                       OK   "$(ins 00000000-0000-0000-0000-0000000000a1 $A "'web'")"
t "evidence bound to SECOND repo"                        OK   "$(ins 00000000-0000-0000-0000-0000000000b1 $B "'api'")"
t "evidence key web + commit of api (cross-repo)"        DENY "$(ins 00000000-0000-0000-0000-0000000000b2 $B "'web'")"
t "evidence with unknown key"                            DENY "$(ins 00000000-0000-0000-0000-0000000000b3 $A "'nope'")"
t "keyless evidence, primary commit"                     OK   "$(ins 00000000-0000-0000-0000-0000000000c1 $A NULL)"
t "keyless evidence, second repo commit"                 OK   "$(ins 00000000-0000-0000-0000-0000000000c2 $B NULL)"
t "keyless evidence, commit outside the set"             DENY "$(ins 00000000-0000-0000-0000-0000000000c3 $CC NULL)"
t "change evidence repositoryKey"                        DENY "update \"AssessmentEvidence\" set \"repositoryKey\"='web' where \"evidenceId\"='00000000-0000-0000-0000-0000000000b1'"
t "invalidate evidence (allowed transition)"             OK   "update \"AssessmentEvidence\" set state='INVALIDATED',\"invalidatedAt\"=now() where \"evidenceId\"='00000000-0000-0000-0000-0000000000a1'"
t "pin whose commit differs from its snapshot"           DENY "insert into \"AssessmentCaseRepository\"(\"assessmentId\",\"repositoryKey\",ordinal,\"connectionId\",\"repositoryId\",\"repositoryFullName\",\"repositorySnapshotId\",\"repositoryScanJobId\",\"repositoryCommit\") values ('a9','x',2,'cB','rB','acme/api','sB','jB','$CC')"
t "pin whose scan job belongs to another snapshot"       DENY "insert into \"AssessmentCaseRepository\"(\"assessmentId\",\"repositoryKey\",ordinal,\"connectionId\",\"repositoryId\",\"repositoryFullName\",\"repositorySnapshotId\",\"repositoryScanJobId\",\"repositoryCommit\") values ('a9','y',2,'cA','rA','acme/web','sA','jB','$A')"
t "update a recorded pin"                                DENY "update \"AssessmentCaseRepository\" set ordinal=5 where \"repositoryKey\"='api'"
t "case scalar pin still immutable"                      DENY "update \"AssessmentCase\" set \"repositorySnapshotId\"='sB',\"repositoryScanJobId\"='jB',\"repositoryCommit\"='$B' where \"assessmentId\"='a9'"
t "delete two-repo assessment (cascade pins+evidence)"   OK   "delete from \"Assessment\" where id='a9'"
t "delete legacy backfilled assessment a1"               OK   "delete from \"Assessment\" where id='a1'"
t "fenced a2: direct write still rejected after migration" DENY "update \"AssessmentCase\" set \"caseRevision\"=\"caseRevision\" where \"assessmentId\"='a2'"
t "fenced a2: pin table also fenced"                     DENY "delete from \"AssessmentCaseRepository\" where \"assessmentId\"='a2'"
echo "== failures: $FAILS"
docker rm -f $C >/dev/null 2>&1
[ "$FAILS" -eq 0 ]
