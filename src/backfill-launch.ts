import { access, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import "dotenv/config";
import { exportAllTokensToCSV } from "./approved-csv.js";
import { fetchFirstBuyInfo, HELIUS_RPC_DELAY_MS, formatFirstSwapDisplay, formatCreatorFeeDisplay } from "./launch-tx.js";
import { ALL_TOKENS_CSV, ensureDataDir } from "./paths.js";

const SAVE_EVERY = 25;
const SAVE_RETRIES = 5;

const COL_TOKEN = "Token Address";
const COL_SWAP = "First Swap SOL Amount";
const COL_FEE = "First Buy Creator Fee (SOL)";
const COL_LAUNCH_NOTE = "Launch Note";
const COL_HAS_FEE_SHARING = "Has Fee Sharing";
const COL_LAUNCH_FEE_SHAREHOLDERS = "Launch Fee Shareholders";
const COL_FEE_SHAREHOLDERS = "Fee Shareholders";

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

function rowToCsvLine(fields: string[]): string {
  return fields.map((f) => escapeCSV(f)).join(",");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadAllTokensCsv(): Promise<{ headers: string[]; rows: string[][] }> {
  const content = await readFile(ALL_TOKENS_CSV, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error(`${ALL_TOKENS_CSV} is empty or has no data rows`);
  }

  const headers = parseCSVLine(lines[0]!);
  const rows = lines.slice(1).map((line) => parseCSVLine(line));

  return { headers, rows };
}

async function saveAllTokensCsv(headers: string[], rows: string[][]): Promise<boolean> {
  const content = [rowToCsvLine(headers), ...rows.map((row) => rowToCsvLine(row))].join("\n");
  const dir = dirname(ALL_TOKENS_CSV);
  const tmpPath = join(dir, `.all_tokens.csv.tmp.${process.pid}`);

  for (let attempt = 1; attempt <= SAVE_RETRIES; attempt++) {
    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, ALL_TOKENS_CSV);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < SAVE_RETRIES && (code === "EBUSY" || code === "EPERM")) {
        console.log(`    ⚠ CSV locked, retry ${attempt}/${SAVE_RETRIES}... (close Excel if open)`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }

      // Fallback: direct write when rename fails (common on Windows with file watchers)
      if (code === "EBUSY" || code === "EPERM") {
        try {
          await writeFile(ALL_TOKENS_CSV, content, "utf-8");
          return true;
        } catch {
          return false;
        }
      }

      throw error;
    }
  }

  return false;
}

function needsBackfill(row: string[], swapCol: number, force: boolean): boolean {
  if (force) {
    return true;
  }
  const swap = row[swapCol]?.trim();
  return !swap;
}

