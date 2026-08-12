import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const SUPPORTED_FILE_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".heic",
] as const;

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
] as const;

export const MACOS_DOCUMENT_TYPES = [
  {
    CFBundleTypeName: "OpenKeep document",
    CFBundleTypeRole: "Viewer",
    LSHandlerRank: "Alternate",
    LSItemContentTypes: [
      "com.adobe.pdf",
      "public.jpeg",
      "public.png",
      "public.tiff",
      "public.heic",
    ],
  },
] as const;

const runFile = promisify(execFile);

function quoteDesktopExec(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")}"`;
}

function linuxDesktopEntry(execPath: string) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=OpenKeep",
    "Comment=Import documents into an OpenKeep archive",
    `Exec=${quoteDesktopExec(execPath)} %F`,
    "Terminal=false",
    "Categories=Office;Utility;",
    `MimeType=${SUPPORTED_MIME_TYPES.join(";")};`,
    "StartupWMClass=OpenKeep",
    "",
  ].join("\n");
}

export async function registerPackagedFileAssociations({
  platform,
  isPackaged,
  execPath,
  applicationsDirectory,
  run = async (command, arguments_) => {
    await runFile(command, arguments_);
  },
  ensureDirectory = async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  writeText = async (filePath, contents) => {
    await writeFile(filePath, contents, { encoding: "utf8", mode: 0o644 });
  },
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  applicationsDirectory: string;
  run?: (command: string, arguments_: string[]) => Promise<unknown>;
  ensureDirectory?: (directory: string) => Promise<unknown>;
  writeText?: (filePath: string, contents: string) => Promise<unknown>;
}) {
  if (!isPackaged) return;

  if (platform === "win32") {
    const command = `"${execPath}" "%1"`;
    await run("reg.exe", [
      "ADD",
      "HKCU\\Software\\Classes\\OpenKeep.Document\\shell\\open\\command",
      "/ve",
      "/d",
      command,
      "/f",
    ]);
    for (const extension of SUPPORTED_FILE_EXTENSIONS) {
      await run("reg.exe", [
        "ADD",
        `HKCU\\Software\\Classes\\${extension}\\OpenWithProgids`,
        "/v",
        "OpenKeep.Document",
        "/t",
        "REG_NONE",
        "/f",
      ]);
    }
    return;
  }

  if (platform === "linux") {
    await ensureDirectory(applicationsDirectory);
    await writeText(
      path.join(applicationsDirectory, "openkeep.desktop"),
      linuxDesktopEntry(execPath),
    );
  }
}
