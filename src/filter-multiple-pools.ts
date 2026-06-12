import { writeFile, readFile } from "fs/promises";
import "dotenv/config";
import {
  ALL_TOKENS_CSV,
  ALL_TOKENS_JSON,
  TOKENS_WITH_MULTIPLE_POOLS_JSON,
  ensureDataDir,
} from "./paths.js";
import { exportTokensJsonToCSV } from "./tokens-csv.js";

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
  filename: string = ALL_TOKENS_JSON
): Promise<{ checkedAt?: string; totalApproved?: number; highlightedCount?: number; tokens: any[] }> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);

    if (!data || !Array.isArray(data.tokens)) {
      throw new Error(`${ALL_TOKENS_JSON} is missing \`tokens\` array`);
    }

    return data;
  } catch (error) {
    console.error(`❌ Error reading ${filename}:`, error instanceof Error ? error.message : String(error));
    return { tokens: [] };
  }
}

/**
 * Main function
 */
async function main() {
  await ensureDataDir();

  console.log(`🔍 Adding pool counts to ${ALL_TOKENS_JSON} and regenerating ${ALL_TOKENS_CSV}...\n`);

  const approvedJson = await loadApprovedTokensJson();
  if (!approvedJson.tokens || approvedJson.tokens.length === 0) {
    console.log(`❌ No tokens found in ${ALL_TOKENS_JSON}`);
    return;
  }

  const tokenAddresses = approvedJson.tokens
    .map((t: any) => String(t.tokenAddress || "").trim())
    .filter((t: string) => t.length > 0);

  console.log(`✓ Loaded ${tokenAddresses.length} token(s) from ${ALL_TOKENS_JSON}\n`);

  console.log(`📊 Checking pool counts for ${tokenAddresses.length} token(s)...\n`);

  // Fetch pool counts in batches
  const poolResults = await fetchPoolCountBatch(tokenAddresses);

  // Add poolCount into approved JSON tokens (preserve original order)
  for (const token of approvedJson.tokens) {
    const addr = String(token.tokenAddress || "").trim();
    const poolCount = poolResults.get(addr)?.poolCount ?? 0;
    token.poolCount = poolCount;
  }

  await writeFile(ALL_TOKENS_JSON, JSON.stringify(approvedJson, null, 2), "utf-8");
  console.log(`✓ Updated ${ALL_TOKENS_JSON} (added poolCount)`);

  await exportTokensJsonToCSV(approvedJson, ALL_TOKENS_CSV);

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
