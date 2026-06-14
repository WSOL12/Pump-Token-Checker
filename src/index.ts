import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import {
  ALL_TOKENS_JSON,
  ensureDataDir,
} from "./paths.js";
import {
  extractDomainFromWebsite,
  fetchWebsiteDetails,
  type WebsiteDetails,
} from "./website-info.js";
import { exportAllTokensToCSV } from "./tokens-csv.js";
import {
  fetchFirstBuyInfo,
  HELIUS_RPC_DELAY_MS,
  toLaunchJson,
  type FirstBuyInfo,
} from "./launch-tx.js";

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
  telegram?: string | null;
  website?: string | null;
  organicScore?: number | null;
  organicScoreLabel?: string | null;
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
  hasCommunityTakeover: boolean;
  communityTakeoverOrder?: Order;
  error?: string;
  graduationInfo?: {
    graduatedAt: string | null;
    graduatedAtTimestamp: number | null;
    createdAt: string | null;
    createdAtTimestamp: number | null;
    twitter: string | null;
    telegram: string | null;
    website: string | null;
    organicScore: number | null;
    organicScoreLabel: string | null;
    isApprovedBeforeMigration: boolean | null;
    timeDifferenceMs: number | null;
    timeDifferenceFormatted: string | null;
    creationToMigrationTime?: {
      timeDifferenceMs: number | null;
      timeDifferenceFormatted: string | null;
    };
    websiteDetails?: WebsiteDetails | null;
  };
  tokenAdInfo?: {
    adCount: number;
    isApprovedBeforeMigration: boolean | null;
    timeDifferenceMs: number | null;
    timeDifferenceFormatted: string | null;
  };
  communityTakeoverInfo?: {
    takeoverCount: number;
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
  launchInfo?: FirstBuyInfo | null;
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
  telegram: string | null;
  website: string | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
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
    const telegram = tokenInfo.telegram || null;
    const website = tokenInfo.website || null;
    const organicScore = tokenInfo.organicScore ?? null;
    const organicScoreLabel = tokenInfo.organicScoreLabel || null;

    return {
      graduatedAt,
      graduatedAtTimestamp,
      createdAt,
      createdAtTimestamp,
      twitter,
      telegram,
      website,
      organicScore,
      organicScoreLabel,
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
export async function checkTokenProfile(
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
        hasCommunityTakeover: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = (await response.json()) as DexScreenerResponse;

    // Check if there's a tokenProfile order with approved status
    const tokenProfileOrder = data.orders?.find(
      (order) => order.type === "tokenProfile" && order.status === "approved"
    );

    // Find all approved tokenAd orders and get the first one (earliest)
    const tokenAdOrders = data.orders?.filter(
      (order) => order.type === "tokenAd" && order.status === "approved"
    ) || [];
    const hasTokenAd = tokenAdOrders.length > 0;
    // Sort by timestamp (oldest first) and get the first one
    const firstTokenAdOrder = hasTokenAd 
      ? [...tokenAdOrders].sort((a, b) => a.paymentTimestamp - b.paymentTimestamp)[0]
      : undefined;

    // Find all approved communityTakeover orders and get the first one (earliest)
    const communityTakeoverOrders = data.orders?.filter(
      (order) => order.type === "communityTakeover" && order.status === "approved"
    ) || [];
    const hasCommunityTakeover = communityTakeoverOrders.length > 0;
    // Sort by timestamp (oldest first) and get the first one
    const firstCommunityTakeoverOrder = hasCommunityTakeover 
      ? [...communityTakeoverOrders].sort((a, b) => a.paymentTimestamp - b.paymentTimestamp)[0]
      : undefined;

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
    let communityTakeoverInfo: TokenCheckResult["communityTakeoverInfo"] = undefined;

    // Always fetch Jupiter for every token (organic score, dates, socials)
    await new Promise((resolve) => setTimeout(resolve, 200));
    const gradInfo = await fetchGraduationInfo(tokenAddress);

    if (gradInfo) {
      let creationToMigrationTime: {
        timeDifferenceMs: number | null;
        timeDifferenceFormatted: string | null;
      };
      if (gradInfo.createdAtTimestamp && gradInfo.graduatedAtTimestamp) {
        const creationToMigrationMs =
          gradInfo.graduatedAtTimestamp - gradInfo.createdAtTimestamp;
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

      const graduatedAtTimestamp = gradInfo.graduatedAtTimestamp;

      if (tokenProfileOrder?.paymentTimestamp && graduatedAtTimestamp) {
        const timeDifferenceMs =
          tokenProfileOrder.paymentTimestamp - graduatedAtTimestamp;
        graduationInfo = {
          graduatedAt: gradInfo.graduatedAt,
          graduatedAtTimestamp,
          createdAt: gradInfo.createdAt,
          createdAtTimestamp: gradInfo.createdAtTimestamp,
          twitter: gradInfo.twitter,
          telegram: gradInfo.telegram,
          website: gradInfo.website,
          organicScore: gradInfo.organicScore,
          organicScoreLabel: gradInfo.organicScoreLabel,
          isApprovedBeforeMigration: timeDifferenceMs < 0,
          timeDifferenceMs,
          timeDifferenceFormatted: formatTimeDifference(timeDifferenceMs),
          creationToMigrationTime,
        };
      } else {
        graduationInfo = {
          graduatedAt: gradInfo.graduatedAt,
          graduatedAtTimestamp,
          createdAt: gradInfo.createdAt,
          createdAtTimestamp: gradInfo.createdAtTimestamp,
          twitter: gradInfo.twitter,
          telegram: gradInfo.telegram,
          website: gradInfo.website,
          organicScore: gradInfo.organicScore,
          organicScoreLabel: gradInfo.organicScoreLabel,
          isApprovedBeforeMigration: null,
          timeDifferenceMs: null,
          timeDifferenceFormatted: null,
          creationToMigrationTime,
        };
      }

      if (boostInfo.hasBoosts && boostInfo.firstBoost && graduatedAtTimestamp) {
        const firstBoostTimeDiff =
          boostInfo.firstBoost.paymentTimestamp - graduatedAtTimestamp;
        boostInfo.firstBoostVsMigration = {
          isFirstBoostBeforeMigration: firstBoostTimeDiff < 0,
          timeDifferenceMs: firstBoostTimeDiff,
          timeDifferenceFormatted: formatTimeDifference(firstBoostTimeDiff),
        };
      }

      if (firstTokenAdOrder?.paymentTimestamp && graduatedAtTimestamp) {
        const tokenAdTimeDifferenceMs =
          firstTokenAdOrder.paymentTimestamp - graduatedAtTimestamp;
        tokenAdInfo = {
          adCount: tokenAdOrders.length,
          isApprovedBeforeMigration: tokenAdTimeDifferenceMs < 0,
          timeDifferenceMs: tokenAdTimeDifferenceMs,
          timeDifferenceFormatted: formatTimeDifference(tokenAdTimeDifferenceMs),
        };
      } else if (hasTokenAd && firstTokenAdOrder) {
        tokenAdInfo = {
          adCount: tokenAdOrders.length,
          isApprovedBeforeMigration: null,
          timeDifferenceMs: null,
          timeDifferenceFormatted: null,
        };
      }

      if (firstCommunityTakeoverOrder?.paymentTimestamp && graduatedAtTimestamp) {
        const communityTakeoverTimeDifferenceMs =
          firstCommunityTakeoverOrder.paymentTimestamp - graduatedAtTimestamp;
        communityTakeoverInfo = {
          takeoverCount: communityTakeoverOrders.length,
          isApprovedBeforeMigration: communityTakeoverTimeDifferenceMs < 0,
          timeDifferenceMs: communityTakeoverTimeDifferenceMs,
          timeDifferenceFormatted: formatTimeDifference(communityTakeoverTimeDifferenceMs),
        };
      } else if (hasCommunityTakeover && firstCommunityTakeoverOrder) {
        communityTakeoverInfo = {
          takeoverCount: communityTakeoverOrders.length,
          isApprovedBeforeMigration: null,
          timeDifferenceMs: null,
          timeDifferenceFormatted: null,
        };
      }
    } else if (tokenProfileOrder) {
      graduationInfo = {
        graduatedAt: null,
        graduatedAtTimestamp: null,
        createdAt: null,
        createdAtTimestamp: null,
        twitter: null,
        telegram: null,
        website: null,
        organicScore: null,
        organicScoreLabel: null,
        isApprovedBeforeMigration: null,
        timeDifferenceMs: null,
        timeDifferenceFormatted: null,
        creationToMigrationTime: {
          timeDifferenceMs: null,
          timeDifferenceFormatted: null,
        },
      };
    }

    return {
      tokenAddress,
      hasTokenProfile: !!tokenProfileOrder,
      order: tokenProfileOrder,
      hasTokenAd: hasTokenAd,
      tokenAdOrder: firstTokenAdOrder,
      hasCommunityTakeover: hasCommunityTakeover,
      communityTakeoverOrder: firstCommunityTakeoverOrder,
      graduationInfo,
      tokenAdInfo: tokenAdInfo ?? undefined,
      communityTakeoverInfo: communityTakeoverInfo ?? undefined,
      boostInfo,
    };
  } catch (error) {
    return {
      tokenAddress,
      hasTokenProfile: false,
      hasTokenAd: false,
      hasCommunityTakeover: false,
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

  const tokensMap = await loadExistingTokens();

  const tokensToCheck = tokenAddresses.filter((addr) => {
    const trimmed = addr.trim();
    return trimmed && !tokensMap.has(trimmed);
  });

  const totalToCheck = tokensToCheck.length;
  const alreadyProcessed = tokenAddresses.length - totalToCheck;
  const websiteInfoCache = new Map<string, WebsiteDetails>();

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

    if (batchResults.length > 0 && process.env.HELIUS_RPC_URL) {
      console.log(`    🔗 Fetching first buy info for ${batchResults.length} token(s)...`);
      for (const result of batchResults) {
        result.launchInfo = await fetchFirstBuyInfo(result.tokenAddress);
        await new Promise((resolve) => setTimeout(resolve, HELIUS_RPC_DELAY_MS));
      }
    }

    const tokensWithWebsite = batchResults.filter((r) => r.graduationInfo?.website);
    if (tokensWithWebsite.length > 0) {
      console.log(`    🌐 Fetching website info for ${tokensWithWebsite.length} token(s)...`);
      for (const result of tokensWithWebsite) {
        const domain = extractDomainFromWebsite(result.graduationInfo!.website);
        if (!domain) {
          continue;
        }

        let details = websiteInfoCache.get(domain);
        if (!details) {
          details = await fetchWebsiteDetails(domain);
          websiteInfoCache.set(domain, details);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        result.graduationInfo!.websiteDetails = details;
      }
    }
    
    results.push(...batchResults);

    for (const result of batchResults) {
      await saveTokenIncremental(result, tokensMap);
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
        console.log(`    ✓ Has tokenProfile (approved)${isHighlighted ? " ⭐" : ""}`);
      } else {
        console.log(`    ✗ No tokenProfile found${result.error ? ` (${result.error})` : ""}`);
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

async function loadExistingTokens(): Promise<Map<string, any>> {
  const tokenMap = new Map<string, any>();

  try {
    const content = await readFile(ALL_TOKENS_JSON, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data.tokens)) return tokenMap;

    for (const token of data.tokens) {
      if (token.tokenAddress) {
        tokenMap.set(token.tokenAddress, token);
      }
    }
  } catch {
    // File missing or invalid — start fresh
  }

  return tokenMap;
}

export function buildTokenDataFromResult(result: TokenCheckResult): Record<string, unknown> {
  const isHighlighted =
    result.hasTokenProfile &&
    result.boostInfo?.hasBoosts === true &&
    result.graduationInfo?.isApprovedBeforeMigration === true &&
    result.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true;

  return {
    tokenAddress: result.tokenAddress,
    gmgnUrl: `https://gmgn.ai/sol/token/${result.tokenAddress}`,
    hasTokenProfile: result.hasTokenProfile,
    highlighted: isHighlighted,
    error: result.error ?? null,
    migration: result.graduationInfo
      ? {
          createdAt: result.graduationInfo.createdAt,
          graduatedAt: result.graduationInfo.graduatedAt,
          twitter: result.graduationInfo.twitter,
          website: result.graduationInfo.website,
          telegram: result.graduationInfo.telegram,
          organicScore: result.graduationInfo.organicScore,
          organicScoreLabel: result.graduationInfo.organicScoreLabel,
          isApprovedBeforeMigration: result.graduationInfo.isApprovedBeforeMigration,
          approvedVsMigrationMs: result.graduationInfo.timeDifferenceMs,
          approvedVsMigration: result.graduationInfo.timeDifferenceFormatted,
          creationToMigrationMs:
            result.graduationInfo.creationToMigrationTime?.timeDifferenceMs ?? null,
          creationToMigration:
            result.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted ?? null,
          websiteDetails: result.graduationInfo.websiteDetails ?? null,
        }
      : null,
    tokenAd: result.hasTokenAd
      ? {
          hasTokenAd: true,
          adCount: result.tokenAdInfo?.adCount ?? 0,
          paymentTimestamp: result.tokenAdOrder?.paymentTimestamp ?? null,
          paymentDate: result.tokenAdOrder?.paymentTimestamp
            ? new Date(result.tokenAdOrder.paymentTimestamp).toISOString()
            : null,
          isApprovedBeforeMigration: result.tokenAdInfo?.isApprovedBeforeMigration ?? null,
          approvedVsMigrationMs: result.tokenAdInfo?.timeDifferenceMs ?? null,
          approvedVsMigration: result.tokenAdInfo?.timeDifferenceFormatted ?? null,
        }
      : null,
    communityTakeover: result.hasCommunityTakeover
      ? {
          hasCommunityTakeover: true,
          takeoverCount: result.communityTakeoverInfo?.takeoverCount ?? 0,
          paymentTimestamp: result.communityTakeoverOrder?.paymentTimestamp ?? null,
          paymentDate: result.communityTakeoverOrder?.paymentTimestamp
            ? new Date(result.communityTakeoverOrder.paymentTimestamp).toISOString()
            : null,
          isApprovedBeforeMigration:
            result.communityTakeoverInfo?.isApprovedBeforeMigration ?? null,
          approvedVsMigrationMs: result.communityTakeoverInfo?.timeDifferenceMs ?? null,
          approvedVsMigration: result.communityTakeoverInfo?.timeDifferenceFormatted ?? null,
        }
      : null,
    boost:
      result.boostInfo && result.boostInfo.hasBoosts
        ? {
            hasBoosts: true,
            count: result.boostInfo.boostCount,
            totalAmount: result.boostInfo.totalAmount,
            firstBoost: result.boostInfo.firstBoost
              ? {
                  amount: result.boostInfo.firstBoost.amount,
                  date: new Date(result.boostInfo.firstBoost.paymentTimestamp).toISOString(),
                }
              : null,
            firstBoostVsMigration: result.boostInfo.firstBoostVsMigration
              ? {
                  isBeforeMigration:
                    result.boostInfo.firstBoostVsMigration.isFirstBoostBeforeMigration,
                  timeMs: result.boostInfo.firstBoostVsMigration.timeDifferenceMs,
                  time: result.boostInfo.firstBoostVsMigration.timeDifferenceFormatted,
                }
              : null,
          }
        : null,
    launch: toLaunchJson(result.launchInfo),
  };
}

async function saveTokenIncremental(
  result: TokenCheckResult,
  tokensMap: Map<string, any>,
  filename: string = ALL_TOKENS_JSON
): Promise<void> {
  const tokenData = buildTokenDataFromResult(result);
  tokensMap.set(result.tokenAddress, tokenData);

  const tokens = Array.from(tokensMap.values());
  const output = {
    totalTokens: tokensMap.size,
    withTokenProfile: tokens.filter((t: any) => t.hasTokenProfile).length,
    highlightedCount: tokens.filter((t: any) => t.highlighted).length,
    checkedAt: new Date().toISOString(),
    tokens,
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * Main function - Load token addresses from tokens.txt file
 */
async function main() {
  await ensureDataDir();

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

  console.log("\n=== Final Summary ===");
  console.log(`✓ All tokens saved to ${ALL_TOKENS_JSON}`);

  const highlightedTokens = results.filter(
    (r) =>
      r.hasTokenProfile &&
      r.boostInfo?.hasBoosts &&
      r.graduationInfo?.isApprovedBeforeMigration === true &&
      r.boostInfo?.firstBoostVsMigration?.isFirstBoostBeforeMigration === true
  );
  if (highlightedTokens.length > 0) {
    console.log(
      `  ⭐ ${highlightedTokens.length} HIGHLIGHTED: boost + tokenProfile before migration`
    );
  }

  console.log("\n=== Exporting to CSV ===");
  await exportAllTokensToCSV();
}

// Run the main function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
