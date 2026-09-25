/**
 * ReelLife save storage abstraction (System 06).
 *
 * The engine defines the contract; platform adapters implement it (IndexedDB,
 * local storage, file system, tests). Keeping the interface here means the
 * engine never touches a browser API, which is why it can be tested in Node.
 *
 * Storage is byte-oriented on purpose: adapters persist serialized text, so
 * integrity checks and migrations always operate on exactly what was written.
 *
 * Atomicity: `write` must either leave the previous content intact or leave the
 * new content complete. Adapters achieve this however their medium allows
 * (single-transaction put, temp file plus rename, etc.). A partially written
 * save must never be readable.
 */

import { canonicalJson } from "../rng/hash.ts";
import type { ReelFile, ReelSlotInfo } from "./format.ts";
import { REEL_FORMAT } from "./format.ts";
import { assertValidReelFile, validateReelFile } from "./validate.ts";

export interface SaveStore {
  listSlots(): Promise<ReelSlotInfo[]>;
  has(slotName: string): Promise<boolean>;
  read(slotName: string): Promise<ReelFile | null>;
  write(slotName: string, file: ReelFile): Promise<ReelSlotInfo>;
  delete(slotName: string): Promise<void>;
}

export class SaveNotFoundError extends Error {
  constructor(slotName: string) {
    super(`No save exists in slot "${slotName}"`);
    this.name = "SaveNotFoundError";
  }
}

export async function serializeReelFile(file: ReelFile): Promise<string> {
  return canonicalJson(file);
}

export async function parseReelFile(text: string): Promise<ReelFile> {
  const parsed: unknown = JSON.parse(text);
  assertValidReelFile(parsed);
  return parsed;
}

export function slotInfoOf(slotName: string, file: ReelFile, sizeBytes: number): ReelSlotInfo {
  return {
    slotName,
    saveId: file.header.saveId,
    savedAtLabel: file.header.savedAtLabel,
    worldName: file.header.worldName,
    worldDateLabel: file.header.worldDateLabel,
    generation: file.header.generation,
    formatVersion: file.header.formatVersion,
    contentVersion: file.header.contentVersion,
    sizeBytes,
  };
}

/** In-memory store used by tests, the headless harness and replay tooling. */
export class MemorySaveStore implements SaveStore {
  private readonly slots = new Map<string, string>();
  private readonly order: string[] = [];

  async listSlots(): Promise<ReelSlotInfo[]> {
    const infos: ReelSlotInfo[] = [];
    for (const slotName of this.order) {
      const text = this.slots.get(slotName);
      if (text === undefined) continue;
      infos.push(slotInfoOf(slotName, JSON.parse(text) as ReelFile, text.length));
    }
    return infos;
  }

  async has(slotName: string): Promise<boolean> {
    return this.slots.has(slotName);
  }

  async read(slotName: string): Promise<ReelFile | null> {
    const text = this.slots.get(slotName);
    if (text === undefined) return null;
    const parsed: unknown = JSON.parse(text);
    const issues = validateReelFile(parsed);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      // A corrupt save is surfaced, not repaired silently.
      throw new Error(`Save "${slotName}" failed validation: ${errors.map((i) => i.message).join("; ")}`);
    }
    return parsed as ReelFile;
  }

  async write(slotName: string, file: ReelFile): Promise<ReelSlotInfo> {
    const text = await serializeReelFile(file);
    if (!this.slots.has(slotName)) this.order.push(slotName);
    // Single assignment: the memory store is atomic by construction, which is
    // the behaviour every other adapter must emulate.
    this.slots.set(slotName, text);
    return slotInfoOf(slotName, file, text.length);
  }

  async delete(slotName: string): Promise<void> {
    this.slots.delete(slotName);
    const index = this.order.indexOf(slotName);
    if (index >= 0) this.order.splice(index, 1);
  }

  /** Raw text access for corruption tests. */
  rawText(slotName: string): string | undefined {
    return this.slots.get(slotName);
  }

  /** Simulates an interrupted write for recovery testing. */
  corrupt(slotName: string, mutate: (text: string) => string): void {
    const text = this.slots.get(slotName);
    if (text === undefined) throw new SaveNotFoundError(slotName);
    this.slots.set(slotName, mutate(text));
  }
}

export const REEL_FILE_EXTENSION = `.${REEL_FORMAT}`;
