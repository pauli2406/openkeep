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

module.exports = config;
