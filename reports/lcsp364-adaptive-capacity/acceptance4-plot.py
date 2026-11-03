from pathlib import Path
from datetime import datetime, timezone
import json, math, hashlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

root=Path(__file__).resolve().parent
samples=[json.loads(line) for line in (root/'acceptance4-capacity-timeline.jsonl').read_text().splitlines()]
proof=json.loads((root/'acceptance4-native-proof.json').read_text());slots=proof['physicalSlots']
assert all('native' in s and 'runtime' in s for s in samples)
times=[datetime.fromisoformat(s['at']) for s in samples]
fig,axes=plt.subplots(6,1,figsize=(14,16),sharex=True,layout='constrained')
fig.suptitle('LCSP-364 isolated live-provider native acceptance — 2026-11-02\nDerived from captured measurements; two API / two bridges / one Agent Server; not Fogewise',fontsize=13)
for values,label,style in [([s['desired'] for s in samples],'Desired','--'),([s['effective'] for s in samples],'Effective','-'),([s['active'] for s in samples],'Admitted',':'),([s['native']['data']['activeNativeRoots'] for s in samples],'Actual native Roots','-.')]:
    axes[0].step(times,values,where='post',label=label,linestyle=style,linewidth=1.7)
axes[0].set_ylim(-.1,2.5);axes[0].set_ylabel('Slots / Roots');axes[0].legend(ncol=4,loc='upper right')
for key,label,source in [('queued','Eligible waiting','database'),('brokerReady','Broker ready','runtime'),('brokerUnacknowledged','Broker unacked','runtime')]:
    axes[1].step(times,[s[source][key] for s in samples],where='post',label=label)
axes[1].set_ylabel('Assessments / deliveries');axes[1].legend(ncol=3,loc='upper right')
for key,label in [('memoryAvailableBytes','Host RAM available'),('cgroupMemoryAvailableBytes','Server cgroup available'),('diskAvailableBytes','Disk available'),('sandboxMemoryBytes','Aggregate sandbox memory')]:
    axes[2].plot(times,[s['runtime'][key]/1024**3 for s in samples],label=label)
axes[2].axhline(6,color='darkorange',ls='--',label='2 Roots: 2 GiB headroom + 2 GiB reserve each')
axes[2].axhline(4,color='firebrick',ls=':',label='Disk headroom policy 4 GiB')
axes[2].set_ylabel('GiB');axes[2].legend(ncol=2,fontsize=8,loc='upper right')
for key,label in [('cpuPressure','CPU pressure'),('diskPressure','Disk pressure')]:
    axes[3].plot(times,[100*s['runtime'][key] for s in samples],label=label)
axes[3].set_ylabel('Pressure %');axes[3].legend(loc='upper right')
axes[4].plot(times,[s['runtime']['checkpointLatencyMs'] for s in samples],label='Checkpoint latency ms')
axes[4].plot(times,[s['database']['dbUsedConnections'] for s in samples],label='DB connections / max 100')
axes[4].step(times,[s['database']['activeModelRequests'] for s in samples],where='post',label='Observed active provider requests')
axes[4].set_ylabel('ms / count');axes[4].legend(ncol=3,loc='upper right')
names=['C initial → Stop','D initial → HITL','E initial → HITL','C Continue → HITL']
for i,(slot,name) in enumerate(zip(slots,names)):
    a=datetime.fromisoformat(slot['startedAt']);b=datetime.fromisoformat(slot['releasedAt']);seconds=(b-a).total_seconds()
    axes[5].barh(i,seconds/86400,left=mdates.date2num(a),height=.6,color=['#2166ac','#1b9e77','#d95f02','#762a83'][i])
    axes[5].text(mdates.date2num(a)+seconds/172800,i,f'{seconds:.1f} s',ha='center',va='center',fontsize=8,color='white')
