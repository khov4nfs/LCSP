"""Synthetic structural bundle for native runtime wiring tests, without providers or databases."""
import hashlib
import json


def document_graph_for_bundle(bundle):
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    nodes, mappings = [], []
    for document in bundle["documents"]:
        root = digest([bundle["legalSourceVersionId"], document["documentId"]])
        nodes.append({"nodeId": root, "legalSourceVersionId": bundle["legalSourceVersionId"], "documentId": document["documentId"],
                      "nodeType": "DOCUMENT", "parentNodeId": None, "ordinal": 0, "label": document["documentId"], "title": document["title"],
                      "structuralPath": "/document/" + document["documentId"], "sourcePath": document["documentId"], "content": "",
                      "contentFingerprint": digest(""), "legalEffectStatus": "EFFECTIVE", "legalStatusSourceRefs": ["synthetic-fixture"], "pageStart": None, "pageEnd": None, "charStart": None, "charEnd": None})
        document_root = nodes[-1]
        paths = {}
        for chunk in document["chunks"]:
            parent = document_root
            for index, part in enumerate(chunk["locator"].split("::")):
                path = parent["structuralPath"] + "/" + part
                if path not in paths:
                    content = chunk["content"] if index == len(chunk["locator"].split("::")) - 1 else ""
                    node = {**document_root, "nodeId": digest([bundle["legalSourceVersionId"], path, content]), "parentNodeId": parent["nodeId"],
                            "nodeType": "ARTICLE" if part.startswith("art-") else "CLAUSE", "label": part.split("-")[-1],
                            "structuralPath": path, "content": content, "contentFingerprint": digest(content), "ordinal": len(paths)}
                    nodes.append(node)
                    paths[path] = node
                parent = paths[path]
            mappings.append({"chunkId": chunk["chunkId"], "legalDocumentNodeId": parent["nodeId"]})
    return {"materializationId": digest(nodes), "legalSourceVersionId": bundle["legalSourceVersionId"],
            "parserRevision": "synthetic-runtime-fixture-v1", "materializationRevision": "synthetic-runtime-fixture-v1",
            "sourceDigest": digest(bundle["documents"]), "graphDigest": digest([nodes, mappings]), "inputModes": ["LEGACY_CHUNK_ADAPTER"],
            "nodes": nodes, "references": [], "chunkMappings": mappings}
