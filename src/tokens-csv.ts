import { readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ALL_TOKENS_CSV, ALL_TOKENS_JSON } from "./paths.js";

const CSV_SAVE_RETRIES = 5;

export function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const TOKEN_CSV_HEADERS = [
  "Index",
  "Has TokenProfile",
  "Token Address",
  "GMGN URL",
  "Twitter URL",
  "Telegram URL",
  "Website URL",
  "Website Hosting IP Address",
  "It is hosted by",
  "Registrar",
  "Phone",
  "Mailing Address",
  "Registrar Contact Phone",
  "Registrar Contact Email",
  "Registered On",
  "Expires On",
  "Updated On",
  "Organic Score",
  "Organic Score Label",
  "Highlighted",
  "Created Date",
  "Graduated Date",
  "Creation to Migration Time",
  "Creation to Migration Time (ms)",
  "TokenProfile Approved Before Migration",
  "TokenProfile vs Migration Time",
  "TokenProfile vs Migration Time (ms)",
  "Has TokenAd",
  "TokenAd Count",
  "TokenAd Payment Date",
  "TokenAd Approved Before Migration",
  "TokenAd vs Migration Time",
  "TokenAd vs Migration Time (ms)",
  "Has CommunityTakeover",
  "CommunityTakeover Count",
  "CommunityTakeover Payment Date",
  "CommunityTakeover Approved Before Migration",
  "CommunityTakeover vs Migration Time",
  "CommunityTakeover vs Migration Time (ms)",
  "Has Boosts",
  "Boost Count",
  "Total Boost Amount",
  "First Boost Amount",
  "First Boost Date",
  "First Boost Before Migration",
  "First Boost vs Migration Time",
  "First Boost vs Migration Time (ms)",
  "First Swap SOL Amount",
  "First Buy Creator Fee (SOL)",
  "Launch Note",
  "Has Fee Sharing",
  "Launch Fee Shareholders",
  "Fee Shareholders",
];

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

