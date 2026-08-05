/**
 * The modules with no browser implementation, stubbed for the visual build: the
 * PDF view, the OS scanner, the file viewer, blob storage, SQLite. Each one is
 * behind a screen area the screenshots do not claim to cover — a real PDF page
 * renders in the native viewer, not here.
 */
import { View } from "react-native";

/**
 * An empty sheet, and empty on purpose: any text here would render in whatever
 * font the machine falls back to, and the baselines would then differ between a
 * laptop and the container.
 */
export function PdfPlaceholder() {
  return (
    <View
      style={{
        width: 300,
        height: 380,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#e3e6e3",
        borderRadius: 4,
      }}
    />
  );
}

export default PdfPlaceholder;
