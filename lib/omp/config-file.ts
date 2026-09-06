import { randomUUID } from "crypto";
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from "fs";

/** Replace a config without exposing credentials in a shared-readable temporary file. */
export function writeConfigFileAtomic(path: string, content: string): void {
  const temp = `${path}.tmp-${randomUUID()}`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, content, "utf8");
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}
