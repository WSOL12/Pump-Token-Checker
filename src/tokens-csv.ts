import { readFile, writeFile } from "fs/promises";
import { ALL_TOKENS_CSV, ALL_TOKENS_JSON } from "./paths.js";

function escapeCSV(value: unknown): string {
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

export function buildTokenRow(token: any, index: number): string[] {
  return [
    (index + 1).toString(),
    token.hasTokenProfile ? "Yes" : "No",
    escapeCSV(token.tokenAddress || ""),
    escapeCSV(token.gmgnUrl || ""),
    escapeCSV(token.migration?.twitter || ""),
    escapeCSV(token.migration?.telegram || ""),
    escapeCSV(token.migration?.website || ""),
    escapeCSV(token.migration?.websiteDetails?.hostingIp || ""),
    escapeCSV(token.migration?.websiteDetails?.hostedBy || ""),
    escapeCSV(token.migration?.websiteDetails?.registrar || ""),
    escapeCSV(token.migration?.websiteDetails?.phone || ""),
    escapeCSV(token.migration?.websiteDetails?.mailingAddress || ""),
    escapeCSV(token.migration?.websiteDetails?.registrarContactPhone || ""),
    escapeCSV(token.migration?.websiteDetails?.registrarContactEmail || ""),
    escapeCSV(token.migration?.websiteDetails?.registeredOn || ""),
    escapeCSV(token.migration?.websiteDetails?.expiresOn || ""),
    escapeCSV(token.migration?.websiteDetails?.updatedOn || ""),
    escapeCSV(token.migration?.organicScore?.toString() || ""),
    escapeCSV(token.migration?.organicScoreLabel || ""),
    token.highlighted ? "Yes" : "No",
    escapeCSV(token.migration?.createdAt || ""),
    escapeCSV(token.migration?.graduatedAt || ""),
    escapeCSV(token.migration?.creationToMigration || ""),
    escapeCSV(token.migration?.creationToMigrationMs?.toString() || ""),
    token.migration && token.migration.isApprovedBeforeMigration !== null
      ? token.migration.isApprovedBeforeMigration
        ? "Yes"
        : "No"
      : "",
    escapeCSV(token.migration?.approvedVsMigration || ""),
    escapeCSV(token.migration?.approvedVsMigrationMs?.toString() || ""),
    token.tokenAd?.hasTokenAd ? "Yes" : "No",
    escapeCSV(token.tokenAd?.adCount?.toString() || "0"),
    escapeCSV(token.tokenAd?.paymentDate || ""),
    token.tokenAd && token.tokenAd.isApprovedBeforeMigration !== null
      ? token.tokenAd.isApprovedBeforeMigration
        ? "Yes"
        : "No"
      : "",
    escapeCSV(token.tokenAd?.approvedVsMigration || ""),
    escapeCSV(token.tokenAd?.approvedVsMigrationMs?.toString() || ""),
    token.communityTakeover?.hasCommunityTakeover ? "Yes" : "No",
    escapeCSV(token.communityTakeover?.takeoverCount?.toString() || "0"),
    escapeCSV(token.communityTakeover?.paymentDate || ""),
    token.communityTakeover &&
    token.communityTakeover.isApprovedBeforeMigration !== null
      ? token.communityTakeover.isApprovedBeforeMigration
        ? "Yes"
        : "No"
      : "",
    escapeCSV(token.communityTakeover?.approvedVsMigration || ""),
    escapeCSV(token.communityTakeover?.approvedVsMigrationMs?.toString() || ""),
    token.boost?.hasBoosts ? "Yes" : "No",
    escapeCSV(token.boost?.count?.toString() || "0"),
    escapeCSV(token.boost?.totalAmount?.toString() || "0"),
    escapeCSV(token.boost?.firstBoost?.amount?.toString() || ""),
    escapeCSV(token.boost?.firstBoost?.date || ""),
    token.boost?.firstBoostVsMigration &&
    token.boost.firstBoostVsMigration.isBeforeMigration !== null
      ? token.boost.firstBoostVsMigration.isBeforeMigration
        ? "Yes"
        : "No"
      : "",
    escapeCSV(token.boost?.firstBoostVsMigration?.time || ""),
    escapeCSV(token.boost?.firstBoostVsMigration?.timeMs?.toString() || ""),
    escapeCSV(token.launch?.firstSwapDisplay || token.launch?.firstSwapSol?.toString() || ""),
    escapeCSV(token.launch?.firstBuyCreatorFeeDisplay || token.launch?.firstBuyCreatorFeeSol?.toString() || ""),
    escapeCSV(token.launch?.launchNote || ""),
    token.launch?.hasFeeSharingConfig ? "Yes" : token.launch?.hasFeeSharingConfig === false ? "No" : "",
    escapeCSV(token.launch?.launchFeeShareholders || ""),
    escapeCSV(token.launch?.feeShareholders || ""),
  ];
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
