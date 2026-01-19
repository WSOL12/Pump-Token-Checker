import { writeFile, readFile } from "fs/promises";
import "dotenv/config";

interface Order {
  chainId: string;
  tokenAddress: string;
  type: string;
  status: string;
  paymentTimestamp: number;
}

interface Boost {
  chainId: string;
  tokenAddress: string;
  id: string;
  amount: number;
  paymentTimestamp: number;
}

interface DexScreenerResponse {
  orders: Order[];
  boosts: Boost[];
}

interface JupiterTokenInfo {
  id: string;
  graduatedAt: string | null;
  graduatedPool: string | null;
  twitter?: string | null;
  website?: string | null;
  firstPool?: {
    id: string;
    createdAt: string;
  };
  [key: string]: any;
}

interface TokenCheckResult {
  tokenAddress: string;
  hasTokenProfile: boolean;
  order?: Order;
  hasTokenAd: boolean;
  tokenAdOrder?: Order;
  error?: string;
  graduationInfo?: {
    graduatedAt: string | null;
    graduatedAtTimestamp: number | null;
    createdAt: string | null;
    createdAtTimestamp: number | null;
    twitter: string | null;
    website: string | null;
    isApprovedBeforeMigration: boolean | null;
    timeDifferenceMs: number | null;
    timeDifferenceFormatted: string | null;
    creationToMigrationTime?: {
      timeDifferenceMs: number | null;
      timeDifferenceFormatted: string | null;
    };
  };
  tokenAdInfo?: {
    isApprovedBeforeMigration: boolean | null;
    timeDifferenceMs: number | null;
    timeDifferenceFormatted: string | null;
  };
  boostInfo?: {
    hasBoosts: boolean;
    boostCount: number;
    totalAmount: number;
    firstBoost?: {
      id: string;
      amount: number;
      paymentTimestamp: number;
      paymentDate: string;
    };
    firstBoostVsMigration?: {
      isFirstBoostBeforeMigration: boolean | null;
      timeDifferenceMs: number | null;
      timeDifferenceFormatted: string | null;
    };
  };
}

/**
 * Fetch token graduation info from Jupiter API
 */
async function fetchGraduationInfo(tokenAddress: string): Promise<{
  graduatedAt: string | null;
  graduatedAtTimestamp: number | null;
  createdAt: string | null;
  createdAtTimestamp: number | null;
  twitter: string | null;
  website: string | null;
} | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  
  if (!apiKey) {
    // Jupiter API key is optional - return null if not provided
    return null;
  }

  try {
    const url = `https://api.jup.ag/tokens/v2/search?query=${tokenAddress}`;
    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as JupiterTokenInfo[];
    
    if (!data || data.length === 0) {
      return null;
    }

    const tokenInfo = data[0];
    const graduatedAt = tokenInfo.graduatedAt || null;
    const graduatedAtTimestamp = graduatedAt ? new Date(graduatedAt).getTime() : null;
    
    const createdAt = tokenInfo.firstPool?.createdAt || null;
    const createdAtTimestamp = createdAt ? new Date(createdAt).getTime() : null;

    const twitter = tokenInfo.twitter || null;
    const website = tokenInfo.website || null;

    return {
      graduatedAt,
      graduatedAtTimestamp,
      createdAt,
      createdAtTimestamp,
      twitter,
      website,
    };
  } catch (error) {
    // Silently fail - graduation info is optional
    return null;
  }
}

/**
 * Format time difference in human-readable format
 */
function formatTimeDifference(ms: number): string {
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""} ${hours % 24} hour${(hours % 24) !== 1 ? "s" : ""}`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes % 60} minute${(minutes % 60) !== 1 ? "s" : ""}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ${seconds % 60} second${(seconds % 60) !== 1 ? "s" : ""}`;
  } else {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
}

/**
 * Check if a token has a tokenProfile order and compare with migration time
 */
