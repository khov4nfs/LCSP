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
COPY lcsp-python-workers /app/lcsp-python-workers
COPY reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json \
    /app/reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json

RUN cd /app/lcsp-python-workers/src/lcsp_workers/scanner/ts_js_bridge/ts-js-analyzer \
    && rm -f package-lock.json \
    && npm install --include=dev \
    && npm run build \
    && npm prune --omit=dev

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir "/app/lcsp-python-workers" "semgrep==${SEMGREP_VERSION}"

RUN syft --version \
    && semgrep --version \
    && knip --version \
    && node --version

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/lcsp-python-workers/src
ENV KNIP_BINARY=/usr/local/bin/knip
ENV HEALTH_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).read()"

ENTRYPOINT ["python", "-m", "lcsp_workers.runtime"]
