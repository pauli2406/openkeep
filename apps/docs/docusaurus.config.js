const hasAlgoliaDocSearch = Boolean(
  process.env.ALGOLIA_APP_ID &&
    process.env.ALGOLIA_API_KEY &&
    process.env.ALGOLIA_INDEX_NAME,
);

const config = {
  title: "OpenKeep Docs",
  tagline: "User, technical, and operational guidance for OpenKeep",
  url: process.env.DOCS_SITE_URL || "https://openkeep.local",
  baseUrl: "/",
  onBrokenLinks: "throw",
  favicon: "img/favicon.svg",
  organizationName: "openkeep",
  projectName: "openkeep",
  trailingSlash: false,
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "../../docs",
          routeBasePath: "/docs",
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl: "https://github.com/openkeep/openkeep/tree/main/",
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/openkeep-docs-social-card.svg",
    navbar: {
      title: "",
      logo: {
        alt: "OpenKeep Docs",
        src: "img/logo-wordmark.svg",
      },
      items: [
        {
          to: "/",
          position: "left",
          label: "Home",
        },
        {
          type: "doc",
          docId: "README",
          position: "left",
          label: "Overview",
        },
        {
          type: "doc",
          docId: "user/getting-started",
          position: "left",
          label: "User",
        },
        {
          type: "doc",
          docId: "technical/README",
          position: "left",
          label: "Technical",
        },
        {
          type: "doc",
          docId: "operations/README",
          position: "left",
          label: "Operations",
        },
        {
          href: "https://github.com/openkeep/openkeep",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Overview", to: "/docs" },
            { label: "User", to: "/docs/user/getting-started" },
            { label: "Technical", to: "/docs/technical" },
            { label: "Operations", to: "/docs/operations" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "Repository", href: "https://github.com/openkeep/openkeep" },
            { label: "Main README", href: "https://github.com/openkeep/openkeep/blob/main/README.md" },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} OpenKeep`,
    },
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        autoCollapseCategories: false,
      },
    },
    ...(hasAlgoliaDocSearch
      ? {
          algolia: {
            appId: process.env.ALGOLIA_APP_ID,
            apiKey: process.env.ALGOLIA_API_KEY,
            indexName: process.env.ALGOLIA_INDEX_NAME,
            contextualSearch: true,
          },
        }
      : {}),
  },
};

module.exports = config;
