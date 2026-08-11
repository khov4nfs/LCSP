const APP = "/srv/apps/lcsp-pm2";
const ENV_FILE = `${APP}/.env.pm2`;
const PYTHON = `${APP}/.venv/bin/python`;
const PATH = [
  "/root/.local/bin",
  process.env.PATH,
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin"
].filter(Boolean).join(":");

const commonEnv = {
  NODE_ENV: "production",
  PATH
};

function worker(name, target, healthPort) {
  return {
    name,
    cwd: APP,

    script: "dotenv",
    interpreter: "none",

    args: [
      "-e", ENV_FILE,
      "--",
      PYTHON,
      "-m", "lcsp_workers.runtime",
      target
    ],

    env: {
      ...commonEnv,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: `${APP}/lcsp-python-workers/src`,
      NESTJS_API_BASE_URL: "http://127.0.0.1:8080",
      HEALTH_PORT: String(healthPort)
    },

    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 15000
  };
}

module.exports = {
  apps: [
    {
      name: "lcsp-api",
      cwd: APP,

      script: "dotenv",
      interpreter: "none",

      args: [
        "-e", ENV_FILE,
        "--",
        "node",
        "apps/api/dist/src/main.js"
      ],

      env: {
        ...commonEnv,
        PORT: "8080"
      },

      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 15000
    },

    {
      name: "lcsp-web",
      cwd: APP,

      script: "dotenv",
      interpreter: "none",

      args: [
        "-e", ENV_FILE,
        "--",
        "pnpm",
        "--filter", "@lcsp/web",
        "exec",
        "next",
        "start",
        "-p", "3001",
        "-H", "127.0.0.1"
      ],

      env: {
        ...commonEnv,
        PORT: "3001",
        HOSTNAME: "127.0.0.1",
        LCSP_API_BASE_URL: "http://127.0.0.1:8080",
        LCSP_LEGAL_DOCUMENTS_DIR: `${APP}/reports`
      },

      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 15000
    },

    worker(
      "lcsp-scanner-worker",
      "lcsp_workers.scanner.scan_consumer:ScanConsumer",
      8101
    ),

    worker(
      "lcsp-technical-profile-worker",
      "lcsp_workers.intelligence.technical_profile_consumer:TechnicalProfileConsumer",
      8102
    ),

    worker(
      "lcsp-ai-usage-flow-worker",
      "lcsp_workers.intelligence.ai_usage_flow_consumer:AIUsageFlowConsumer",
      8103
    ),

    worker(
      "lcsp-conflict-detection-worker",
      "lcsp_workers.intelligence.conflict_detection_consumer:ConflictDetectionConsumer",
      8104
    ),

    worker(
      "lcsp-verified-profile-worker",
      "lcsp_workers.intelligence.verified_profile_consumer:VerifiedProfileConsumer",
      8105
    ),

    worker(
      "lcsp-legal-retrieval-worker",
      "lcsp_workers.legal.legal_retrieval_consumer:LegalRetrievalConsumer",
      8106
    ),

    worker(
      "lcsp-classification-worker",
      "lcsp_workers.classification.classification_consumer:ClassificationConsumer",
      8107
    ),

    worker(
      "lcsp-gap-analysis-worker",
      "lcsp_workers.reporting.gap_analysis_consumer:GapAnalysisConsumer",
      8108
    )
  ]
};
