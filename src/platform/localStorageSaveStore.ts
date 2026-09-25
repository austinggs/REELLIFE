/**
 * Browser save storage (System 06 platform adapter).
 *
 * ReelLife's native format is `.reel`; this adapter stores those documents in the
 * browser's local storage. One key holds one complete save, so a write is a single
 * atomic replace: a partially written save can never be read back.
 *
 * The store is byte-oriented and validates on read, so corruption is surfaced with
 * an explanation rather than loaded as if it were valid.
 */

import { canonicalJson } from "@/engine/rng/hash.ts";
import type { ReelFile, ReelSlotInfo } from "@/engine/persistence/format.ts";
import { slotInfoOf, type SaveStore } from "@/engine/persistence/store.ts";
import { validateReelFile } from "@/engine/persistence/validate.ts";

const KEY_PREFIX = "reellife.reel.";
const INDEX_KEY = "reellife.reel.index";

function slotKey(slotName: string): string {
  return `${KEY_PREFIX}${slotName}`;
}

function readIndex(): string[] {
  const raw = globalThis.localStorage?.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(slots: string[]): void {
  globalThis.localStorage?.setItem(INDEX_KEY, canonicalJson([...new Set(slots)]));
}

export class LocalStorageSaveStore implements SaveStore {
  async listSlots(): Promise<ReelSlotInfo[]> {
    const infos: ReelSlotInfo[] = [];
    for (const slotName of readIndex()) {
      const text = globalThis.localStorage?.getItem(slotKey(slotName));
      if (!text) continue;
      infos.push(slotInfoOf(slotName, JSON.parse(text) as ReelFile, text.length));
    }
    return infos;
  }

  async has(slotName: string): Promise<boolean> {
    return globalThis.localStorage?.getItem(slotKey(slotName)) !== null;
  }

  async read(slotName: string): Promise<ReelFile | null> {
    const text = globalThis.localStorage?.getItem(slotKey(slotName));
    if (!text) return null;

    const parsed: unknown = JSON.parse(text);
    const problems = validateReelFile(parsed).filter((issue) => issue.severity === "error");
    if (problems.length > 0) {
      throw new Error(
        `Save "${slotName}" failed validation: ${problems.map((issue) => issue.message).join("; ")}`,
      );
    }
    return parsed as ReelFile;
  }

  async write(slotName: string, file: ReelFile): Promise<ReelSlotInfo> {
    const text = canonicalJson(file);
    // Single key write: the previous save stays intact until this line, and the
    // new save is complete immediately afterwards.
    globalThis.localStorage?.setItem(slotKey(slotName), text);
    writeIndex([...readIndex(), slotName]);
    return slotInfoOf(slotName, file, text.length);
  }

  async delete(slotName: string): Promise<void> {
    globalThis.localStorage?.removeItem(slotKey(slotName));
    writeIndex(readIndex().filter((entry) => entry !== slotName));
  }
}
