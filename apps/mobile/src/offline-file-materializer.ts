/**
 * Handing an encrypted document's bytes to something that can only open a file.
 *
 * `react-native-pdf` and the OS file viewer take a URI, not a buffer, so an
 * encrypted copy has to be written out in the clear before it can be shown.
 * Stating that plainly beats implying the bytes never touch disk: they do, for
 * as long as the document is open.
 *
 * What keeps that narrow is where and for how long. The plaintext copy goes to
 * the cache directory — evictable by the OS, excluded from backups — under a name
 * that is deleted when the viewer closes, and again on the next launch by the
 * sweep below. The archive of record stays encrypted; this is a scratch copy.
 */
import type { OfflineFileSystem } from "./offline-file-cache";

export type OfflineFileMaterializer = ReturnType<typeof createOfflineFileMaterializer>;

export function createOfflineFileMaterializer({
  files,
  scratchDirectory,
}: {
  files: OfflineFileSystem;
  /** Cache directory, not the document directory: this is not archive data. */
  scratchDirectory: string;
}) {
  const scratchDir = `${scratchDirectory}openkeep-open`;
  const open = new Map<string, string>();

  async function ensureDir() {
    await files.makeDirectory(scratchDir);
  }

  function pathFor(documentId: string, extension: string) {
    return `${scratchDir}/${documentId}${extension}`;
  }

  /**
   * Writes the chunks out in order and returns the URI to open. Chunk-at-a-time
   * so a large PDF is never held whole in memory.
   */
  async function materialize({
    documentId,
    extension,
    chunks,
  }: {
    documentId: string;
    extension: string;
    chunks: Uint8Array[];
  }) {
    await ensureDir();
    const uri = pathFor(documentId, extension);
    await files.delete(uri).catch(() => undefined);
    for (const [index, chunk] of chunks.entries()) {
      await files.appendBytes(uri, chunk, index === 0);
    }
    open.set(documentId, uri);
    return uri;
  }

  /** Called when a viewer closes; the plaintext copy must not outlive it. */
  async function release(documentId: string) {
    const uri = open.get(documentId);
    if (!uri) {
      return;
    }
    open.delete(documentId);
    await files.delete(uri).catch(() => undefined);
  }

  /**
   * Removes anything a previous run left behind — a crash or a kill skips the
   * release above, and a plaintext document should not survive that.
   */
  async function sweep() {
    await files.delete(scratchDir).catch(() => undefined);
    await ensureDir();
    open.clear();
  }

  return { scratchDir, materialize, release, sweep };
}
