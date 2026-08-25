FROM python:3.11-slim-bookworm

ARG SYFT_VERSION=1.20.0
ARG SEMGREP_VERSION=1.99.0
ARG KNIP_VERSION=6

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh \
    | sh -s -- -b /usr/local/bin "v${SYFT_VERSION}" \
    && npm install --global "knip@${KNIP_VERSION}" \
    && ln -sf "$(command -v knip)" /usr/local/bin/knip

WORKDIR /app
COPY deepagents /app/deepagents
COPY reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json \
    /app/reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json

RUN cd /app/deepagents/tools/common/capabilities/evidence/scanner/ts_js_bridge/ts-js-analyzer \
    && rm -f package-lock.json \
    && npm install --include=dev \
    && npm run build \
    && npm prune --omit=dev

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir "/app/deepagents" "semgrep==${SEMGREP_VERSION}"

RUN syft --version \
    && semgrep --version \
    && knip --version \
    && node --version

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/deepagents
ENV KNIP_BINARY=/usr/local/bin/knip

WORKDIR /app/deepagents

ENTRYPOINT ["python", "entrypoint.py"]
