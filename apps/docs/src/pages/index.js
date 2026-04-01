import clsx from "clsx";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import useBaseUrl from "@docusaurus/useBaseUrl";

import styles from "./index.module.css";

const quickStart = [
  {
    title: "Get started",
    body: "Set up the archive, sign in, and understand the main areas of the app.",
    to: "/docs/user/getting-started",
  },
  {
    title: "Search and AI",
    body: "Use answer-first archive search with semantic citations and structured operational answers.",
    to: "/docs/user/search-and-ai",
  },
  {
    title: "Review and corrections",
    body: "Handle pending review items and make safe metadata corrections.",
    to: "/docs/user/review-and-corrections",
  },
];

const rolePaths = [
  {
    title: "User guides",
    body: "For day-to-day archive work: upload, search, review, correct, and manage documents.",
    to: "/docs/user/getting-started",
    accent: "user",
  },
  {
    title: "Technical guides",
    body: "For contributors: architecture, APIs, search orchestration, processing, and testing.",
    to: "/docs/technical",
    accent: "technical",
  },
  {
    title: "Operations guides",
    body: "For operators: deployment, configuration, monitoring, backups, and runbooks.",
    to: "/docs/operations",
    accent: "operations",
  },
];

const capabilityPoints = [
  "Hybrid keyword plus semantic retrieval for exploratory questions",
  "Structured answers for open invoices, pending review, and expiring contracts",
  "Document-level summaries, Q&A, and review evidence",
  "Web and mobile clients backed by one archive API",
];

export default function Home() {
  const logoMark = useBaseUrl("/img/logo-mark.svg");

  return (
    <Layout
      title="OpenKeep Docs"
      description="Documentation for running, using, and extending the OpenKeep personal document archive"
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroBackdrop} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>OpenKeep documentation</p>
              <div className={styles.heroBrand}>
                <img className={styles.heroBrandMark} src={logoMark} alt="" aria-hidden="true" />
                <span className={styles.heroBrandName}>OpenKeep</span>
              </div>
              <h1 className={styles.title}>Docs for a personal archive that is finally MVP ready.</h1>
              <p className={styles.subtitle}>
                OpenKeep helps you ingest, search, review, and understand your documents with
                an answer-first archive experience across web and mobile.
              </p>
              <div className={styles.actions}>
                <Link className={clsx("button button--primary button--lg", styles.primary)} to="/docs/user/getting-started">
                  Start here
                </Link>
                <Link className={clsx("button button--secondary button--lg", styles.secondary)} to="/docs/user/search-and-ai">
                  Explore search and AI
                </Link>
              </div>
              <p className={styles.licenseNote}>
                Free for personal and other noncommercial use. Commercial use requires a separate license.
              </p>
            </div>

            <div className={styles.heroPanel}>
              <div className={styles.browserChrome}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.panelContent}>
                <div className={styles.panelBadge}>What this docs site covers</div>
                <h2>Use it, run it, or extend it.</h2>
                <ul className={styles.highlightList}>
                  {capabilityPoints.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={styles.panelNote}>
                  The markdown source lives in the repository `docs/` folder, while this Docusaurus
                  app provides navigation, branding, and optional search.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.gridSection}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Quick start</p>
            <h2>Jump straight into the workflows people actually use.</h2>
          </div>
          <div className={styles.quickGrid}>
            {quickStart.map((item) => (
              <Link key={item.title} className={styles.quickCard} to={item.to}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <span className={styles.cardCta}>Open guide</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.gridSection}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Documentation map</p>
            <h2>Choose the path that matches your role.</h2>
          </div>
          <div className={styles.cardGrid}>
            {rolePaths.map((area) => (
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
            <p className={styles.sectionEyebrow}>Current product scope</p>
            <h2>Built around the real OpenKeep MVP.</h2>
            <p>
              The docs now reflect the current archive behavior: answer-first search, structured
              operational answers, review workflows, and shared web/mobile client capabilities.
            </p>
          </div>
          <div className={styles.codeBlock}>
            <pre>
              <code>{`Core docs paths

docs/
  user/
    getting-started.md
    search-and-ai.md
    review-and-corrections.md
  technical/
    architecture-overview.md
    api-and-data-flows.md
    web-application.md
  operations/
    deployment-guide.md
    configuration-reference.md
    runbooks.md`}</code>
            </pre>
          </div>
        </section>
      </main>
    </Layout>
  );
}
