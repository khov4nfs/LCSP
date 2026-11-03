const APP = "/srv/apps/LCSP";
const ENV_FILE = `${APP}/.env.pm2`;
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

module.exports = {
  apps: [
    {
      name: "lcsp-api",
      cwd: APP,

      script: "/root/.nvm/versions/node/v24.19.0/bin/dotenv",
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

      script: "/root/.nvm/versions/node/v24.19.0/bin/dotenv",
      interpreter: "none",

      args: [
        "-e", ENV_FILE,
        "--",
        "pnpm",
        "--filter", "@lcsp/web",
        "exec",
        "next",
        "start",
        "-p", "3002",
        "-H", "127.0.0.1"
      ],

      env: {
        ...commonEnv,
        // Node 22 only for lcsp-web (CI runtime). Node 24 SSR fails: renderToPipeableStream is not implemented.
        PATH: `/root/.nvm/versions/node/v22.23.3/bin:/root/.nvm/versions/node/v24.19.0/bin:${PATH}`,
        PORT: "3002",
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

    {
      name: "lcsp-agent-runtime",
      cwd: `${APP}/deepagents`,

      script: "/root/.nvm/versions/node/v24.19.0/bin/dotenv",
      interpreter: "none",

      args: [
        "-e", ENV_FILE,
        "--",
        `${APP}/.venv/bin/python`,
        "entrypoint.py"
      ],

      env: {
        ...commonEnv,
        PYTHONPATH: ".",
        PORT: "2024",
        LCSP_AGENT_RUNTIME_MODE: "production",
        LCSP_AGENT_SERVER_URL: "http://127.0.0.1:2024",
        LCSP_REPOSITORY_SANDBOX_IMAGE: "lcsp-agent-runtime:production-sandbox"
      },

      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      // Operators drain before replacement; PM2 must not kill a Root after 15 seconds.
      kill_timeout: 2147483647
    }
  ]
};
