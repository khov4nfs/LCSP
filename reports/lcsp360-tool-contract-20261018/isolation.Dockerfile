ARG LCSP_ACCEPTANCE_API_IMAGE
FROM ${LCSP_ACCEPTANCE_API_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends iptables && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/sh"]
