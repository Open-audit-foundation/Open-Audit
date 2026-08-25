/**
 * PM2 process manager configuration for the decoupled microservices architecture.
 *
 * Usage:
 *   npm run build && npm run build:server
 *   pm2 start ecosystem.config.js
 *   pm2 logs
 *   pm2 restart all
 */
module.exports = {
  apps: [
    {
      name: "open-audit-web",
      script: ".server-dist/server-decoupled.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "open-audit-worker",
      script: ".server-dist/src/worker/indexer.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        WORKER_ID: "worker-pm2",
        INDEXER_MODE: "stream",
      },
    },
  ],
};
