const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// `@openkeep/tokens` is a workspace package (#124), so Metro has to watch the
// repo root and resolve modules from both node_modules trees. The package
// exposes `react-native: ./src/index.ts`, which Metro prefers over `main`, so a
// clean checkout needs no prior build of it — `dist/` is gitignored.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

/**
 * The visual-regression build (#150), and only that build.
 *
 * `OPENKEEP_VISUAL=1 expo export --platform web` renders the real app — real
 * screens, real navigation, real query layer — in a browser, so Playwright can
 * screenshot it. Two kinds of module have to be swapped for that to be possible:
 *
 *  - `src/auth` and `src/offline-archive`, so the archive is a fixture rather
 *    than a server plus a device cache. Everything else a screen uses is real.
 *  - the modules with no browser implementation at all: the PDF view, the OS
 *    scanner, the file viewer, blob storage, SQLite, secure storage.
 *
 * Nothing here touches an app build — `expo export --platform ios`, EAS and the
 * dev client never set the variable, so they never see an alias.
 */
if (process.env.OPENKEEP_VISUAL === "1") {
  const stubs = path.resolve(projectRoot, "visual/stubs");
  const packageAliases = new Map([
    ["react-native-pdf", path.join(stubs, "native.tsx")],
    ["react-native-file-viewer", path.join(stubs, "file-viewer.ts")],
    ["react-native-document-scanner-plugin", path.join(stubs, "document-scanner.ts")],
    ["react-native-blob-util", path.join(stubs, "blob-util.ts")],
    ["expo-sqlite", path.join(stubs, "sqlite.ts")],
    ["@op-engineering/op-sqlite", path.join(stubs, "op-sqlite.ts")],
    ["expo-secure-store", path.join(stubs, "secure-store.ts")],
    ["pdf-lib", path.join(stubs, "pdf-lib.ts")],
    // For the web platform Metro reads `browser`/`module`/`main`, never
    // `react-native` — so the token package resolves to its gitignored `dist/`
    // and a clean checkout fails to bundle. The source is the same data.
    ["@openkeep/tokens", path.resolve(workspaceRoot, "packages/tokens/src/index.ts")],
  ]);
  const moduleAliases = new Map([
    [path.resolve(projectRoot, "src/auth"), path.join(stubs, "auth.tsx")],
    [path.resolve(projectRoot, "src/offline-archive"), path.join(stubs, "offline-archive.tsx")],
  ]);

  const previousResolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const packageStub = packageAliases.get(moduleName);
    if (packageStub) {
      return { type: "sourceFile", filePath: packageStub };
    }

    // Matched on the resolved path, not the specifier: `./auth` and `../auth`
    // both have to land on the stub, and only the app's own module may.
    if (moduleName.startsWith(".")) {
      const resolved = path.resolve(path.dirname(context.originModulePath), moduleName);
      const moduleStub = moduleAliases.get(resolved);
      if (moduleStub) {
        return { type: "sourceFile", filePath: moduleStub };
      }
    }

    return previousResolve
      ? previousResolve(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
