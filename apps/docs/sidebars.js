module.exports = {
  docsSidebar: [
    "README",
    {
      type: "category",
      label: "User Documentation",
      link: {
        type: "doc",
        id: "user/getting-started",
      },
      items: [
        "user/getting-started",
        "user/core-workflows",
        "user/search-and-ai",
        "user/review-and-corrections",
        "user/settings-and-admin",
        "user/faq",
      ],
    },
    {
      type: "category",
      label: "Technical Documentation",
      link: {
        type: "doc",
        id: "technical/README",
      },
      items: [
        "technical/README",
        "technical/architecture-overview",
        "technical/api-and-data-flows",
        "technical/agentic-document-intelligence",
        "technical/web-application",
        "technical/testing-and-validation",
      ],
    },
    {
      type: "category",
      label: "Operational Documentation",
      link: {
        type: "doc",
        id: "operations/README",
      },
      items: [
        "operations/README",
        "operations/deployment-guide",
        "operations/configuration-reference",
        "operations/runbooks",
        "operations/backup-restore-and-portability",
        "operations/monitoring-and-health",
      ],
    },
    {
      type: "category",
      label: "Reference and Historical Notes",
      items: ["backend", "ui-visualization-plan", "phase-3-smoke"],
    },
  ],
};
