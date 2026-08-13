/**
 * Mocks for the native modules a test render would otherwise reach. Each one is
 * a module with no JavaScript fallback: SQLite, the OS document scanner, the PDF
 * view, the file viewer, blob storage. The app's own logic is never mocked here.
 */

// Ships with the library: without it a rendered `Swipeable` leaves its gesture
// handlers running and the worker never idles.
require("react-native-gesture-handler/jestSetup");

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
}));

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ changes: 0 })),
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async () => []),
  })),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ""),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async () => ({ status: 200, uri: "file:///cache/file.pdf" })),
}));

jest.mock("react-native-pdf", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: View };
});

jest.mock("react-native-file-viewer", () => ({
  __esModule: true,
  default: { open: jest.fn(async () => undefined) },
}));

jest.mock("react-native-document-scanner-plugin", () => ({
  __esModule: true,
  default: { scanDocument: jest.fn(async () => ({ scannedImages: [] })) },
  ResponseType: { ImageFilePath: "imageFilePath" },
}));

jest.mock("react-native-blob-util", () => ({
  __esModule: true,
  default: { fs: { dirs: { DocumentDir: "/documents" } } },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: "jpeg" },
}));

// `useFonts` resolving false would render the loading screen in every test.
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(async () => undefined),
  isLoaded: () => true,
}));

// `Screen` calls `useScrollToTop`, which throws outside a navigator. The hook is
// a navigation convenience, not app logic, so it is the only part of the module
// that gets replaced.
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useScrollToTop: jest.fn(),
  // A screen under test is not inside a navigator. Both hooks are the boundary
  // to navigation, not behaviour of the screen.
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    setOptions: jest.fn(),
    isFocused: () => true,
  }),
  useIsFocused: () => true,
}));

// The encrypted store is opened through op-sqlite, a native module with no
// JavaScript fallback. The offline suites inject their own database handle, so
// nothing here needs to work — it only needs to load.
jest.mock("@op-engineering/op-sqlite", () => ({
  open: () => {
    throw new Error("op-sqlite is not available under Jest");
  },
  isSQLCipher: () => true,
}));