async function checkTokenProfile(
  tokenAddress: string,
  chainId: string = "solana"
): Promise<TokenCheckResult> {
  try {
    const url = `https://api.dexscreener.com/orders/v1/${chainId}/${tokenAddress}`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        tokenAddress,
        hasTokenProfile: false,
        hasTokenAd: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = (await response.json()) as DexScreenerResponse;

    // Check if there's a tokenProfile order with approved status
    const tokenProfileOrder = data.orders?.find(
      (order) => order.type === "tokenProfile" && order.status === "approved"
    );

    // Check if there's a tokenAd order with approved status
    const tokenAdOrder = data.orders?.find(
      (order) => order.type === "tokenAd" && order.status === "approved"
    );

    // Parse boost information
    const boosts = data.boosts || [];
    const hasBoosts = boosts.length > 0;
    let boostInfo: TokenCheckResult["boostInfo"] = undefined;

    if (hasBoosts) {
      // Sort boosts by timestamp (oldest first)
      const sortedBoosts = [...boosts].sort((a, b) => a.paymentTimestamp - b.paymentTimestamp);
      const firstBoost = sortedBoosts[0];
      const totalAmount = boosts.reduce((sum, boost) => sum + boost.amount, 0);

      boostInfo = {
        hasBoosts: true,
        boostCount: boosts.length,
        totalAmount,
        firstBoost: {
          id: firstBoost.id,
          amount: firstBoost.amount,
          paymentTimestamp: firstBoost.paymentTimestamp,
          paymentDate: new Date(firstBoost.paymentTimestamp).toISOString(),
        },
      };
    } else {
      boostInfo = {
        hasBoosts: false,
        boostCount: 0,
        totalAmount: 0,
      };
    }

    let graduationInfo: TokenCheckResult["graduationInfo"] = undefined;
    let tokenAdInfo: TokenCheckResult["tokenAdInfo"] = undefined;

    // If token has approved tokenProfile or tokenAd, fetch graduation info and compare
    const needsGraduationInfo = (tokenProfileOrder && tokenProfileOrder.paymentTimestamp) || 
                                 (tokenAdOrder && tokenAdOrder.paymentTimestamp);
    
    if (needsGraduationInfo) {
      // Small delay to avoid rate limiting on Jupiter API
      await new Promise((resolve) => setTimeout(resolve, 200));
      const gradInfo = await fetchGraduationInfo(tokenAddress);
      
      if (gradInfo && gradInfo.graduatedAtTimestamp) {
        // Process tokenProfile if it exists
        if (tokenProfileOrder && tokenProfileOrder.paymentTimestamp) {
          const paymentTimestamp = tokenProfileOrder.paymentTimestamp;
          const timeDifferenceMs = paymentTimestamp - gradInfo.graduatedAtTimestamp;
          const isApprovedBeforeMigration = timeDifferenceMs < 0;
          
          // Calculate time difference between creation and migration
          let creationToMigrationTime: { timeDifferenceMs: number | null; timeDifferenceFormatted: string | null } | undefined;
          if (gradInfo.createdAtTimestamp && gradInfo.graduatedAtTimestamp) {
            const creationToMigrationMs = gradInfo.graduatedAtTimestamp - gradInfo.createdAtTimestamp;
            creationToMigrationTime = {
              timeDifferenceMs: creationToMigrationMs,
              timeDifferenceFormatted: formatTimeDifference(creationToMigrationMs),
            };
          } else {
            creationToMigrationTime = {
              timeDifferenceMs: null,
              timeDifferenceFormatted: null,
            };
          }
          
          graduationInfo = {
            graduatedAt: gradInfo.graduatedAt,
            graduatedAtTimestamp: gradInfo.graduatedAtTimestamp,
            createdAt: gradInfo.createdAt,
            createdAtTimestamp: gradInfo.createdAtTimestamp,
            twitter: gradInfo.twitter,
            website: gradInfo.website,
            isApprovedBeforeMigration,
            timeDifferenceMs,
            timeDifferenceFormatted: formatTimeDifference(timeDifferenceMs),
            creationToMigrationTime,
          };

          // Compare first boost with migration if boosts exist
          if (boostInfo.hasBoosts && boostInfo.firstBoost) {
            const firstBoostTimeDiff = boostInfo.firstBoost.paymentTimestamp - gradInfo.graduatedAtTimestamp;
            boostInfo.firstBoostVsMigration = {
              isFirstBoostBeforeMigration: firstBoostTimeDiff < 0,
              timeDifferenceMs: firstBoostTimeDiff,
              timeDifferenceFormatted: formatTimeDifference(firstBoostTimeDiff),
            };
          }
        } else {
          // No tokenProfile but we fetched gradInfo, set basic info
          graduationInfo = {
            graduatedAt: gradInfo.graduatedAt,
            graduatedAtTimestamp: gradInfo.graduatedAtTimestamp,
            createdAt: gradInfo.createdAt,
            createdAtTimestamp: gradInfo.createdAtTimestamp,
            twitter: gradInfo.twitter,
            website: gradInfo.website,
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
            creationToMigrationTime: {
              timeDifferenceMs: null,
              timeDifferenceFormatted: null,
            },
          };
        }

        // Process tokenAd if it exists
        if (tokenAdOrder && tokenAdOrder.paymentTimestamp) {
          const tokenAdPaymentTimestamp = tokenAdOrder.paymentTimestamp;
          const tokenAdTimeDifferenceMs = tokenAdPaymentTimestamp - gradInfo.graduatedAtTimestamp;
          const tokenAdIsApprovedBeforeMigration = tokenAdTimeDifferenceMs < 0;
          
          tokenAdInfo = {
            isApprovedBeforeMigration: tokenAdIsApprovedBeforeMigration,
            timeDifferenceMs: tokenAdTimeDifferenceMs,
            timeDifferenceFormatted: formatTimeDifference(tokenAdTimeDifferenceMs),
          };
        }
      } else {
        // No graduation info available
        if (tokenProfileOrder) {
          graduationInfo = {
            graduatedAt: null,
            graduatedAtTimestamp: null,
            createdAt: null,
            createdAtTimestamp: null,
            twitter: null,
            website: null,
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
            creationToMigrationTime: {
              timeDifferenceMs: null,
              timeDifferenceFormatted: null,
            },
          };
        }
        if (tokenAdOrder) {
          tokenAdInfo = {
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
          };
        }
      }
    }

    return {
      tokenAddress,
      hasTokenProfile: !!tokenProfileOrder,
      order: tokenProfileOrder,
      hasTokenAd: !!tokenAdOrder,
      tokenAdOrder: tokenAdOrder,
      graduationInfo,
      tokenAdInfo: tokenAdInfo ?? undefined,
      boostInfo,
    };
  } catch (error) {
    return {
      tokenAddress,
      hasTokenProfile: false,
      hasTokenAd: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Rate limiter class to manage 60 requests per minute
 */
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests = 60;
  private readonly windowMs = 60000; // 1 minute

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // Remove requests older than 1 minute
    this.requests = this.requests.filter((time) => now - time < this.windowMs);
    
    // If we've hit the limit, wait until the oldest request expires
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        // Clean up again after waiting
        const newNow = Date.now();
        this.requests = this.requests.filter((time) => newNow - time < this.windowMs);
      }
    }
    
    // Record this request
    this.requests.push(Date.now());
  }
}

