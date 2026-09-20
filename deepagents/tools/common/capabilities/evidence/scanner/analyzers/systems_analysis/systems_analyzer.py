"""Static Go/Rust syntax and module metadata analysis."""
from __future__ import annotations
import hashlib, re, tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from tree_sitter import Language, Parser
import tree_sitter_go, tree_sitter_rust
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import DependencyUsageFact, PackageDependency, USAGE_DECLARED, is_ai_package

@dataclass(frozen=True)
class SystemsAnalysisResult:
    language: str
    files_analyzed: int
    files_skipped: int
    semantic_program: SemanticProgram
    package_dependencies: tuple[PackageDependency, ...] = ()
    coverage_limitations: tuple[str, ...] = ()
    unsupported_dynamic_flows: tuple[dict, ...] = ()

class SystemsAnalyzer:
    def __init__(self, workspace: str | Path, language: str):
        self.workspace=Path(workspace); self.language=language; self.ext=".go" if language=="go" else ".rs"
        self.parser=Parser(Language(tree_sitter_go.language() if language=="go" else tree_sitter_rust.language()))
    def analyze(self, include_files: Iterable[str] | None=None):
        program=SemanticProgram(); limits=[]; dynamic=[]; analyzed=skipped=0
        for rel in self._files(include_files):
            try: source=(self.workspace/rel).read_bytes()
            except (OSError,UnicodeError): skipped+=1; limits.append(f"{self.language}_read_failed:file={rel}"); continue
            tree=self.parser.parse(source); analyzed+=1
            if tree.root_node.has_error: limits.append(f"{self.language}_parse_partial:file={rel}")
            self._walk(tree.root_node,rel,program,dynamic)
            self._source_routes(source.decode("utf-8",errors="replace"), rel, program)
        deps, meta_limits=self._metadata(include_files); limits.extend(meta_limits)
        ai={d.name.lower() for d in deps if self._ai_dep(d.name)}
        for node in list(program.nodes):
            if node.node_type=="CALL_SITE" and ai and self._ai_call(node.label):
                key=f"ai:{node.key}"; program.add_node(SemanticNodeFact(key,"AI_MODEL_INVOCATION",node.label,node.file_path,node.start_line,node.end_line,attributes={"provider":self._provider(ai),"sourceCall":node.key},semantic_types=("AI_MODEL_INVOCATION",))); program.add_edge(SemanticEdgeFact("INVOKES_AI",node.key,key))
        return SystemsAnalysisResult(self.language,analyzed,skipped,program,tuple(deps),tuple(sorted(set(limits))),tuple(dynamic))
    def _walk(self,root,rel,program,dynamic):
        def visit(node,mod="",owner=None):
            text=node.text.decode("utf-8",errors="replace")
            if node.type in {"package_clause","mod_item"}:
                match=re.search(r"\b(?:package|mod)\s+([A-Za-z_]\w*)",text); mod=match.group(1) if match else mod
            if node.type in {"import_declaration","use_declaration"}:
                for value in re.findall(r"(?:import|use)\s+(?:[\w]+\s+)?[\"']?([\w./:-]+)",text):
                    key=self._key(rel,node.start_point[0]+1,"PACKAGE_DEPENDENCY",value); program.add_node(SemanticNodeFact(key,"PACKAGE_DEPENDENCY",value,rel,node.start_point[0]+1,node.end_point[0]+1,attributes={"import":value},semantic_types=("PACKAGE_DEPENDENCY",)))
            decl=self._decl(node.type,text)
            if decl:
                kind,name=decl; qualified="::".join(filter(None,(mod,owner,name))) if self.language=="rust" else ".".join(filter(None,(mod,owner,name))); key=self._key(rel,node.start_point[0]+1,kind,qualified)
                program.add_node(SemanticNodeFact(key,kind,qualified,rel,node.start_point[0]+1,node.end_point[0]+1,symbol_ref=qualified,attributes={"language":self.language},semantic_types=(kind,))); owner=qualified
            if node.type in {"call_expression","call","macro_invocation","method_call_expression"}:
                callee=self._callee(text)
                if callee:
                    attrs={"callee":callee,"resolution":"UNRESOLVED","language":self.language}
                    boundary=self._boundary(text,callee)
                    if boundary:
                        attrs.update(boundary)
                    key=self._key(rel,node.start_point[0]+1,"CALL_SITE",callee); program.add_node(SemanticNodeFact(key,"CALL_SITE",callee,rel,node.start_point[0]+1,node.end_point[0]+1,attributes=attrs,resolution_state="UNRESOLVED"))
                    route=self._route(text,callee)
                    if route:
                        route_key=self._key(rel,node.start_point[0]+1,"HTTP_ROUTE",route[1]); program.add_node(SemanticNodeFact(route_key,"HTTP_ROUTE",route[1],rel,node.start_point[0]+1,node.end_point[0]+1,attributes={"method":route[0],"route":route[1],"framework":route[2]},semantic_types=("HTTP_ROUTE",)))
                    if any(x in callee for x in ("reflect","dynamic","plugin","call_user")): dynamic.append({"file_path":rel,"line_number":node.start_point[0]+1,"callee":callee})
            for child in node.children: visit(child,mod,owner)
        visit(root)
    def _metadata(self,include_files):
        names={Path(str(x)).name for x in (include_files or ())}; paths=[]
        if include_files is None: paths=([self.workspace/"go.mod"] if self.language=="go" else [self.workspace/"Cargo.toml"])
        else: paths=[self.workspace/n for n in ("go.mod","Cargo.toml") if n in names]
        deps=[]; limits=[]
        for path in paths:
            if not path.is_file(): continue
            try: text=path.read_text(encoding="utf-8")
            except (OSError,UnicodeError): limits.append(f"{self.language}_manifest_read_failed:{path.name}"); continue
            if self.language=="go":
                for name,version in re.findall(r"^\s*(?:require\s+)?([\w./-]+)\s+v([^\s]+)",text,re.M): deps.append(PackageDependency(name,version,"go",None,[DependencyUsageFact(name,version,"go",USAGE_DECLARED,"go.mod",[path.name],is_ai_package(name))],0.0,is_ai_package(name)))
            else:
                try:
                    payload=tomllib.loads(text)
                    for name,value in (payload.get("dependencies") or {}).items():
                        version=value if isinstance(value,str) else (value.get("version") if isinstance(value,dict) else None); deps.append(PackageDependency(name,version,"cargo",None,[DependencyUsageFact(name,version,"cargo",USAGE_DECLARED,"Cargo.toml",[path.name],is_ai_package(name))],0.0,is_ai_package(name)))
                except tomllib.TOMLDecodeError: limits.append(f"rust_manifest_parse_partial:{path.name}")
        return deps,limits
    def _files(self,include): return tuple(sorted(str(x).replace("\\","/") for x in include if Path(str(x)).suffix==self.ext)) if include is not None else tuple(sorted(p.relative_to(self.workspace).as_posix() for p in self.workspace.rglob(f"*{self.ext}") if p.is_file() and not any(x in p.parts for x in ("vendor","target","build","generated",".git"))))
    @staticmethod
    def _decl(kind,text):
        p={"type_declaration":("TYPE",r"\btype\s+([A-Za-z_]\w*)"),"struct_item":("TYPE",r"\bstruct\s+([A-Za-z_]\w*)"),"trait_item":("INTERFACE",r"\btrait\s+([A-Za-z_]\w*)"),"interface_type":("INTERFACE",r"\binterface\s+([A-Za-z_]\w*)"),"function_declaration":("FUNCTION",r"\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)"),"function_item":("FUNCTION",r"\bfn\s+([A-Za-z_]\w*)"),"method_declaration":("METHOD",r"\bfunc\s+\([^)]*\)\s*([A-Za-z_]\w*)"),"impl_item":("TYPE",r"\bimpl(?:<[^>]+>)?\s+([A-Za-z_]\w*)")}; item=p.get(kind)
        if not item:return None
        m=re.search(item[1],text); return (item[0],m.group(1)) if m else None
    @staticmethod
    def _callee(text):
        m=re.search(r"([A-Za-z_][\w.:]*)\s*\(",text); return m.group(1) if m else None
    @staticmethod
    def _boundary(text, callee):
        # Keep client evidence language-neutral for the repository HTTP resolver.
        if re.search(r"\b(?:http\.(?:Get|Post|Head)|client\.Do|reqwest|hyper)\b", text, re.I):
            match=re.search(r"[\"'](https?://[^\"']+|/[^\"']*)[\"']", text)
            if match:
                return {"integrationType":"HTTP", "method":"GET", "path":match.group(1), "route":match.group(1)}
            return {"integrationType":"HTTP", "method":"GET"}
        return {}
    @staticmethod
    def _route(text, callee):
        # Bounded static route forms for net/http and common Go/Rust routers.
        patterns=(
            (r"(?:HandleFunc|Handle|\.GET|\.POST|\.PUT|\.PATCH|\.DELETE|\.Get|\.Post|\.Put|\.Patch|\.Delete)\s*\(\s*[\"']([^\"']+)", None),
            (r"#\s*\[\s*(?:get|post|put|patch|delete)\s*\(\s*[\"']([^\"']+)", None),
            (r"\.route\s*\(\s*[\"']([^\"']+)", None),
        )
        for pattern,_ in patterns:
            match=re.search(pattern,text,re.I)
            if match:
                token=match.group(0).lower()
                method="GET"
                for candidate in ("post","put","patch","delete"):
                    if candidate in token: method=candidate.upper(); break
                framework="go-net-http" if any(x in token for x in ("handlefunc","handle")) else ("rust-router" if ".route" in token or "#[" in token else "go-router")
                return method,match.group(1),framework
        return None
    def _source_routes(self, text, rel, program):
        if self.language != "rust":
            return
        for match in re.finditer(r"#\s*\[\s*(get|post|put|patch|delete)\s*\(\s*[\"']([^\"']+)", text, re.I):
            line=text.count("\n",0,match.start())+1; method=match.group(1).upper(); route=match.group(2)
            key=self._key(rel,line,"HTTP_ROUTE",route)
            if not any(node.key == key for node in program.nodes):
                program.add_node(SemanticNodeFact(key,"HTTP_ROUTE",route,rel,line,line,attributes={"method":method,"route":route,"framework":"rust-attribute"},semantic_types=("HTTP_ROUTE",)))
    @staticmethod
    def _key(rel,line,kind,value): return f"systems:{kind.lower()}:{hashlib.sha1(f'{rel}:{kind}:{value}'.encode()).hexdigest()[:12]}"
    @staticmethod
    def _ai_dep(name): return any(x in name.lower() for x in ("openai","anthropic","gemini","bedrock","genai"))
    @staticmethod
    def _ai_call(name): return any(x in name.lower() for x in ("chat","complete","embedding","generate","prompt"))
    @staticmethod
    def _provider(names):
        value=" ".join(names).lower(); return "OpenAI" if "openai" in value else "Anthropic" if "anthropic" in value else "Google Gemini" if "gemini" in value else "AWS Bedrock" if "bedrock" in value else "unknown"
