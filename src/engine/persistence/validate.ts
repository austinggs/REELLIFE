/**
 * ReelLife save validation and integrity (System 06 / System 59).
 *
 * Checksums and schema validation guard against corruption. Reference integrity
 * is validated on load, because a reference that cannot be resolved is a
 * persistence error rather than a silently tolerated omission.
 */

import { canonicalJson, checksum32Hex } from "../rng/hash.ts";
import {
  FORMAT_VERSION,
  REEL_FORMAT,
  type ReelBody,
  type ReelFile,
  type ReelHeader,
} from "./format.ts";

export interface SaveIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export function checksumOf(body: ReelBody): string {
  return checksum32Hex(canonicalJson(body));
}

export function canonicalBody(body: ReelBody): string {
  return canonicalJson(body);
}

export class SaveValidationError extends Error {
  readonly issues: readonly SaveIssue[];

  constructor(issues: readonly SaveIssue[]) {
    super(`Invalid .reel file: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "SaveValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateHeader(header: unknown, expected?: {
  readonly simulationVersion: number;
  readonly rngVersion: number;
}): SaveIssue[] {
  const issues: SaveIssue[] = [];
  if (!isRecord(header)) {
    return [{ code: "header_missing", message: "Save header is missing or not an object", severity: "error" }];
  }
  const typed = header as Partial<ReelHeader>;

  if (typed.format !== REEL_FORMAT) {
    issues.push({
      code: "bad_format",
      message: `Expected format "${REEL_FORMAT}", found "${String(typed.format)}"`,
      severity: "error",
    });
  }
  if (typed.formatVersion !== FORMAT_VERSION) {
    issues.push({
      code: "bad_format_version",
      message: `Save format version ${String(typed.formatVersion)} is not supported (expected ${FORMAT_VERSION})`,
      severity: "error",
    });
  }
  for (const field of ["saveId", "slotName", "worldId", "worldName", "checksum"] as const) {
    if (typeof typed[field] !== "string" || (typed[field] as string).length === 0) {
      issues.push({
        code: "missing_field",
        message: `Save header field "${field}" is missing`,
        severity: "error",
      });
    }
  }
  for (const field of ["stepIndex", "rootTimeMinutes", "generation", "commandCount"] as const) {
    if (typeof typed[field] !== "number" || !Number.isFinite(typed[field] as number)) {
      issues.push({
        code: "missing_field",
        message: `Save header field "${field}" is missing or not a number`,
        severity: "error",
      });
    }
  }

  if (expected) {
    if (typed.simulationVersion !== expected.simulationVersion) {
      issues.push({
        code: "simulation_version_mismatch",
        message:
          `Save was written with simulation version ${String(typed.simulationVersion)}, ` +
          `engine is ${expected.simulationVersion}. A migration is required.`,
        severity: "error",
      });
    }
    if (typed.rngVersion !== expected.rngVersion) {
      issues.push({
        code: "rng_version_mismatch",
        message:
          `Save RNG version ${String(typed.rngVersion)} does not match engine RNG version ${expected.rngVersion}`,
        severity: "error",
      });
    }
  }

  return issues;
}

export function validateReelFile(file: unknown, expected?: {
  readonly simulationVersion: number;
  readonly rngVersion: number;
}): SaveIssue[] {
  const issues: SaveIssue[] = [];
  if (!isRecord(file)) {
    return [{ code: "not_a_save", message: "Save file is not an object", severity: "error" }];
  }

  issues.push(...validateHeader(file.header, expected));

  const body = file.body;
  if (!isRecord(body) || !("world" in body)) {
    issues.push({
      code: "body_missing",
      message: "Save body is missing the serialized world",
      severity: "error",
    });
    return issues;
  }

  const header = file.header as Partial<ReelHeader>;
  if (typeof header.checksum === "string") {
    const actual = checksumOf(body as unknown as ReelBody);
    if (actual !== header.checksum) {
      issues.push({
        code: "checksum_mismatch",
        message: `Integrity check failed: stored checksum ${header.checksum}, computed ${actual}`,
        severity: "error",
      });
    }
  }

  return issues;
}

export function assertValidReelFile(file: unknown, expected?: {
  readonly simulationVersion: number;
  readonly rngVersion: number;
}): asserts file is ReelFile {
  const issues = validateReelFile(file, expected);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new SaveValidationError(issues.filter((issue) => issue.severity === "error"));
  }
}
