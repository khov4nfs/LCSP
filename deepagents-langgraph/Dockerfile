FROM ghcr.io/astral-sh/uv:0.10.6 AS uv

FROM python:3.11-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates docker.io git \
    && if ! command -v docker >/dev/null 2>&1; then apt-get install -y --no-install-recommends docker-cli; fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY deepagents/pyproject.toml deepagents/uv.lock /app/deepagents/
RUN cd /app/deepagents \
    && uv sync --frozen --no-dev --no-install-project

COPY reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json \
    /app/reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json
COPY deepagents /app/deepagents

RUN cd /app/deepagents \
    && uv sync --frozen --no-dev \
    && mkdir -p /workspace/repository /workspace/runtime \
    && chmod -R 1777 /workspace

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/deepagents
ENV PATH=/app/deepagents/.venv/bin:$PATH
ENV LCSP_AGENT_RUNTIME_ROLE=server
ENV LCSP_AGENT_RUNTIME_MODE=production
ENV PORT=8000

WORKDIR /app/deepagents

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read()"

ENTRYPOINT ["python", "-m", "tools.common.capabilities.agent_runtime.local_server"]
