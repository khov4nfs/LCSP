const APP = "/srv/apps/lcsp-pm2";
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
    }
  ]
};
