import fs from 'node:fs';
import path from 'node:path';

let tmpSeq = 0;
const fileLocks = new Map<string, Promise<unknown>>();

/**
 * Serializes read-modify-write operations targeting the same file path so
 * concurrent requests or cross-module writers cannot clobber each other.
 */
export function withFileLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const prev = fileLocks.get(key) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    () => fn()
  );
  const tail = next.then(
    () => undefined,
    () => undefined
  );
  fileLocks.set(key, tail);
  void tail.finally(() => {
    if (fileLocks.get(key) === tail) {
      fileLocks.delete(key);
    }
  });
  return next;
}

function nextTmpPath(filePath: string): string {
  tmpSeq += 1;
  return `${filePath}.tmp.${process.pid}.${Date.now()}.${tmpSeq}`;
}

function writeAndSyncFile(targetPath: string, content: string): void {
  const fd = fs.openSync(targetPath, 'w', 0o666);
  try {
    fs.writeFileSync(fd, content, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomically writes text content to disk via a unique temp file + fsync + rename.
 * Optionally preserves a `.bak` copy of the prior non-empty file before replacing.
 */
export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options?: { preserveBackup?: boolean }
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (options?.preserveBackup && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        const bakPath = `${filePath}.bak`;
        const bakTmp = nextTmpPath(bakPath);
        fs.copyFileSync(filePath, bakTmp);
        fs.renameSync(bakTmp, bakPath);
      }
    } catch {
      // Non-fatal backup failure; proceed with atomic primary write
    }
  }

  const tmp = nextTmpPath(filePath);
  try {
    writeAndSyncFile(tmp, content);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export function atomicWriteJsonSync(
  filePath: string,
  data: unknown,
  options?: { pretty?: boolean; preserveBackup?: boolean }
): void {
  const payload = options?.pretty
    ? JSON.stringify(data, null, 2) + '\n'
    : JSON.stringify(data);
  atomicWriteFileSync(filePath, payload, { preserveBackup: options?.preserveBackup });
}

/**
 * Reads and parses a JSON file safely, falling back to `.bak` if primary is corrupt.
 * When `throwOnCorruptWithoutBackup` is true, refuses to silently treat a corrupt
 * non-empty file as empty so callers do not accidentally overwrite existing data.
 */
export function readJsonSafe<T>(
  filePath: string,
  fallback: T,
  options?: {
    validate?: (parsed: unknown) => parsed is T;
    throwOnCorruptWithoutBackup?: boolean;
  }
): T {
  const tryParse = (candidate: string): { ok: true; value: T } | { ok: false; existsNonEmpty: boolean; err?: Error } => {
    if (!fs.existsSync(candidate)) {
      return { ok: false, existsNonEmpty: false };
    }
    try {
      const raw = fs.readFileSync(candidate, 'utf-8');
      if (raw.trim().length === 0) {
        return { ok: false, existsNonEmpty: false };
      }
      const parsed: unknown = JSON.parse(raw);
      if (options?.validate && !options.validate(parsed)) {
        return {
          ok: false,
          existsNonEmpty: true,
          err: new Error(`Validation failed for JSON store ${path.basename(candidate)}`),
        };
      }
      return { ok: true, value: parsed as T };
    } catch (err) {
      return {
        ok: false,
        existsNonEmpty: true,
        err: err instanceof Error ? err : new Error(String(err)),
      };
    }
  };

  const primary = tryParse(filePath);
  if (primary.ok) return primary.value;

  const backup = tryParse(`${filePath}.bak`);
  if (backup.ok) return backup.value;

  if (primary.existsNonEmpty && options?.throwOnCorruptWithoutBackup) {
    throw new Error(
      `Refusing to overwrite corrupted JSON store ${path.basename(filePath)}: ${
        primary.err?.message || 'parse error'
      }`
    );
  }

  return fallback;
}