/**
 * Check multiple tokens with parallel processing and rate limiting (60 requests per minute)
 */
async function checkMultipleTokens(
  tokenAddresses: string[],
  chainId: string = "solana"
): Promise<TokenCheckResult[]> {
  const results: TokenCheckResult[] = [];
  const rateLimiter = new RateLimiter();
  const batchSize = 10; // Process 10 tokens in parallel per batch

  // Load existing results
  const approvedMap = await loadExistingApprovedTokens();
  const unapprovedMap = await loadExistingUnapprovedTokens();

  // Filter out already processed tokens
  const tokensToCheck = tokenAddresses.filter((addr) => {
    const trimmed = addr.trim();
    return trimmed && !approvedMap.has(trimmed) && !unapprovedMap.has(trimmed);
  });

  const totalToCheck = tokensToCheck.length;
  const alreadyProcessed = tokenAddresses.length - totalToCheck;

  console.log(`Checking ${tokenAddresses.length} tokens...`);
  if (alreadyProcessed > 0) {
    console.log(`  Skipping ${alreadyProcessed} already processed tokens`);
  }
  console.log(`  Processing ${totalToCheck} new tokens in batches of ${batchSize}\n`);

  // Process tokens in batches
  for (let i = 0; i < tokensToCheck.length; i += batchSize) {
    const batch = tokensToCheck.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(tokensToCheck.length / batchSize);

    console.log(`[Batch ${batchNumber}/${totalBatches}] Processing ${batch.length} tokens...`);

    // Process batch in parallel
    const batchPromises = batch.map(async (tokenAddress) => {
      await rateLimiter.waitIfNeeded();
      return checkTokenProfile(tokenAddress.trim(), chainId);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Save results incrementally
    for (const result of batchResults) {
      if (result.hasTokenProfile) {
        await saveApprovedTokenIncremental(result, approvedMap);
      } else {
        await saveUnapprovedTokenIncremental(result, unapprovedMap);
      }
    }

    // Display batch results
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const globalIndex = i + j + 1 + alreadyProcessed;
      
      console.log(`  [${globalIndex}/${tokenAddresses.length}] ${result.tokenAddress}`);
      
      if (result.hasTokenProfile) {
        const isHighlighted = result.boostInfo?.hasBoosts && 
                              result.graduationInfo?.isApprovedBeforeMigration === true &&
                              result.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true;
        
        if (isHighlighted) {
          console.log(`    ⭐ HIGHLIGHTED: Both boost AND tokenProfile approved BEFORE migration`);
        }
        
        console.log(`    ✓ Has tokenProfile (approved)`);
        if (result.order?.paymentTimestamp) {
          const date = new Date(result.order.paymentTimestamp);
          console.log(`    Payment: ${date.toISOString()}`);
          
          // Show migration comparison if available
          if (result.graduationInfo?.graduatedAtTimestamp) {
            const isBefore = result.graduationInfo.isApprovedBeforeMigration;
            const timeDiff = result.graduationInfo.timeDifferenceFormatted;
            if (isBefore !== null && timeDiff) {
              console.log(`    Migration: ${isBefore ? "BEFORE" : "AFTER"} migration by ${timeDiff}`);
            }
            
            // Show creation to migration time
            if (result.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted) {
              const creationTime = result.graduationInfo.createdAt 
                ? new Date(result.graduationInfo.createdAt).toISOString() 
                : "N/A";
              console.log(`    Created: ${creationTime}`);
              console.log(`    Creation to Migration: ${result.graduationInfo.creationToMigrationTime.timeDifferenceFormatted}`);
            }
          }
        }
        
        // Show boost information
        if (result.boostInfo?.hasBoosts) {
          console.log(`    🚀 Dex Boost: ${result.boostInfo.boostCount} boost(s), Total: ${result.boostInfo.totalAmount}`);
          if (result.boostInfo.firstBoost) {
            console.log(`       First boost: ${result.boostInfo.firstBoost.amount} at ${result.boostInfo.firstBoost.paymentDate}`);
            if (result.boostInfo.firstBoostVsMigration) {
              const isBefore = result.boostInfo.firstBoostVsMigration.isFirstBoostBeforeMigration;
              const timeDiff = result.boostInfo.firstBoostVsMigration.timeDifferenceFormatted;
              if (isBefore !== null && timeDiff) {
                console.log(`       First boost ${isBefore ? "BEFORE" : "AFTER"} migration by ${timeDiff}`);
              }
            }
          }
        } else {
          console.log(`    🚀 Dex Boost: None`);
        }
        
        console.log(`    💾 Saved to approved_tokens.json`);
      } else {
        console.log(`    ✗ No tokenProfile found`);
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
        console.log(`    💾 Saved to unapproved_tokens.json`);
      }
    }

    console.log();
  }

  return results;
}

/**
 * Load token addresses from a file
 */
async function loadTokenAddressesFromFile(
  filename: string = "tokens.txt"
): Promise<string[]> {
  try {
    const content = await readFile(filename, "utf-8");
    const addresses = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")); // Filter out empty lines and comments
    
    return addresses;
  } catch (error) {
    console.error(`Error reading file ${filename}:`, error);
    return [];
  }
}

/**
 * Load existing approved tokens from JSON file
 */
async function loadExistingApprovedTokens(
  filename: string = "approved_tokens.json"
): Promise<Map<string, any>> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);
    const tokenMap = new Map<string, any>();
    
    if (data.tokens && Array.isArray(data.tokens)) {
      for (const token of data.tokens) {
        tokenMap.set(token.tokenAddress, token);
      }
    }
    
    return tokenMap;
  } catch (error) {
    // File doesn't exist or is invalid - return empty map
    return new Map();
  }
}

