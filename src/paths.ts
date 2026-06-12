import { access, mkdir, rename } from "fs/promises";
import { join } from "path";

export const DATA_DIR = "data";
export const ALL_TOKENS_JSON = join(DATA_DIR, "all_tokens.json");
export const ALL_TOKENS_CSV = join(DATA_DIR, "all_tokens.csv");
export const TOKENS_WITH_MULTIPLE_POOLS_JSON = join(DATA_DIR, "tokens_with_multiple_pools.json");

/** @deprecated Use ALL_TOKENS_JSON */
export const APPROVED_TOKENS_JSON = ALL_TOKENS_JSON;
/** @deprecated Use ALL_TOKENS_CSV */
export const APPROVED_TOKENS_CSV = ALL_TOKENS_CSV;
/** @deprecated Merged into ALL_TOKENS_JSON */
export const UNAPPROVED_TOKENS_JSON = join(DATA_DIR, "unapproved_tokens.json");
/** @deprecated Merged into ALL_TOKENS_CSV */
export const UNAPPROVED_TOKENS_CSV = join(DATA_DIR, "unapproved_tokens.csv");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure data/ exists and move legacy root-level output files if present.
 */
export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  const migrations: [string, string][] = [
    ["approved_tokens.json", ALL_TOKENS_JSON],
    ["approved_tokens.csv", ALL_TOKENS_CSV],
    ["unapproved_tokens.json", join(DATA_DIR, "unapproved_tokens.json")],
    [join(DATA_DIR, "approved_tokens.json"), ALL_TOKENS_JSON],
    [join(DATA_DIR, "approved_tokens.csv"), ALL_TOKENS_CSV],
  ];

  for (const [legacyPath, dataPath] of migrations) {
    if (!(await fileExists(legacyPath)) || (await fileExists(dataPath))) {
      continue;
    }
    try {
      await rename(legacyPath, dataPath);
    } catch {
      // File may be open in another app (e.g. Excel/IDE); new runs still write to data/
    }
  }
}
