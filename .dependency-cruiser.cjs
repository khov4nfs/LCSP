/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Warn about circular dependencies.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "controller-no-direct-prisma",
      severity: "error",
      comment: "NestJS controllers must NOT import Prisma directly.",
      from: {
        path: "^apps/api/src/modules/[^/]+/controllers",
      },
      to: {
        path: "prisma",
      },
    },
    {
      name: "ui-atoms-no-feature-imports",
      severity: "error",
      comment: "Shared UI components must remain domain-neutral and never import from features/*.",
      from: {
        path: "^apps/web/src/components/(atoms|molecules|organisms|ui)",
      },
      to: {
        path: "^apps/web/src/features",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "\\.next", "coverage", "tests"],
    },
    includeOnly: "^(apps|packages)/",
  },
};
