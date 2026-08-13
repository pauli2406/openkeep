/**
 * The SQLCipher-capable fork of better-sqlite3, used only by the test that
 * proves the offline copy is ciphertext at rest. It ships no declarations of its
 * own; its surface is better-sqlite3's, plus the `cipher` and `key` pragmas.
 */
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "better-sqlite3";
  export = Database;
}
