const parseTypesenseServerConfig = () => {
  if (process.env.TYPESENSE_SERVER_CONFIG) {
    try {
      const parsedConfig = JSON.parse(process.env.TYPESENSE_SERVER_CONFIG);

      return {
        ...parsedConfig,
        apiKey:
          process.env.TYPESENSE_SEARCH_API_KEY || parsedConfig.apiKey || undefined,
      };
    } catch (error) {
      throw new Error(
        `Invalid TYPESENSE_SERVER_CONFIG JSON: ${error.message}`,
      );
    }
  }

  if (!process.env.TYPESENSE_HOST || !process.env.TYPESENSE_SEARCH_API_KEY) {
    return null;
  }

  return {
    nodes: [
      {
        host: process.env.TYPESENSE_HOST,
        port: Number(process.env.TYPESENSE_PORT || 443),
        protocol: process.env.TYPESENSE_PROTOCOL || "https",
      },
    ],
    apiKey: process.env.TYPESENSE_SEARCH_API_KEY,
  };
};

const typesenseServerConfig = parseTypesenseServerConfig();
const hasTypesenseDocSearch = Boolean(
  process.env.TYPESENSE_COLLECTION_NAME &&
    typesenseServerConfig?.apiKey &&
    typesenseServerConfig,
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
    // The architecture documentation carries its diagrams as mermaid fences so
    // they stay reviewable in a diff and render on GitHub as well as here.
    mermaid: true,
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

  themes: [
    "@docusaurus/theme-mermaid",
    ...(hasTypesenseDocSearch ? ["docusaurus-theme-search-typesense"] : []),
  ],

  themeConfig: {
    image: "img/openkeep-docs-social-card.svg",
    // Mermaid's stock palette is lavender on yellow, which reads as a foreign
    // object on the page. `neutral` is the closest base to the docs surface;
    // the overrides pull the accent onto the brand green.
    mermaid: {
      theme: { light: "neutral", dark: "dark" },
      options: {
        themeVariables: {
          primaryColor: "#eef3f1",
          primaryBorderColor: "#155b4a",
          primaryTextColor: "#12211d",
          lineColor: "#6b7f79",
          fontFamily:
            'Public Sans, system-ui, -apple-system, "Segoe UI", sans-serif',
        },
      },
    },
    navbar: {
      title: "OpenKeep",
      logo: {
        alt: "OpenKeep Docs",
        src: "img/logo-mark.svg",
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
        ...(hasTypesenseDocSearch
          ? [
              {
                type: "search",
                position: "right",
              },
            ]
          : []),
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
    ...(hasTypesenseDocSearch
      ? {
          typesense: {
            typesenseCollectionName: process.env.TYPESENSE_COLLECTION_NAME,
            typesenseServerConfig,
            contextualSearch: true,
          },
        }
      : {}),
  },
};

module.exports = config;
