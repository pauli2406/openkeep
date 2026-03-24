import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/docs',
    component: ComponentCreator('/docs', 'a65'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '3d9'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', '80e'),
            routes: [
              {
                path: '/docs',
                component: ComponentCreator('/docs', '5d5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/backend',
                component: ComponentCreator('/docs/backend', '420'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations',
                component: ComponentCreator('/docs/operations', 'a4f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations/backup-restore-and-portability',
                component: ComponentCreator('/docs/operations/backup-restore-and-portability', '41c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations/configuration-reference',
                component: ComponentCreator('/docs/operations/configuration-reference', 'e5e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations/deployment-guide',
                component: ComponentCreator('/docs/operations/deployment-guide', '78d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations/monitoring-and-health',
                component: ComponentCreator('/docs/operations/monitoring-and-health', 'cfc'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/operations/runbooks',
                component: ComponentCreator('/docs/operations/runbooks', 'e70'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/phase-3-smoke',
                component: ComponentCreator('/docs/phase-3-smoke', '801'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical',
                component: ComponentCreator('/docs/technical', 'f8e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical/agentic-document-intelligence',
                component: ComponentCreator('/docs/technical/agentic-document-intelligence', '73b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical/api-and-data-flows',
                component: ComponentCreator('/docs/technical/api-and-data-flows', '70d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical/architecture-overview',
                component: ComponentCreator('/docs/technical/architecture-overview', '504'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical/testing-and-validation',
                component: ComponentCreator('/docs/technical/testing-and-validation', '394'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/technical/web-application',
                component: ComponentCreator('/docs/technical/web-application', 'e60'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/ui-visualization-plan',
                component: ComponentCreator('/docs/ui-visualization-plan', '687'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/core-workflows',
                component: ComponentCreator('/docs/user/core-workflows', '7e8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/faq',
                component: ComponentCreator('/docs/user/faq', '426'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/getting-started',
                component: ComponentCreator('/docs/user/getting-started', 'e8c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/review-and-corrections',
                component: ComponentCreator('/docs/user/review-and-corrections', 'ba3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/search-and-ai',
                component: ComponentCreator('/docs/user/search-and-ai', '83a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/user/settings-and-admin',
                component: ComponentCreator('/docs/user/settings-and-admin', '0c5'),
                exact: true,
                sidebar: "docsSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/',
    component: ComponentCreator('/', '2e1'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