async function main() {
  const force = process.argv.includes("--force");

  await ensureDataDir();

  if (!process.env.HELIUS_RPC_URL) {
    console.error("❌ HELIUS_RPC_URL not set in .env");
    process.exit(1);
  }

  if (!(await fileExists(ALL_TOKENS_CSV))) {
    console.log(`📄 ${ALL_TOKENS_CSV} not found — generating from JSON...`);
    await exportAllTokensToCSV();
  }

  const { headers, rows } = await loadAllTokensCsv();

  const tokenCol = headers.indexOf(COL_TOKEN);
  const swapCol = headers.indexOf(COL_SWAP);
  const feeCol = headers.indexOf(COL_FEE);
  let noteCol = headers.indexOf(COL_LAUNCH_NOTE);
  let hasFeeSharingCol = headers.indexOf(COL_HAS_FEE_SHARING);
  let launchFeeShareholdersCol = headers.indexOf(COL_LAUNCH_FEE_SHAREHOLDERS);
  let feeShareholdersCol = headers.indexOf(COL_FEE_SHAREHOLDERS);

  const newColumns: Array<{ name: string; getIndex: () => number; setIndex: (i: number) => void }> = [
    { name: COL_LAUNCH_NOTE, getIndex: () => noteCol, setIndex: (i) => { noteCol = i; } },
    { name: COL_HAS_FEE_SHARING, getIndex: () => hasFeeSharingCol, setIndex: (i) => { hasFeeSharingCol = i; } },
    { name: COL_LAUNCH_FEE_SHAREHOLDERS, getIndex: () => launchFeeShareholdersCol, setIndex: (i) => { launchFeeShareholdersCol = i; } },
    { name: COL_FEE_SHAREHOLDERS, getIndex: () => feeShareholdersCol, setIndex: (i) => { feeShareholdersCol = i; } },
  ];

  for (const col of newColumns) {
    if (col.getIndex() === -1) {
      headers.push(col.name);
      col.setIndex(headers.length - 1);
      for (const row of rows) {
        row.push("");
      }
    }
  }

  if (tokenCol === -1 || swapCol === -1 || feeCol === -1) {
    console.error(
      `❌ Missing required columns in ${ALL_TOKENS_CSV}. Need: ${COL_TOKEN}, ${COL_SWAP}, ${COL_FEE}`
    );
    process.exit(1);
  }

  const workIndexes: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]![tokenCol]?.trim() && needsBackfill(rows[i]!, swapCol, force)) {
      workIndexes.push(i);
    }
  }

  console.log("🚀 Backfilling launch data into all_tokens.csv (Helius parsed tx API)...\n");
  if (force) {
    console.log("   Mode: --force (re-fetch rows missing swap data)\n");
  }

  console.log(`   File:        ${ALL_TOKENS_CSV}`);
  console.log(`   Total rows:  ${rows.length}`);
  console.log(`   To backfill: ${workIndexes.length}\n`);

  if (workIndexes.length === 0) {
    console.log("✓ Nothing to backfill.");
    return;
  }

  let updated = 0;
  let found = 0;
  let notFound = 0;
  let unsavedChanges = false;

  for (let n = 0; n < workIndexes.length; n++) {
    const rowIndex = workIndexes[n]!;
    const row = rows[rowIndex]!;
    const address = row[tokenCol]!.trim();

    console.log(`[${n + 1}/${workIndexes.length}] ${address}`);

    let launchInfo = null;
    try {
      launchInfo = await fetchFirstBuyInfo(address);
    } catch (error) {
      console.log(`    ⚠ fetch error: ${error instanceof Error ? error.message : error}`);
    }

    if (launchInfo) {
      row[swapCol] = formatFirstSwapDisplay(launchInfo);
      row[feeCol] = formatCreatorFeeDisplay(launchInfo);
      row[noteCol] = launchInfo.launchNote ?? "";
      row[hasFeeSharingCol] = launchInfo.hasFeeSharingConfig ? "Yes" : "No";
      row[launchFeeShareholdersCol] = launchInfo.launchFeeShareholders ?? "";
      row[feeShareholdersCol] = launchInfo.feeShareholders ?? "";
      found++;
      const noteSuffix = launchInfo.launchNote ? ` | ${launchInfo.launchNote}` : "";
      const feeSuffix = launchInfo.feeShareholders
        ? ` | feeShares=${launchInfo.feeShareholders}`
        : "";
      console.log(
        `    ✓ swap=${formatFirstSwapDisplay(launchInfo)}, fee=${formatCreatorFeeDisplay(launchInfo)}${noteSuffix}${feeSuffix}`
      );
    } else {
      row[swapCol] = "";
      row[feeCol] = "";
      row[noteCol] = "";
      row[hasFeeSharingCol] = "";
      row[launchFeeShareholdersCol] = "";
      row[feeShareholdersCol] = "";
      notFound++;
      console.log("    ✗ no launch buy found");
    }

    updated++;
    unsavedChanges = true;

    if (updated % SAVE_EVERY === 0 || n === workIndexes.length - 1) {
      const saved = await saveAllTokensCsv(headers, rows);
      if (saved) {
        unsavedChanges = false;
        console.log(`    💾 Saved ${ALL_TOKENS_CSV} (${updated}/${workIndexes.length})`);
      } else {
        console.log(
          "    ⚠ Could not save CSV (file locked). Progress kept in memory — close Excel; will retry at next checkpoint."
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, HELIUS_RPC_DELAY_MS));
  }

  if (unsavedChanges) {
    console.log("\n⚠ Retrying final save...");
    const saved = await saveAllTokensCsv(headers, rows);
    if (saved) {
      unsavedChanges = false;
      console.log(`✓ Saved ${ALL_TOKENS_CSV}`);
    } else {
      console.log(`❌ Could not save ${ALL_TOKENS_CSV} — close Excel and run backfill again to resume.`);
    }
  }

  console.log("\n=== Done ===");
  console.log(`Rows updated:     ${updated}`);
  console.log(`Launch found:     ${found}`);
  console.log(`Launch not found: ${notFound}`);
  console.log(`Output:           ${ALL_TOKENS_CSV}`);
}

main().catch((error) => {
  console.error("❌ Backfill failed:", error);
  process.exit(1);
});
