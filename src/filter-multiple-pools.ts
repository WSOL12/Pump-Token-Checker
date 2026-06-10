import { writeFile, readFile } from "fs/promises";
import "dotenv/config";
import {
  APPROVED_TOKENS_CSV,
  APPROVED_TOKENS_JSON,
  TOKENS_WITH_MULTIPLE_POOLS_JSON,
  ensureDataDir,
} from "./paths.js";

interface PoolResult {
  tokenAddress: string;
  poolCount: number;
}

interface BitqueryPoolResponse {
  data?: {
    Solana?: {
      DEXPools?: Array<{
        Pool?: {
          Market?: {
            MarketAddress?: string;
            QuoteCurrency?: {
              Symbol?: string;
              Name?: string;
              MintAddress?: string;
            };
          };
          Dex?: {
            ProtocolFamily?: string;
          };
          Quote?: {
            PostAmount?: string;
            PostAmountInUSD?: string;
          };
        };
      }>;
    };
  };
}

/**
 * Fetch pool count for a batch of tokens (up to 10 tokens per request)
 */
async function fetchPoolCountBatch(tokenAddresses: string[]): Promise<Map<string, PoolResult>> {
  const apiKey = process.env.BITQUERY_API_KEY;
  const resultMap = new Map<string, PoolResult>();
  
  if (!apiKey) {
    console.error("❌ BITQUERY_API_KEY not found in environment variables.");
    console.error("   Please create a .env file with: BITQUERY_API_KEY=your_api_key");
    return resultMap;
  }

  if (tokenAddresses.length === 0) {
    return resultMap;
  }

  // Batch concurrency (10 parallel requests at a time)
  const batchSize = 10;
  
  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize);
    
    console.log(`  📊 Fetching pool counts for batch ${Math.floor(i / batchSize) + 1} (${batch.length} tokens)...`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (tokenAddress) => {
      try {
        const query = `query ($token: String) {
          Solana {
            DEXPools(
              orderBy: {descendingByField: "Pool_Quote_PostAmountInUSD_maximum"}
              where: {Pool: {Market: {BaseCurrency: {MintAddress: {is: $token}}}}}
            ) {
              Pool {
                Market {
                  QuoteCurrency {
                    Symbol
                    Name
                    MintAddress
                  }
                  MarketAddress
                }
                Dex {
                  ProtocolFamily
                }
                Base {
                  PostAmount(maximum: Block_Slot)
                  PostAmountInUSD(maximum: Block_Slot)
                }
                Quote {
                  PostAmount(maximum: Block_Slot)
                  PostAmountInUSD(maximum: Block_Slot)
                }
              }
            }
          }
        }`;

        const response = await fetch("https://streaming.bitquery.io/eap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            variables: { token: tokenAddress },
          }),
        });

        // Read response body once as text first, then parse (prevents "Body has already been read")
        const responseText = await response.text();

        if (!response.ok) {
          console.error(
            `    ❌ Error for ${tokenAddress}: ${response.status} ${response.statusText} - ${responseText.substring(0, 200)}`
          );
          return { tokenAddress, poolCount: 0 };
        }

        let data: BitqueryPoolResponse;
        try {
          data = JSON.parse(responseText) as BitqueryPoolResponse;
        } catch {
          console.error(`    ❌ Error parsing JSON for ${tokenAddress}: ${responseText.substring(0, 200)}`);
          return { tokenAddress, poolCount: 0 };
        }

        if (!data.data?.Solana?.DEXPools) {
          return {
            tokenAddress,
            poolCount: 0,
          };
        }

        const poolCount = data.data.Solana.DEXPools.filter(p => p.Pool).length;

        return {
          tokenAddress,
          poolCount,
        };
      } catch (error) {
        console.error(`    ❌ Error fetching pools for ${tokenAddress}:`, error instanceof Error ? error.message : String(error));
        return {
          tokenAddress,
          poolCount: 0,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    
    for (const result of batchResults) {
      resultMap.set(result.tokenAddress, result);
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < tokenAddresses.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return resultMap;
}

/**
 * Read approved tokens JSON file (input)
 */
async function loadApprovedTokensJson(
  filename: string = APPROVED_TOKENS_JSON
): Promise<{ checkedAt?: string; totalApproved?: number; highlightedCount?: number; tokens: any[] }> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);

    if (!data || !Array.isArray(data.tokens)) {
      throw new Error(`${APPROVED_TOKENS_JSON} is missing \`tokens\` array`);
    }

    return data;
  } catch (error) {
    console.error(`❌ Error reading ${filename}:`, error instanceof Error ? error.message : String(error));
    return { tokens: [] };
  }
}

/**
 * Export results to CSV
 */
