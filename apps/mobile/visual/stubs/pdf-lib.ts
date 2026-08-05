/**
 * `pdf-lib`'s ESM build destructures `tslib`'s default export, which Metro's web
 * interop does not provide — the bundle throws on load. It is only used to
 * combine captured pages into one PDF, which no screenshot exercises.
 */
export const PDFDocument = {
  create: async () => {
    throw new Error("pdf-lib is stubbed in the visual build");
  },
};