axes[5].set_yticks(range(4),names);axes[5].set_ylabel('Durable physical spans')
up=next(s['at'] for s in samples if s['reason']=='BACKLOG_HEADROOM' and s['effective']==2)
down=next(s['at'] for s in samples if s['reason']=='LOW_DEMAND' and s['effective']==1 and s['at']>up)
for at,label in [(up,'Automatic 1 → 2'),(down,'Automatic 2 → 1')]:
    stamp=datetime.fromisoformat(at)
    for ax in axes:ax.axvline(stamp,color='#444',alpha=.4,ls='--')
    axes[0].text(stamp,2.2,label,ha='center',fontsize=9,bbox={'facecolor':'white','alpha':.8,'edgecolor':'none'})
for ax in axes:ax.grid(alpha=.2)
axes[-1].xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S',tz=timezone.utc));axes[-1].set_xlabel('2026-11-02 UTC — direct native sensor every 3 s; resource sensors retain their own reported age')
fig.savefig(root/'acceptance4-capacity-derived.png',dpi=140);fig.savefig(root/'acceptance4-capacity-derived.svg')
svg=root/'acceptance4-capacity-derived.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()).rstrip()+'\n')
waits=sorted((datetime.fromisoformat(s['startedAt'])-datetime.fromisoformat(s['requestedAt'])).total_seconds()*1000 for s in slots)
initialWaits=sorted((datetime.fromisoformat(s['startedAt'])-datetime.fromisoformat(s['requestedAt'])).total_seconds()*1000 for s in slots[:3])
def percentile(values,p):
    index=(len(values)-1)*p;lo=math.floor(index);hi=math.ceil(index)
    return values[lo]+(values[hi]-values[lo])*(index-lo)
fields={'runtime':['memoryAvailableBytes','cgroupMemoryAvailableBytes','diskAvailableBytes','sandboxMemoryBytes','sandboxCpuCores','activeSandboxes','cpuPressure','diskPressure','processRssBytes','checkpointLatencyMs','checkpointFailureRate','provider429Count','budgetDenialCount'],'database':['dbUsedConnections','dbConnectionRatio','dbLatencyMs','activeModelRequests']}
summary={'scope':proof['scope'],'sourceRevision':proof['sourceRevision'],'measurementSamples':len(samples),'observerErrors':0,'controllerUnhealthySampleCount':sum(not s['controllerHealthy'] for s in samples),'actualPeakNativeRoots':proof['actualPeakNativeRoots'],'peakDirectNativeRootObservation':max(s['native']['data']['activeNativeRoots'] for s in samples),'maximumAdmitted':max(s['active'] for s in samples),'physicalNativeSegments':4,'independentAssessments':3,'overlaps':proof['overlaps'],'automaticScaleUpAt':up,'automaticScaleDownAt':down,'scaleUpReason':'BACKLOG_HEADROOM','scaleDownReason':'LOW_DEMAND','initialQueueWaitToPhysicalStartMs':initialWaits,'initialQueueWaitP50Ms':percentile(initialWaits,.5),'initialQueueWaitP95Ms':percentile(initialWaits,.95),'allSegmentsWaitP50Ms':percentile(waits,.5),'allSegmentsWaitP95Ms':percentile(waits,.95),'queueWaitSampleCount':3,'actualCompletedAssessmentThroughput':None,'throughputDisposition':'Three genuine WAITING_FOR_HUMAN outcomes; no completed Assessment or final report throughput claim','nativeSegmentDurationsSeconds':[(datetime.fromisoformat(s['releasedAt'])-datetime.fromisoformat(s['startedAt'])).total_seconds() for s in slots],'resourceRanges':{key:{'minimum':min(s[source][key] for s in samples if s[source].get(key) is not None),'maximum':max(s[source][key] for s in samples if s[source].get(key) is not None)} for source,keys in fields.items() for key in keys},'timelineSha256':hashlib.sha256((root/'acceptance4-capacity-timeline.jsonl').read_bytes()).hexdigest(),'chartLabel':'Derived from captured measurements, not a live screenshot','fogewiseConcurrency2Claim':False}
assert summary['peakDirectNativeRootObservation']==summary['maximumAdmitted']==2
(root/'acceptance4-live-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
