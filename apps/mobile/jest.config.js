/**
 * The mobile app had no tests. These are not screenshots — nothing here proves
 * a screen looks right on a device — but they pin the things the redesign kept
 * getting wrong: a token that is not the token, a font weight where a named
 * face belongs, a tap target under 44pt, a string in one locale only, a section
 * that renders its header with nothing under it.
 *
 * `jest-expo` supplies the React Native preset and the Expo module mocks; the
 * transform ignore list is its default plus the workspace packages, which ship
 * TypeScript sources for Metro to compile.
 */
// A negative-offset zone, deliberately: `new Date("2026-08-05")` is UTC midnight,
// which is the previous day here. That is the bug `parseArchiveDate` exists to
// avoid, and it is invisible when the suite runs in UTC.
process.env.TZ = "America/Los_Angeles";

module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  // pnpm nests every package under `.pnpm/<name>@<version>_<hash>/node_modules/`,
  // so the usual allow-list of bare package names never matches. Matching the
  // name anywhere in the path does, at the cost of transforming a little more
  // than strictly necessary.
  transformIgnorePatterns: [
    "node_modules/(?!.*(react-native|expo|@react-navigation|@openkeep|@testing-library))",
  ],
  // `render.tsx` is the shared harness, not a suite.
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}"],
};
