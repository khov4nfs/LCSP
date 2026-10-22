"""Read-only provider readiness; never dispatches a model or prints credentials."""
import json,time,requests
from pathlib import Path
from vertical.live_preparation import _load_llm_env
_load_llm_env()
import os
from model_policy import resolve_role,fallback_routes
from provider_credentials import provider_tokens,NO_SDK_RETRY_MAX_RETRIES
result={"checkedAt":time.time(),"paidModelCalls":0,"quotaEndpoint":"https://api.miraiapi.com/api/usage/check","roles":{},"quota":[],"failures":[]}
for name in ["LCSP_RULE_SET_PREPARATION_EVAL_ROUTE","LCSP_RULE_SET_PREPARATION_EVAL_MODEL"]:
 if os.getenv(name): result["failures"].append("UNREQUESTED_ROUTE_OVERRIDE:"+name)
for role in ["rule-set-preparation","legal-semantic-auditor"]:
 config=resolve_role(role)
 chain=[config,*fallback_routes(config.route_id)]
 result["roles"][role]=[{"route":c.route_id,"provider":c.provider,"model":c.model,"protocol":c.protocol,"credentialSlots":len(provider_tokens(c.provider)),"sdkMaxRetries":NO_SDK_RETRY_MAX_RETRIES[c.provider]} for c in chain]
 if any(not provider_tokens(c.provider) for c in chain):result["failures"].append("MISSING_CONFIGURED_CREDENTIALS:"+role)
 for c in chain:
  if c.provider=="miraiapi" and c.protocol!="anthropic":result["failures"].append("UNEXPECTED_PRIMARY_PROTOCOL")
for slot,key in enumerate(provider_tokens("miraiapi")):
 with requests.Session() as session:
  response=session.post(result["quotaEndpoint"],json={"api_key":key},timeout=30)
  value=response.json();data=value.get("data",{})
  record={"slot":slot,"httpStatus":response.status_code,"success":value.get("success") is True}
  for name in ["quota_total","quota_remaining","expires_at"]:
   if isinstance(data.get(name),(int,float)):record[name]=data[name]
  result["quota"].append(record)
  if not (record["httpStatus"]==200 and record["success"] and record.get("quota_remaining",0)>0 and record.get("expires_at",0)>time.time()):result["failures"].append("PRIMARY_QUOTA_OR_EXPIRY:"+str(slot))
  session.post("https://api.miraiapi.com/api/usage/logout",timeout=15)
response=requests.get("https://api.miraiapi.com/api/mirai/catalog",timeout=30)
value=response.json()
result["primaryModelsAdvertised"]={c["model"]:c["model"] in json.dumps(value) for chain in result["roles"].values() for c in chain[:1]}
if response.status_code!=200 or not all(result["primaryModelsAdvertised"].values()):result["failures"].append("PRIMARY_NOT_ADVERTISED")
if not result["quota"]:result["failures"].append("NO_PRIMARY_CREDENTIAL")
result["fallbackBalances"]="NOT_VERIFIED; configured credentials and provider-free governance are verified separately"
result["status"]="PASS" if not result["failures"] else "BLOCKED"
print(json.dumps(result,indent=2))
raise SystemExit(0 if not result["failures"] else 1)