async function exportApprovedTokensToCSV(
  approvedJson: { tokens: any[] },
  csvFilename: string = APPROVED_TOKENS_CSV
): Promise<void> {
  // Helper function to escape CSV values
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // CSV Headers
  const headers = [
    "Index",
    "Token Address",
    "GMGN URL",
    "Pool Count",
    "Twitter URL",
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
  ];

  // Build CSV rows
  const rows: string[] = [headers.map(h => escapeCSV(h)).join(",")];
  
  approvedJson.tokens.forEach((token: any, index: number) => {
    const row = [
      (index + 1).toString(),
      escapeCSV(token.tokenAddress || ""),
      escapeCSV(token.gmgnUrl || ""),
      escapeCSV(token.poolCount?.toString() || ""),
      escapeCSV(token.migration?.twitter || ""),
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
      (token.migration && token.migration.isApprovedBeforeMigration !== null)
        ? (token.migration.isApprovedBeforeMigration ? "Yes" : "No")
        : "",
      escapeCSV(token.migration?.approvedVsMigration || ""),
      escapeCSV(token.migration?.approvedVsMigrationMs?.toString() || ""),
      token.tokenAd?.hasTokenAd ? "Yes" : "No",
      escapeCSV(token.tokenAd?.adCount?.toString() || "0"),
      escapeCSV(token.tokenAd?.paymentDate || ""),
      (token.tokenAd && token.tokenAd.isApprovedBeforeMigration !== null)
        ? (token.tokenAd.isApprovedBeforeMigration ? "Yes" : "No")
        : "",
      escapeCSV(token.tokenAd?.approvedVsMigration || ""),
      escapeCSV(token.tokenAd?.approvedVsMigrationMs?.toString() || ""),
      token.communityTakeover?.hasCommunityTakeover ? "Yes" : "No",
      escapeCSV(token.communityTakeover?.takeoverCount?.toString() || "0"),
      escapeCSV(token.communityTakeover?.paymentDate || ""),
      (token.communityTakeover && token.communityTakeover.isApprovedBeforeMigration !== null)
        ? (token.communityTakeover.isApprovedBeforeMigration ? "Yes" : "No")
        : "",
      escapeCSV(token.communityTakeover?.approvedVsMigration || ""),
      escapeCSV(token.communityTakeover?.approvedVsMigrationMs?.toString() || ""),
      token.boost?.hasBoosts ? "Yes" : "No",
      escapeCSV(token.boost?.count?.toString() || "0"),
      escapeCSV(token.boost?.totalAmount?.toString() || "0"),
      escapeCSV(token.boost?.firstBoost?.amount?.toString() || ""),
      escapeCSV(token.boost?.firstBoost?.date || ""),
      (token.boost?.firstBoostVsMigration && token.boost.firstBoostVsMigration.isBeforeMigration !== null)
        ? (token.boost.firstBoostVsMigration.isBeforeMigration ? "Yes" : "No")
        : "",
      escapeCSV(token.boost?.firstBoostVsMigration?.time || ""),
      escapeCSV(token.boost?.firstBoostVsMigration?.timeMs?.toString() || ""),
      escapeCSV(token.launch?.firstSwapSol?.toString() || ""),
      escapeCSV(token.launch?.firstBuyCreatorFeeSol?.toString() || ""),
    ];
    rows.push(row.join(","));
  });

  const csvContent = rows.join("\n");
  await writeFile(csvFilename, csvContent, "utf-8");
  console.log(`✓ CSV exported to ${csvFilename}`);
}

/**
 * Main function
 */
async function main() {
  await ensureDataDir();

  console.log(`🔍 Adding pool counts to ${APPROVED_TOKENS_JSON} and regenerating ${APPROVED_TOKENS_CSV}...\n`);

  const approvedJson = await loadApprovedTokensJson();
  if (!approvedJson.tokens || approvedJson.tokens.length === 0) {
    console.log(`❌ No tokens found in ${APPROVED_TOKENS_JSON}`);
    return;
  }

  const tokenAddresses = approvedJson.tokens
    .map((t: any) => String(t.tokenAddress || "").trim())
    .filter((t: string) => t.length > 0);

  console.log(`✓ Loaded ${tokenAddresses.length} token(s) from ${APPROVED_TOKENS_JSON}\n`);

  console.log(`📊 Checking pool counts for ${tokenAddresses.length} token(s)...\n`);

  // Fetch pool counts in batches
  const poolResults = await fetchPoolCountBatch(tokenAddresses);

  // Add poolCount into approved JSON tokens (preserve original order)
  for (const token of approvedJson.tokens) {
    const addr = String(token.tokenAddress || "").trim();
    const poolCount = poolResults.get(addr)?.poolCount ?? 0;
    token.poolCount = poolCount;
  }

  await writeFile(APPROVED_TOKENS_JSON, JSON.stringify(approvedJson, null, 2), "utf-8");
  console.log(`✓ Updated ${APPROVED_TOKENS_JSON} (added poolCount)`);

  await exportApprovedTokensToCSV(approvedJson, APPROVED_TOKENS_CSV);

  // Also write a small helper file for “multiple pools” filtering
  const multiplePoolsOnly = approvedJson.tokens
    .filter((t: any) => (t.poolCount ?? 0) > 1)
    .map((t: any) => ({ tokenAddress: t.tokenAddress, poolCount: t.poolCount }))
    .sort((a: any, b: any) => (b.poolCount ?? 0) - (a.poolCount ?? 0));

  await writeFile(
    "tokens_with_multiple_pools.json",
    JSON.stringify(
      {
        totalChecked: approvedJson.tokens.length,
        tokensWithMultiplePools: multiplePoolsOnly.length,
        checkedAt: new Date().toISOString(),
        tokens: multiplePoolsOnly,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`✓ Saved ${TOKENS_WITH_MULTIPLE_POOLS_JSON}`);

  console.log("\n=== SUMMARY ===");
  console.log(`Total tokens checked: ${approvedJson.tokens.length}`);
  console.log(`Tokens with multiple pools (>1): ${multiplePoolsOnly.length}`);
}

// Run the main function
main().catch(console.error);
