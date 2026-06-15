import { readFile, writeFile } from "fs/promises";
import { ALL_TOKENS_CSV, ALL_TOKENS_JSON } from "./paths.js";

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

function setCsvCell(row: string[], headers: string[], name: string, value: string): void {
  const i = headers.indexOf(name);
  if (i === -1) return;
  while (row.length <= i) row.push("");
  row[i] = value;
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
