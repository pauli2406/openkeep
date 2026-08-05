/** The OS scanner has no browser equivalent; capture is not screenshotted. */
export const ResponseType = { ImageFilePath: "imageFilePath", Base64: "base64" } as const;
export default {
  scanDocument: async () => ({ scannedImages: [] as string[] }),
};
