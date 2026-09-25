import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class-name merge helper required by the bundled shadcn/ui component source
 * (the vendored files import `cn`). This file is the ReelLife replacement for
 * the shadcn registry's `cn` import specifier.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
