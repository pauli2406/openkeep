import clsx from "clsx";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import useBaseUrl from "@docusaurus/useBaseUrl";

import styles from "./index.module.css";

const docAreas = [
  {
    title: "User Guides",
    body: "Learn the product from the perspective of archive owners and day-to-day operators inside the UI.",
    to: "/docs/user/getting-started",
    accent: "user",
  },
  {
    title: "Technical Guides",
    body: "Understand the architecture, APIs, LangGraph intelligence pipeline, web app structure, and test strategy.",
    to: "/docs/technical",
    accent: "technical",
  },
  {
    title: "Operational Guides",
    body: "Deploy, configure, monitor, troubleshoot, and maintain OpenKeep as a self-hosted system.",
    to: "/docs/operations",
    accent: "operations",
  },
];

const highlights = [
  "Canonical markdown stays in root docs/",
  "Docusaurus site lives in apps/docs/",
  "DocSearch v4 is supported when Algolia env vars are set",
  "Designed for user, contributor, and operator journeys",
];

export default function Home() {
  const logoMark = useBaseUrl("/img/logo-mark.svg");

  return (
    <Layout
      title="OpenKeep Docs"
      description="User, technical, and operational guidance for the OpenKeep document archive"
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroBackdrop} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Self-hosted archive intelligence</p>
              <div className={styles.heroBrand}>
                <img className={styles.heroBrandMark} src={logoMark} alt="" aria-hidden="true" />
                <span className={styles.heroBrandName}>OpenKeep</span>
              </div>
              <h1 className={styles.title}>Documentation that matches the product you actually run.</h1>
              <p className={styles.subtitle}>
                OpenKeep docs are organized for the three real audiences of the system: end users,
                contributors, and operators.
              </p>
              <div className={styles.actions}>
                <Link className={clsx("button button--primary button--lg", styles.primary)} to="/docs">
                  Open documentation
                </Link>
                <Link className={clsx("button button--secondary button--lg", styles.secondary)} to="/docs/user/getting-started">
                  Start with user guides
                </Link>
              </div>
            </div>

            <div className={styles.heroPanel}>
              <div className={styles.browserChrome}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.panelContent}>
                <div className={styles.panelBadge}>OpenKeep Docs</div>
                <h2>Fast paths for the work that matters</h2>
                <ul className={styles.highlightList}>
                  {highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={styles.panelNote}>
                  If Algolia DocSearch is configured, search appears automatically. Without it, the site stays safe-by-default.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.gridSection}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Documentation map</p>
            <h2>Choose the path that matches your role.</h2>
          </div>
          <div className={styles.cardGrid}>
            {docAreas.map((area) => (
              <Link key={area.title} className={clsx(styles.card, styles[area.accent])} to={area.to}>
                <span className={styles.cardMarker} />
                <h3>{area.title}</h3>
                <p>{area.body}</p>
                <span className={styles.cardCta}>Open section</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.band}>
          <div className={styles.bandCopy}>
            <p className={styles.sectionEyebrow}>Docs architecture</p>
            <h2>One source of truth, one site renderer.</h2>
            <p>
              The markdown remains in the root `docs/` directory so product work and documentation changes stay close together.
              The Docusaurus app in `apps/docs` provides navigation, branding, and optional DocSearch.
            </p>
          </div>
          <div className={styles.codeBlock}>
            <pre>
              <code>{`docs/
  user/
  technical/
  operations/

apps/docs/
  docusaurus.config.js
  sidebars.js
  src/pages/index.js`}</code>
            </pre>
          </div>
        </section>
      </main>
    </Layout>
  );
}