/** Token info columns (migration, dex orders, website — not launch/swap). */
export function applyTokenInfoToRow(row: string[], headers: string[], token: any): void {
  const set = (name: string, value: string) => setCsvCell(row, headers, name, value);

  set("Has TokenProfile", token.hasTokenProfile ? "Yes" : "No");
  if (token.gmgnUrl) set("GMGN URL", token.gmgnUrl);
  set("Twitter URL", token.migration?.twitter ?? "");
  set("Telegram URL", token.migration?.telegram ?? "");
  set("Website URL", token.migration?.website ?? "");
  set("Website Hosting IP Address", token.migration?.websiteDetails?.hostingIp ?? "");
  set("It is hosted by", token.migration?.websiteDetails?.hostedBy ?? "");
  set("Registrar", token.migration?.websiteDetails?.registrar ?? "");
  set("Phone", token.migration?.websiteDetails?.phone ?? "");
  set("Mailing Address", token.migration?.websiteDetails?.mailingAddress ?? "");
  set("Registrar Contact Phone", token.migration?.websiteDetails?.registrarContactPhone ?? "");
  set("Registrar Contact Email", token.migration?.websiteDetails?.registrarContactEmail ?? "");
  set("Registered On", token.migration?.websiteDetails?.registeredOn ?? "");
  set("Expires On", token.migration?.websiteDetails?.expiresOn ?? "");
  set("Updated On", token.migration?.websiteDetails?.updatedOn ?? "");
  set("Organic Score", token.migration?.organicScore?.toString() ?? "");
  set("Organic Score Label", token.migration?.organicScoreLabel ?? "");
  set("Highlighted", token.highlighted ? "Yes" : "No");
  set("Created Date", token.migration?.createdAt ?? "");
  set("Graduated Date", token.migration?.graduatedAt ?? "");
  set("Creation to Migration Time", token.migration?.creationToMigration ?? "");
  set("Creation to Migration Time (ms)", token.migration?.creationToMigrationMs?.toString() ?? "");
  set(
    "TokenProfile Approved Before Migration",
    yesNo(token.migration?.isApprovedBeforeMigration ?? null)
  );
  set("TokenProfile vs Migration Time", token.migration?.approvedVsMigration ?? "");
  set("TokenProfile vs Migration Time (ms)", token.migration?.approvedVsMigrationMs?.toString() ?? "");
  set("Has TokenAd", token.tokenAd?.hasTokenAd ? "Yes" : "No");
  set("TokenAd Count", token.tokenAd?.adCount?.toString() ?? "0");
  set("TokenAd Payment Date", token.tokenAd?.paymentDate ?? "");
  set("TokenAd Approved Before Migration", yesNo(token.tokenAd?.isApprovedBeforeMigration ?? null));
  set("TokenAd vs Migration Time", token.tokenAd?.approvedVsMigration ?? "");
  set("TokenAd vs Migration Time (ms)", token.tokenAd?.approvedVsMigrationMs?.toString() ?? "");
  set("Has CommunityTakeover", token.communityTakeover?.hasCommunityTakeover ? "Yes" : "No");
  set("CommunityTakeover Count", token.communityTakeover?.takeoverCount?.toString() ?? "0");
  set("CommunityTakeover Payment Date", token.communityTakeover?.paymentDate ?? "");
  set(
    "CommunityTakeover Approved Before Migration",
    yesNo(token.communityTakeover?.isApprovedBeforeMigration ?? null)
  );
  set("CommunityTakeover vs Migration Time", token.communityTakeover?.approvedVsMigration ?? "");
  set(
    "CommunityTakeover vs Migration Time (ms)",
    token.communityTakeover?.approvedVsMigrationMs?.toString() ?? ""
  );
  set("Has Boosts", token.boost?.hasBoosts ? "Yes" : "No");
  set("Boost Count", token.boost?.count?.toString() ?? "0");
  set("Total Boost Amount", token.boost?.totalAmount?.toString() ?? "0");
  set("First Boost Amount", token.boost?.firstBoost?.amount?.toString() ?? "");
  set("First Boost Date", token.boost?.firstBoost?.date ?? "");
  set(
    "First Boost Before Migration",
    yesNo(token.boost?.firstBoostVsMigration?.isBeforeMigration ?? null)
  );
  set("First Boost vs Migration Time", token.boost?.firstBoostVsMigration?.time ?? "");
  set("First Boost vs Migration Time (ms)", token.boost?.firstBoostVsMigration?.timeMs?.toString() ?? "");
}

export function buildTokenRow(token: any, index: number): string[] {
  const row = new Array(TOKEN_CSV_HEADERS.length).fill("");
  row[0] = (index + 1).toString();
  setCsvCell(row, TOKEN_CSV_HEADERS, "Token Address", token.tokenAddress || "");
  applyTokenInfoToRow(row, TOKEN_CSV_HEADERS, token);
  setCsvCell(row, TOKEN_CSV_HEADERS, "First Swap SOL Amount", token.launch?.firstSwapDisplay || token.launch?.firstSwapSol?.toString() || "");
  setCsvCell(row, TOKEN_CSV_HEADERS, "First Buy Creator Fee (SOL)", token.launch?.firstBuyCreatorFeeDisplay || token.launch?.firstBuyCreatorFeeSol?.toString() || "");
  setCsvCell(row, TOKEN_CSV_HEADERS, "Launch Note", token.launch?.launchNote || "");
  setCsvCell(
    row,
    TOKEN_CSV_HEADERS,
    "Has Fee Sharing",
    token.launch?.hasFeeSharingConfig ? "Yes" : token.launch?.hasFeeSharingConfig === false ? "No" : ""
  );
  setCsvCell(row, TOKEN_CSV_HEADERS, "Launch Fee Shareholders", token.launch?.launchFeeShareholders || "");
  setCsvCell(row, TOKEN_CSV_HEADERS, "Fee Shareholders", token.launch?.feeShareholders || "");
  return row;
}

