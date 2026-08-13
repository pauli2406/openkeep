/**
 * Wraps the MSI in a WiX Burn bundle, producing OpenKeep-Setup.exe.
 *
 * The MSI is the real installer; the bundle exists because a setup exe is what
 * many people expect to download, and Burn is part of the same WiX toolchain the
 * MSI already comes from — no second installer system to maintain. The bundle
 * carries its own upgrade code, distinct from the MSI's, and chains the MSI so
 * installing either keeps Windows seeing one application.
 *
 * Runs only where WiX runs: the Windows runner, after `make` produced the MSI.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const makeDir = path.join(desktopRoot, "out", "make");

function findMsi(dir) {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  const msi = entries.find((entry) => entry.isFile() && entry.name.endsWith(".msi"));
  if (!msi) {
    throw new Error(`no MSI under ${dir}; run \`pnpm make\` first`);
  }
  return path.join(msi.parentPath ?? msi.path, msi.name);
}

function wixBin(tool) {
  // The GitHub images export WIX with the toolset's install directory; a local
  // machine with WiX on PATH works too.
  return process.env.WIX ? path.join(process.env.WIX, "bin", `${tool}.exe`) : tool;
}

const version = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
).version;
const msiPath = findMsi(makeDir);
const outPath = path.join(path.dirname(msiPath), "OpenKeep-Setup.exe");

// Burn wants a four-part version; a semver prerelease suffix would be rejected.
const bundleVersion = `${version.split("-")[0]}.0`;

const bundle = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi"
     xmlns:bal="http://schemas.microsoft.com/wix/BalExtension">
  <!-- The bundle's own upgrade code — deliberately not the MSI's. Burn tracks
       the bundle by this id and the MSI by its own, and reusing one for the
       other makes upgrades remove the wrong thing. Never change it. -->
  <Bundle Name="OpenKeep"
          Version="${bundleVersion}"
          Manufacturer="OpenKeep contributors"
          UpgradeCode="e3f1c9d0-2b5a-4c7e-8d1f-6a9b0c4e7f21"
          DisableModify="yes">
    <BootstrapperApplicationRef Id="WixStandardBootstrapperApplication.HyperlinkLicense">
      <!-- An empty LicenseUrl hides the license step; the license ships with
           the application itself. -->
      <bal:WixStandardBootstrapperApplication LicenseUrl="" SuppressOptionsUI="yes" />
    </BootstrapperApplicationRef>
    <Chain>
      <MsiPackage SourceFile="${msiPath}" DisplayInternalUI="no" Visible="no" />
    </Chain>
  </Bundle>
</Wix>
`;

const workDir = mkdtempSync(path.join(tmpdir(), "openkeep-bundle-"));
const wxsPath = path.join(workDir, "bundle.wxs");
const objPath = path.join(workDir, "bundle.wixobj");
writeFileSync(wxsPath, bundle);

execFileSync(wixBin("candle"), ["-nologo", "-ext", "WixBalExtension", "-out", objPath, wxsPath], {
  stdio: "inherit",
});
execFileSync(
  wixBin("light"),
  ["-nologo", "-ext", "WixBalExtension", "-out", outPath, objPath],
  { stdio: "inherit" },
);

console.log(`bundle written: ${outPath}`);
