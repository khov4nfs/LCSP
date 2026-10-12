#!/usr/bin/env bash
set -euo pipefail

# Codebase Memory must run inside the LCSP Docker sandbox so it indexes the exact same
# /workspace/repository database used by the Deep Agent. The PyPI package is the
# publisher's verified bootstrap wrapper; bake the downloaded native binary into
# the sandbox image so assessment runs do not download executables at runtime.
#
# Keep the actual upstream Codebase Memory MCP binary in
# the sandbox image and expose a stable `codebase-memory-graph` command. Its `cli`
# mode invokes the exact MCP tool implementations one-shot, so the agent can use
# index_repository/search_graph/trace_path/query_graph/etc. without moving code
# out of the assessment sandbox.
CODEBASE_MEMORY_VERSION="0.11.0"
INSTALL_ROOT="$(mktemp -d)"
trap 'rm -rf "${INSTALL_ROOT}"' EXIT

python -m pip install --no-cache-dir "codebase-memory-mcp==${CODEBASE_MEMORY_VERSION}"

mkdir -p "${INSTALL_ROOT}/home" "${INSTALL_ROOT}/cache"
HOME="${INSTALL_ROOT}/home" \
XDG_CACHE_HOME="${INSTALL_ROOT}/cache" \
codebase-memory-mcp --version >/dev/null

NATIVE_BINARY="${INSTALL_ROOT}/cache/codebase-memory-mcp/${CODEBASE_MEMORY_VERSION}/codebase-memory-mcp"
test -x "${NATIVE_BINARY}"
install -d -m 0755 /usr/local/libexec
install -m 0755 "${NATIVE_BINARY}" /usr/local/libexec/codebase-memory-mcp

cat >/usr/local/bin/codebase-memory-graph <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Keep the graph/cache outside /workspace/repository so LCSP operational state
# can never be mistaken for customer source or recursively indexed.
export CBM_CACHE_DIR="${CBM_CACHE_DIR:-${HOME:-/tmp}/.cache/codebase-memory-mcp}"
mkdir -p "${CBM_CACHE_DIR}"
exec /usr/local/libexec/codebase-memory-mcp "$@"
EOF
chmod 0755 /usr/local/bin/codebase-memory-graph

# Also provide the upstream executable name for stdio-MCP compatibility inside
# the sandbox. Both names resolve to the same pinned binary and cache.
ln -sf /usr/local/bin/codebase-memory-graph /usr/local/bin/codebase-memory-mcp

/usr/local/libexec/codebase-memory-mcp --version >/dev/null