export function parseCSVLine(line: string): string[] {
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

export function rowToCsvLine(fields: string[]): string {
  return fields.map((f) => escapeCSV(f)).join(",");
}

export function getCsvCell(row: string[], headers: string[], name: string): string {
  const i = headers.indexOf(name);
  if (i === -1) return "";
  return row[i]?.trim() ?? "";
}

export function setCsvCell(row: string[], headers: string[], name: string, value: string): void {
  const i = headers.indexOf(name);
  if (i === -1) return;
  while (row.length <= i) row.push("");
  row[i] = value;
}

function parseYesNoCell(value: string): boolean | null {
  if (value === "Yes") return true;
  if (value === "No") return false;
  return null;
}

function parseOptionalNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cell(row: string[], headers: string[], name: string): string {
  return getCsvCell(row, headers, name);
}

/** Convert one CSV row to the token object shape used in all_tokens.json */
export function csvRowToToken(row: string[], headers: string[]): Record<string, unknown> | null {
  const tokenAddress = cell(row, headers, "Token Address");
  if (!tokenAddress) return null;

  const gmgnUrl =
    cell(row, headers, "GMGN URL") || `https://gmgn.ai/sol/token/${tokenAddress}`;
  const hasTokenProfile = cell(row, headers, "Has TokenProfile") === "Yes";
  const highlighted = cell(row, headers, "Highlighted") === "Yes";
  const errorCol = headers.indexOf("Error") >= 0 ? cell(row, headers, "Error") || null : null;

  const websiteIp = cell(row, headers, "Website Hosting IP Address");
  const websiteDetails =
    websiteIp ||
    cell(row, headers, "It is hosted by") ||
    cell(row, headers, "Registrar")
      ? {
          hostingIp: websiteIp || null,
          hostedBy: cell(row, headers, "It is hosted by") || null,
          registrar: cell(row, headers, "Registrar") || null,
          phone: cell(row, headers, "Phone") || null,
          mailingAddress: cell(row, headers, "Mailing Address") || null,
          registrarContactPhone: cell(row, headers, "Registrar Contact Phone") || null,
          registrarContactEmail: cell(row, headers, "Registrar Contact Email") || null,
          registeredOn: cell(row, headers, "Registered On") || null,
          expiresOn: cell(row, headers, "Expires On") || null,
          updatedOn: cell(row, headers, "Updated On") || null,
        }
      : null;

  const createdAt = cell(row, headers, "Created Date");
  const graduatedAt = cell(row, headers, "Graduated Date");
  const organicScoreRaw = cell(row, headers, "Organic Score");
  const organicScore = organicScoreRaw ? parseOptionalNumber(organicScoreRaw) : null;

  const migration =
    createdAt || graduatedAt || organicScoreRaw || cell(row, headers, "Twitter URL")
      ? {
          createdAt: createdAt || null,
          graduatedAt: graduatedAt || null,
          twitter: cell(row, headers, "Twitter URL") || null,
          telegram: cell(row, headers, "Telegram URL") || null,
          website: cell(row, headers, "Website URL") || null,
          organicScore,
          organicScoreLabel: cell(row, headers, "Organic Score Label") || null,
          isApprovedBeforeMigration: parseYesNoCell(
            cell(row, headers, "TokenProfile Approved Before Migration")
          ),
          approvedVsMigrationMs: parseOptionalNumber(
            cell(row, headers, "TokenProfile vs Migration Time (ms)")
          ),
          approvedVsMigration: cell(row, headers, "TokenProfile vs Migration Time") || null,
          creationToMigrationMs: parseOptionalNumber(
            cell(row, headers, "Creation to Migration Time (ms)")
          ),
          creationToMigration: cell(row, headers, "Creation to Migration Time") || null,
          websiteDetails,
        }
      : null;

  const hasTokenAd = cell(row, headers, "Has TokenAd") === "Yes";
  const tokenAd = hasTokenAd
    ? {
        hasTokenAd: true,
        adCount: parseOptionalNumber(cell(row, headers, "TokenAd Count")) ?? 0,
        paymentTimestamp: null,
        paymentDate: cell(row, headers, "TokenAd Payment Date") || null,
        isApprovedBeforeMigration: parseYesNoCell(
          cell(row, headers, "TokenAd Approved Before Migration")
        ),
        approvedVsMigrationMs: parseOptionalNumber(
          cell(row, headers, "TokenAd vs Migration Time (ms)")
        ),
        approvedVsMigration: cell(row, headers, "TokenAd vs Migration Time") || null,
      }
    : null;

  const hasCommunityTakeover = cell(row, headers, "Has CommunityTakeover") === "Yes";
  const communityTakeover = hasCommunityTakeover
    ? {
        hasCommunityTakeover: true,
        takeoverCount:
          parseOptionalNumber(cell(row, headers, "CommunityTakeover Count")) ?? 0,
        paymentTimestamp: null,
        paymentDate: cell(row, headers, "CommunityTakeover Payment Date") || null,
        isApprovedBeforeMigration: parseYesNoCell(
          cell(row, headers, "CommunityTakeover Approved Before Migration")
        ),
        approvedVsMigrationMs: parseOptionalNumber(
          cell(row, headers, "CommunityTakeover vs Migration Time (ms)")
        ),
        approvedVsMigration:
          cell(row, headers, "CommunityTakeover vs Migration Time") || null,
      }
    : null;

  const hasBoosts = cell(row, headers, "Has Boosts") === "Yes";
  const boost = hasBoosts
    ? {
        hasBoosts: true,
        count: parseOptionalNumber(cell(row, headers, "Boost Count")) ?? 0,
        totalAmount: parseOptionalNumber(cell(row, headers, "Total Boost Amount")) ?? 0,
        firstBoost: cell(row, headers, "First Boost Amount")
          ? {
              amount: parseOptionalNumber(cell(row, headers, "First Boost Amount")),
              date: cell(row, headers, "First Boost Date") || null,
            }
          : null,
        firstBoostVsMigration: cell(row, headers, "First Boost Before Migration")
          ? {
              isBeforeMigration: parseYesNoCell(
                cell(row, headers, "First Boost Before Migration")
              ),
              timeMs: parseOptionalNumber(cell(row, headers, "First Boost vs Migration Time (ms)")),
              time: cell(row, headers, "First Boost vs Migration Time") || null,
            }
          : null,
      }
    : null;

  const firstSwapDisplay = cell(row, headers, "First Swap SOL Amount");
  const firstBuyCreatorFeeDisplay = cell(row, headers, "First Buy Creator Fee (SOL)");
  const feeSharingCell = cell(row, headers, "Has Fee Sharing");
  const hasFeeSharingConfig =
    feeSharingCell === "Yes" ? true : feeSharingCell === "No" ? false : null;

  const launch =
    firstSwapDisplay ||
    firstBuyCreatorFeeDisplay ||
    cell(row, headers, "Launch Note") ||
    feeSharingCell
      ? {
          firstTxSignature: null,
          firstSwapAmount: null,
          firstSwapUnit: firstSwapDisplay.includes("USDC") ? "USDC" : null,
          firstBuyCreatorFeeAmount: null,
          firstBuyCreatorFeeUnit: firstBuyCreatorFeeDisplay.includes("USDC") ? "USDC" : null,
          firstSwapDisplay: firstSwapDisplay || null,
          firstBuyCreatorFeeDisplay: firstBuyCreatorFeeDisplay || null,
          launchNote: cell(row, headers, "Launch Note") || null,
          firstSwapSol:
            firstSwapDisplay && !firstSwapDisplay.includes("USDC")
              ? parseOptionalNumber(firstSwapDisplay)
              : null,
          firstBuyCreatorFeeSol:
            firstBuyCreatorFeeDisplay && !firstBuyCreatorFeeDisplay.includes("USDC")
              ? parseOptionalNumber(firstBuyCreatorFeeDisplay)
              : null,
          hasFeeSharingConfig,
          launchFeeShareholders: cell(row, headers, "Launch Fee Shareholders") || null,
          feeShareholders: cell(row, headers, "Fee Shareholders") || null,
        }
      : null;

  return {
    tokenAddress,
    gmgnUrl,
    hasTokenProfile,
    highlighted,
    error: errorCol,
    migration,
    tokenAd,
    communityTakeover,
    boost,
    launch,
  };
}

export async function buildAllTokensJsonFromCsv(
  csvFilename: string = ALL_TOKENS_CSV
): Promise<{ totalTokens: number; withTokenProfile: number; highlightedCount: number; checkedAt: string; tokens: Record<string, unknown>[] }> {
  const { headers, rows } = await loadAllTokensCsv(csvFilename);
  const tokens: Record<string, unknown>[] = [];

  for (const row of rows) {
    const token = csvRowToToken(row, headers);
    if (token) tokens.push(token);
  }

  return {
    totalTokens: tokens.length,
    withTokenProfile: tokens.filter((t) => t.hasTokenProfile === true).length,
    highlightedCount: tokens.filter((t) => t.highlighted === true).length,
    checkedAt: new Date().toISOString(),
    tokens,
  };
}

export async function exportAllTokensJsonFromCsv(
  csvFilename: string = ALL_TOKENS_CSV,
  jsonFilename: string = ALL_TOKENS_JSON
): Promise<number> {
  const output = await buildAllTokensJsonFromCsv(csvFilename);
  await writeFile(jsonFilename, JSON.stringify(output, null, 2), "utf-8");
  return output.totalTokens;
}

export async function loadAllTokensCsv(
  csvFilename: string = ALL_TOKENS_CSV
): Promise<{ headers: string[]; rows: string[][] }> {
  const content = await readFile(csvFilename, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error(`${csvFilename} is empty or has no data rows`);
  }

  return {
    headers: parseCSVLine(lines[0]!),
    rows: lines.slice(1).map((line) => parseCSVLine(line)),
  };
}

export async function saveAllTokensCsv(
  headers: string[],
  rows: string[][],
  csvFilename: string = ALL_TOKENS_CSV
): Promise<boolean> {
  const content = [rowToCsvLine(headers), ...rows.map((row) => rowToCsvLine(row))].join("\n");
  const dir = dirname(csvFilename);
  const tmpPath = join(dir, `.all_tokens.csv.tmp.${process.pid}`);

  for (let attempt = 1; attempt <= CSV_SAVE_RETRIES; attempt++) {
    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, csvFilename);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < CSV_SAVE_RETRIES && (code === "EBUSY" || code === "EPERM")) {
        console.log(`    ⚠ CSV locked, retry ${attempt}/${CSV_SAVE_RETRIES}... (close Excel if open)`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }

      if (code === "EBUSY" || code === "EPERM") {
        try {
          await writeFile(csvFilename, content, "utf-8");
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

async function loadTokens(filename: string): Promise<any[]> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch {
    return [];
  }
}

async function writeCsv(
  csvFilename: string,
  headers: string[],
  rows: string[][]
): Promise<number> {
  const lines = [headers.map((h) => escapeCSV(h)).join(",")];
  for (const row of rows) {
    lines.push(row.join(","));
  }
  await writeFile(csvFilename, lines.join("\n"), "utf-8");
  return rows.length;
}

/** Export an in-memory token list to CSV (e.g. after JSON is updated in place). */
export async function exportTokensJsonToCSV(
  data: { tokens: any[] },
  csvFilename: string = ALL_TOKENS_CSV
): Promise<void> {
  const rows = data.tokens.map((token, index) => buildTokenRow(token, index));
  const count = await writeCsv(csvFilename, TOKEN_CSV_HEADERS, rows);
  console.log(`✓ Exported ${count} token(s) to ${csvFilename}`);
}

/** Export all tokens from JSON file to CSV. */
export async function exportAllTokensToCSV(
  jsonFilename: string = ALL_TOKENS_JSON,
  csvFilename: string = ALL_TOKENS_CSV
): Promise<void> {
  try {
    const tokens = await loadTokens(jsonFilename);
    if (tokens.length === 0) {
      console.log(`No tokens found in ${jsonFilename}`);
      return;
    }

    await exportTokensJsonToCSV({ tokens }, csvFilename);
  } catch (error) {
    console.error(`❌ Error exporting CSV: ${error}`);
  }
}