/**
 * Load existing unapproved tokens from JSON file
 */
async function loadExistingUnapprovedTokens(
  filename: string = "unapproved_tokens.json"
): Promise<Map<string, any>> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);
    const tokenMap = new Map<string, any>();
    
    if (data.tokens && Array.isArray(data.tokens)) {
      for (const token of data.tokens) {
        tokenMap.set(token.tokenAddress, token);
      }
    }
    
    return tokenMap;
  } catch (error) {
    // File doesn't exist or is invalid - return empty map
    return new Map();
  }
}

/**
 * Save approved token incrementally (append to existing)
 */
async function saveApprovedTokenIncremental(
  result: TokenCheckResult,
  approvedMap: Map<string, any>,
  filename: string = "approved_tokens.json"
): Promise<void> {
  if (!result.hasTokenProfile || !result.order) {
    return;
  }

  // Check if this is a highlighted token (boost + tokenProfile BOTH approved before migration)
  const isHighlighted = result.boostInfo?.hasBoosts && 
                        result.graduationInfo?.isApprovedBeforeMigration === true &&
                        result.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true;

  const tokenData: any = {
    tokenAddress: result.tokenAddress,
    gmgnUrl: `https://gmgn.ai/sol/token/${result.tokenAddress}`,
    highlighted: isHighlighted,
    migration: result.graduationInfo ? {
      createdAt: result.graduationInfo.createdAt,
      graduatedAt: result.graduationInfo.graduatedAt,
      twitter: result.graduationInfo.twitter,
      website: result.graduationInfo.website,
      isApprovedBeforeMigration: result.graduationInfo.isApprovedBeforeMigration,
      approvedVsMigrationMs: result.graduationInfo.timeDifferenceMs,
      approvedVsMigration: result.graduationInfo.timeDifferenceFormatted,
      creationToMigrationMs: result.graduationInfo.creationToMigrationTime?.timeDifferenceMs ?? null,
      creationToMigration: result.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted ?? null,
    } : null,
    tokenAd: result.hasTokenAd ? {
      hasTokenAd: true,
      paymentTimestamp: result.tokenAdOrder?.paymentTimestamp ?? null,
      paymentDate: result.tokenAdOrder?.paymentTimestamp 
        ? new Date(result.tokenAdOrder.paymentTimestamp).toISOString() 
        : null,
      isApprovedBeforeMigration: result.tokenAdInfo?.isApprovedBeforeMigration ?? null,
      approvedVsMigrationMs: result.tokenAdInfo?.timeDifferenceMs ?? null,
      approvedVsMigration: result.tokenAdInfo?.timeDifferenceFormatted ?? null,
    } : null,
    boost: result.boostInfo ? {
      hasBoosts: result.boostInfo.hasBoosts,
      count: result.boostInfo.boostCount,
      totalAmount: result.boostInfo.totalAmount,
      firstBoost: result.boostInfo.firstBoost ? {
        amount: result.boostInfo.firstBoost.amount,
        date: new Date(result.boostInfo.firstBoost.paymentTimestamp).toISOString(),
      } : null,
      firstBoostVsMigration: result.boostInfo.firstBoostVsMigration ? {
        isBeforeMigration: result.boostInfo.firstBoostVsMigration.isFirstBoostBeforeMigration,
        timeMs: result.boostInfo.firstBoostVsMigration.timeDifferenceMs,
        time: result.boostInfo.firstBoostVsMigration.timeDifferenceFormatted,
      } : null,
    } : null,
  };

  approvedMap.set(result.tokenAddress, tokenData);

  // Sort tokens: highlighted first, then by token address
  const sortedTokens = Array.from(approvedMap.values()).sort((a, b) => {
    if (a.highlighted && !b.highlighted) return -1;
    if (!a.highlighted && b.highlighted) return 1;
    return a.tokenAddress.localeCompare(b.tokenAddress);
  });

  const output = {
    totalApproved: approvedMap.size,
    highlightedCount: sortedTokens.filter((t: any) => t.highlighted).length,
    checkedAt: new Date().toISOString(),
    tokens: sortedTokens,
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * Export approved tokens to CSV format with serial index
 */
async function exportApprovedTokensToCSV(
  filename: string = "approved_tokens.json",
  csvFilename: string = "approved_tokens.csv"
): Promise<void> {
  try {
    const content = await readFile(filename, "utf-8");
    const data = JSON.parse(content);
    
    if (!data.tokens || !Array.isArray(data.tokens)) {
      console.log("No tokens found in JSON file");
      return;
    }

    // CSV Headers
    const headers = [
      "Index",
      "Token Address",
      "GMGN URL",
      "Twitter URL",
      "Website URL",
      "Highlighted",
      "Created Date",
      "Graduated Date",
      "Creation to Migration Time",
      "Creation to Migration Time (ms)",
      "TokenProfile Approved Before Migration",
      "TokenProfile vs Migration Time",
      "TokenProfile vs Migration Time (ms)",
      "Has TokenAd",
      "TokenAd Payment Date",
      "TokenAd Approved Before Migration",
      "TokenAd vs Migration Time",
      "TokenAd vs Migration Time (ms)",
      "Has Boosts",
      "Boost Count",
      "Total Boost Amount",
      "First Boost Amount",
      "First Boost Date",
      "First Boost Before Migration",
      "First Boost vs Migration Time",
      "First Boost vs Migration Time (ms)"
    ];

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

    // Build CSV rows
    const rows: string[] = [headers.map(h => escapeCSV(h)).join(",")];
    
    data.tokens.forEach((token: any, index: number) => {
      const row = [
        (index + 1).toString(), // Serial index
        escapeCSV(token.tokenAddress || ""),
        escapeCSV(token.gmgnUrl || ""),
        escapeCSV(token.migration?.twitter || ""),
        escapeCSV(token.migration?.website || ""),
        token.highlighted ? "Yes" : "No",
        escapeCSV(token.migration?.createdAt || ""),
        escapeCSV(token.migration?.graduatedAt || ""),
        escapeCSV(token.migration?.creationToMigration || ""),
        escapeCSV(token.migration?.creationToMigrationMs?.toString() || ""),
        token.migration?.isApprovedBeforeMigration !== null 
          ? (token.migration.isApprovedBeforeMigration ? "Yes" : "No")
          : "",
        escapeCSV(token.migration?.approvedVsMigration || ""),
        escapeCSV(token.migration?.approvedVsMigrationMs?.toString() || ""),
        token.boost?.hasBoosts ? "Yes" : "No",
        escapeCSV(token.boost?.count?.toString() || "0"),
        escapeCSV(token.boost?.totalAmount?.toString() || "0"),
        escapeCSV(token.boost?.firstBoost?.amount?.toString() || ""),
        escapeCSV(token.boost?.firstBoost?.date || ""),
        (token.boost?.firstBoostVsMigration && token.boost.firstBoostVsMigration.isBeforeMigration !== null)
          ? (token.boost.firstBoostVsMigration.isBeforeMigration ? "Yes" : "No")
          : "",
        escapeCSV(token.boost?.firstBoostVsMigration?.time || ""),
        escapeCSV(token.boost?.firstBoostVsMigration?.timeMs?.toString() || "")
      ];
      
      rows.push(row.join(","));
    });

    const csvContent = rows.join("\n");
    await writeFile(csvFilename, csvContent, "utf-8");
    console.log(`\n✓ Exported ${data.tokens.length} token(s) to ${csvFilename}`);
  } catch (error) {
    console.error(`\n❌ Error exporting to CSV: ${error}`);
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
  }
}

/**
 * Save unapproved token incrementally (append to existing)
 */
async function saveUnapprovedTokenIncremental(
  result: TokenCheckResult,
  unapprovedMap: Map<string, any>,
  filename: string = "unapproved_tokens.json"
): Promise<void> {
  if (result.hasTokenProfile) {
    return;
  }

  const tokenData = {
    tokenAddress: result.tokenAddress,
    gmgnUrl: `https://gmgn.ai/sol/token/${result.tokenAddress}`,
    error: result.error || null,
  };

  unapprovedMap.set(result.tokenAddress, tokenData);

  const output = {
    totalUnapproved: unapprovedMap.size,
    checkedAt: new Date().toISOString(),
    tokens: Array.from(unapprovedMap.values()),
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * Save approved tokenProfile addresses to JSON file
 */
async function saveApprovedTokens(
  results: TokenCheckResult[],
  filename: string = "approved_tokens.json"
): Promise<void> {
  const approvedTokens = results
    .filter((r) => r.hasTokenProfile && r.order)
    .map((r) => {
      const isHighlighted = r.boostInfo?.hasBoosts && 
                            r.graduationInfo?.isApprovedBeforeMigration === true &&
                            r.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true;
      
      return {
        tokenAddress: r.tokenAddress,
        gmgnUrl: `https://gmgn.ai/sol/token/${r.tokenAddress}`,
        highlighted: isHighlighted,
        migration: r.graduationInfo ? {
          createdAt: r.graduationInfo.createdAt,
          graduatedAt: r.graduationInfo.graduatedAt,
          twitter: r.graduationInfo.twitter,
          website: r.graduationInfo.website,
          isApprovedBeforeMigration: r.graduationInfo.isApprovedBeforeMigration,
          approvedVsMigrationMs: r.graduationInfo.timeDifferenceMs,
          approvedVsMigration: r.graduationInfo.timeDifferenceFormatted,
          creationToMigrationMs: r.graduationInfo.creationToMigrationTime?.timeDifferenceMs ?? null,
          creationToMigration: r.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted ?? null,
        } : null,
        tokenAd: r.hasTokenAd ? {
          hasTokenAd: true,
          paymentTimestamp: r.tokenAdOrder?.paymentTimestamp ?? null,
          paymentDate: r.tokenAdOrder?.paymentTimestamp 
            ? new Date(r.tokenAdOrder.paymentTimestamp).toISOString() 
            : null,
          isApprovedBeforeMigration: r.tokenAdInfo?.isApprovedBeforeMigration ?? null,
          approvedVsMigrationMs: r.tokenAdInfo?.timeDifferenceMs ?? null,
          approvedVsMigration: r.tokenAdInfo?.timeDifferenceFormatted ?? null,
        } : null,
        boost: r.boostInfo ? {
          hasBoosts: r.boostInfo.hasBoosts,
          count: r.boostInfo.boostCount,
          totalAmount: r.boostInfo.totalAmount,
          firstBoost: r.boostInfo.firstBoost ? {
            amount: r.boostInfo.firstBoost.amount,
            date: new Date(r.boostInfo.firstBoost.paymentTimestamp).toISOString(),
          } : null,
          firstBoostVsMigration: r.boostInfo.firstBoostVsMigration ? {
            isBeforeMigration: r.boostInfo.firstBoostVsMigration.isFirstBoostBeforeMigration,
            timeMs: r.boostInfo.firstBoostVsMigration.timeDifferenceMs,
            time: r.boostInfo.firstBoostVsMigration.timeDifferenceFormatted,
          } : null,
        } : null,
      };
    });

  const output = {
    totalApproved: approvedTokens.length,
    checkedAt: new Date().toISOString(),
    tokens: approvedTokens,
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n✓ Saved ${approvedTokens.length} approved token(s) to ${filename}`);
}

/**
 * Save unapproved token addresses to JSON file
 */
async function saveUnapprovedTokens(
  results: TokenCheckResult[],
  filename: string = "unapproved_tokens.json"
): Promise<void> {
  const unapprovedTokens = results
    .filter((r) => !r.hasTokenProfile)
    .map((r) => ({
      tokenAddress: r.tokenAddress,
      gmgnUrl: `https://gmgn.ai/sol/token/${r.tokenAddress}`,
      error: r.error || null,
    }));

  const output = {
    totalUnapproved: unapprovedTokens.length,
    checkedAt: new Date().toISOString(),
    tokens: unapprovedTokens,
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
  console.log(`✓ Saved ${unapprovedTokens.length} unapproved token(s) to ${filename}`);
}

/**
 * Main function - Load token addresses from tokens.txt file
 */
async function main() {
  // Load token addresses from file (one address per line)
  const tokenAddresses = await loadTokenAddressesFromFile("tokens.txt");

  // Alternative: Use hardcoded array for small lists
  // const tokenAddresses: string[] = [
  //   "GD2oU2pXzc27ny8rVj7Nb3qZWBm3ouduD18BEV6Vpump",
  //   "A55XjvzRU4KtR3Lzys8PpLZQvPojPqvnv5bJVHMYy3Jv",
  // ];

  if (tokenAddresses.length === 0) {
    console.log("No token addresses found. Please create a tokens.txt file with one address per line.");
    console.log("You can add comments by starting a line with #");
    console.log("\nTo fetch tokens automatically, run: npm run fetch-tokens");
    return;
  }

  console.log(`Loaded ${tokenAddresses.length} token address(es) from tokens.txt\n`);

  const results = await checkMultipleTokens(tokenAddresses);

  // Summary
  console.log("\n=== SUMMARY ===");
  const withTokenProfile = results.filter((r) => r.hasTokenProfile);
  const withoutTokenProfile = results.filter((r) => !r.hasTokenProfile);
  const withErrors = results.filter((r) => r.error);

  console.log(`Total checked: ${results.length}`);
  console.log(`Has tokenProfile: ${withTokenProfile.length}`);
  console.log(`No tokenProfile: ${withoutTokenProfile.length}`);
  if (withErrors.length > 0) {
    console.log(`Errors: ${withErrors.length}`);
  }

  // Note: Results are already saved incrementally during processing
  // These final saves are just for summary/consistency
  console.log("\n=== Final Summary ===");
  
  if (withTokenProfile.length > 0) {
    // Count highlighted tokens (boost + tokenProfile BOTH approved before migration)
    const highlightedTokens = results.filter(
      (r) => r.hasTokenProfile && 
             r.boostInfo?.hasBoosts && 
             r.graduationInfo?.isApprovedBeforeMigration === true &&
             r.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true
    );
    
    // Count tokens with boosts
    const tokensWithBoosts = results.filter(
      (r) => r.hasTokenProfile && r.boostInfo?.hasBoosts
    );
    
    console.log(`\n✓ ${withTokenProfile.length} approved token(s) saved to approved_tokens.json`);
    if (tokensWithBoosts.length > 0) {
      console.log(`  🚀 ${tokensWithBoosts.length} token(s) with dex boost(s)`);
    }
    if (highlightedTokens.length > 0) {
      console.log(`  ⭐ ${highlightedTokens.length} HIGHLIGHTED token(s): Both boost AND tokenProfile approved BEFORE migration`);
    }
  } else {
    console.log("\nNo tokens with approved tokenProfile found.");
  }
  
  // Always try to export CSV if JSON file exists (even if no new tokens in this run)
  console.log("\n=== Exporting to CSV ===");
  await exportApprovedTokensToCSV();

  if (withoutTokenProfile.length > 0) {
    console.log(`✓ ${withoutTokenProfile.length} unapproved token(s) saved to unapproved_tokens.json`);
  }
}

// Run the main function
main().catch(console.error);
