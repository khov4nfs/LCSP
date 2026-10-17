"""Build immutable disposable images from Git archive, excluding every dirty-root byte."""
import hashlib,json,subprocess,tarfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parent;repo=root.parents[1]
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert sha==subprocess.check_output(['git','rev-parse','origin/fix/LCSP-360-corpus-driven-applicability'],cwd=repo,text=True).strip()
context=root/'candidate-source';context.mkdir(exist_ok=False)
archive=root/'candidate-source.tar'
subprocess.run(['git','archive','--format=tar','--output',str(archive),sha],cwd=repo,check=True)
with tarfile.open(archive) as source:source.extractall(context,filter='data')
archive_digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.unlink()
roles={'api':'apps/api/Dockerfile','worker':'deepagents/Dockerfile.dev','server':'deepagents-langgraph/Dockerfile'}
def build(item):
 role,dockerfile=item;iid=root/(role+'.iid')
 with (root/('build-'+role+'.log')).open('w') as log:
  r=subprocess.run(['docker','build','--label','org.opencontainers.image.revision='+sha,'--label','lcsp.legal-graph='+sha[:12],'--resource','memory=3g','--resource','cpu-quota=200000','-f',dockerfile,'--iidfile',str(iid),'-t','lcsp-legal-graph-'+role+':'+sha[:12],'.'],cwd=context,stdout=log,stderr=subprocess.STDOUT)
 assert r.returncode==0,role+' build failed; see local log'
 image=iid.read_text().strip();info=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
 assert info['Config']['Labels']['org.opencontainers.image.revision']==sha
 print(json.dumps({'image':role,'result':'PASS','id':image}),flush=True)
 return role,image
with ThreadPoolExecutor(max_workers=1) as pool:images=dict(pool.map(build,roles.items()))
manifest={'sha':sha,'gitTree':subprocess.check_output(['git','rev-parse',sha+'^{tree}'],cwd=repo,text=True).strip(),'gitArchiveSha256':archive_digest,'source':'git archive exact SHA; no working-tree source','images':images,'web':'NOT_REQUIRED_HEADLESS_ACCEPTANCE','dockerfiles':roles}
(root/'disposable-images.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
