import { writeFile, readFile } from "fs/promises";
import "dotenv/config";
import {
  APPROVED_TOKENS_JSON,
  UNAPPROVED_TOKENS_JSON,
  ensureDataDir,
} from "./paths.js";
import {
  extractDomainFromWebsite,
  fetchWebsiteDetails,
  type WebsiteDetails,
} from "./website-info.js";
import { exportAllTokenCsvFiles } from "./approved-csv.js";
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
    athPrice: number | null;
    athMarketcap: number | null;
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
 * Fetch ATH price from Bitquery API (batch version - up to 10 tokens per request)
 */
async function fetchATHPriceBatch(tokenAddresses: string[]): Promise<Map<string, {
  athPrice: number | null;
  athMarketcap: number | null;
}>> {
  const apiKey = process.env.BITQUERY_API_KEY;
  const resultMap = new Map<string, { athPrice: number | null; athMarketcap: number | null }>();
  
  if (!apiKey) {
    // Bitquery API key is optional - return empty map if not provided
    return resultMap;
  }

  if (tokenAddresses.length === 0) {
    return resultMap;
  }

  // Limit to 10 tokens per batch
  const batchSize = 10;
  
  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize);
    
    try {
      // Format token addresses for GraphQL query
      const tokenAddressList = batch.map(addr => `"${addr}"`).join(", ");
      
      const query = `{
        Solana(dataset: combined) {
          DEXTradeByTokens(
            limitBy: { by: Trade_Currency_MintAddress, count: 1 }
            where: {
              Trade: {
                Currency: {
                  MintAddress: {
                    in: [${tokenAddressList}]
                  }
                }
                Side: {
                  Currency: {
                    MintAddress: {
                      in: [
                        "11111111111111111111111111111111",
                        "So11111111111111111111111111111111111111112"
                      ]
                    }
                  }
                }
              }
              Block: { Time: { since: "2025-05-03T06:37:00Z" } }
            }
          ) {
            Trade {
              Currency {
                MintAddress
              }
              PriceInUSD: PriceInUSD(maximum: Trade_PriceInUSD)
            }
            max: quantile(of: Trade_PriceInUSD, level: 0.98)
            ATH_Marketcap: calculate(expression: "$max * 1000000000")
          }
        }
      }`;

      const response = await fetch("https://streaming.bitquery.io/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, variables: "{}" }),
      });

      if (!response.ok) {
        let errorDetails = "";
        try {
          const errorData = await response.json();
          errorDetails = JSON.stringify(errorData);
        } catch {
          errorDetails = await response.text();
        }
        console.error("❌ Bitquery API error:", response.status, response.statusText, errorDetails.substring(0, 200));
        // Continue with next batch or return partial results
        continue;
      }

      const data = (await response.json()) as {
        data?: {
          Solana?: {
            DEXTradeByTokens?: Array<{
              max?: number;
              ATH_Marketcap?: number;
              Trade?: {
                Currency?: {
                  MintAddress?: string;
                };
                PriceInUSD?: number;
              };
            }>;
          };
        };
      };

      if (!data.data?.Solana?.DEXTradeByTokens) {
        continue;
      }

      // Process results and map to token addresses
      for (const tokenResult of data.data.Solana.DEXTradeByTokens) {
        const mintAddress = tokenResult.Trade?.Currency?.MintAddress;
        if (mintAddress && batch.includes(mintAddress)) {
          resultMap.set(mintAddress, {
            // ATH price: use Bitquery's PriceInUSD(maximum: Trade_PriceInUSD)
            athPrice: tokenResult.Trade?.PriceInUSD ?? null,
            // ATH marketcap: use Bitquery's ATH_Marketcap as returned
            athMarketcap: tokenResult.ATH_Marketcap ?? null,
          });
        }
      }

      // Initialize null values for tokens that weren't found in the response
      for (const tokenAddress of batch) {
        if (!resultMap.has(tokenAddress)) {
          resultMap.set(tokenAddress, {
            athPrice: null,
            athMarketcap: null,
          });
        }
      }

      // Small delay between batch requests
      if (i + batchSize < tokenAddresses.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      // Silently fail for this batch - initialize null values
      for (const tokenAddress of batch) {
        if (!resultMap.has(tokenAddress)) {
          resultMap.set(tokenAddress, {
            athPrice: null,
            athMarketcap: null,
          });
        }
      }
    }
  }

  return resultMap;
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
  athPrice: number | null;
  athMarketcap: number | null;
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

    // ATH price will be fetched in batches later - return null for now
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
      athPrice: null,
      athMarketcap: null,
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

    // If token has approved tokenProfile, tokenAd, or communityTakeover, fetch graduation info and compare
    const needsGraduationInfo = (tokenProfileOrder && tokenProfileOrder.paymentTimestamp) || 
                                 (firstTokenAdOrder && firstTokenAdOrder.paymentTimestamp) ||
                                 (firstCommunityTakeoverOrder && firstCommunityTakeoverOrder.paymentTimestamp);
    
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
            telegram: gradInfo.telegram,
            website: gradInfo.website,
            organicScore: gradInfo.organicScore,
            organicScoreLabel: gradInfo.organicScoreLabel,
            athPrice: gradInfo.athPrice,
            athMarketcap: gradInfo.athMarketcap,
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
            telegram: gradInfo.telegram,
            website: gradInfo.website,
            organicScore: gradInfo.organicScore,
            organicScoreLabel: gradInfo.organicScoreLabel,
            athPrice: gradInfo.athPrice,
            athMarketcap: gradInfo.athMarketcap,
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
            creationToMigrationTime: {
              timeDifferenceMs: null,
              timeDifferenceFormatted: null,
            },
          };
        }

        // Process first tokenAd if it exists
        if (firstTokenAdOrder && firstTokenAdOrder.paymentTimestamp) {
          const tokenAdPaymentTimestamp = firstTokenAdOrder.paymentTimestamp;
          const tokenAdTimeDifferenceMs = tokenAdPaymentTimestamp - gradInfo.graduatedAtTimestamp;
          const tokenAdIsApprovedBeforeMigration = tokenAdTimeDifferenceMs < 0;
          
          tokenAdInfo = {
            adCount: tokenAdOrders.length,
            isApprovedBeforeMigration: tokenAdIsApprovedBeforeMigration,
            timeDifferenceMs: tokenAdTimeDifferenceMs,
            timeDifferenceFormatted: formatTimeDifference(tokenAdTimeDifferenceMs),
          };
        }

        // Process first communityTakeover if it exists
        if (firstCommunityTakeoverOrder && firstCommunityTakeoverOrder.paymentTimestamp) {
          const communityTakeoverPaymentTimestamp = firstCommunityTakeoverOrder.paymentTimestamp;
          const communityTakeoverTimeDifferenceMs = communityTakeoverPaymentTimestamp - gradInfo.graduatedAtTimestamp;
          const communityTakeoverIsApprovedBeforeMigration = communityTakeoverTimeDifferenceMs < 0;
          
          communityTakeoverInfo = {
            takeoverCount: communityTakeoverOrders.length,
            isApprovedBeforeMigration: communityTakeoverIsApprovedBeforeMigration,
            timeDifferenceMs: communityTakeoverTimeDifferenceMs,
            timeDifferenceFormatted: formatTimeDifference(communityTakeoverTimeDifferenceMs),
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
            telegram: null,
            website: null,
            organicScore: null,
            organicScoreLabel: null,
            athPrice: null,
            athMarketcap: null,
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
            creationToMigrationTime: {
              timeDifferenceMs: null,
              timeDifferenceFormatted: null,
            },
          };
        }
        if (hasTokenAd && firstTokenAdOrder) {
          tokenAdInfo = {
            adCount: tokenAdOrders.length,
            isApprovedBeforeMigration: null,
            timeDifferenceMs: null,
            timeDifferenceFormatted: null,
          };
        }
        if (hasCommunityTakeover && firstCommunityTakeoverOrder) {
          communityTakeoverInfo = {
            takeoverCount: communityTakeoverOrders.length,
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
    
    // Collect token addresses that need ATH price data (all tokens in batch)
    const tokensForATH = batchResults.map(r => r.tokenAddress);
    
    // Fetch ATH prices in batches (10 tokens per request)
    if (tokensForATH.length > 0 && process.env.BITQUERY_API_KEY) {
      console.log(`    📊 Fetching ATH prices for ${tokensForATH.length} token(s) in batch...`);
      const athPriceMap = await fetchATHPriceBatch(tokensForATH);
      
      // Update results with ATH price data
      for (const result of batchResults) {
        if (result.graduationInfo && athPriceMap.has(result.tokenAddress)) {
          const athData = athPriceMap.get(result.tokenAddress)!;
          result.graduationInfo.athPrice = athData.athPrice;
          result.graduationInfo.athMarketcap = athData.athMarketcap;
        }
      }
    }

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

/**
 * Load existing approved tokens from JSON file
 */
async function loadExistingApprovedTokens(
  filename: string = APPROVED_TOKENS_JSON
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
  filename: string = UNAPPROVED_TOKENS_JSON
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
  filename: string = APPROVED_TOKENS_JSON
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
      telegram: result.graduationInfo.telegram,
      organicScore: result.graduationInfo.organicScore,
      organicScoreLabel: result.graduationInfo.organicScoreLabel,
      athPrice: result.graduationInfo.athPrice,
      athMarketcap: result.graduationInfo.athMarketcap,
      isApprovedBeforeMigration: result.graduationInfo.isApprovedBeforeMigration,
      approvedVsMigrationMs: result.graduationInfo.timeDifferenceMs,
      approvedVsMigration: result.graduationInfo.timeDifferenceFormatted,
      creationToMigrationMs: result.graduationInfo.creationToMigrationTime?.timeDifferenceMs ?? null,
      creationToMigration: result.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted ?? null,
      websiteDetails: result.graduationInfo.websiteDetails ?? null,
    } : null,
    tokenAd: result.hasTokenAd ? {
      hasTokenAd: true,
      adCount: result.tokenAdInfo?.adCount ?? 0,
      paymentTimestamp: result.tokenAdOrder?.paymentTimestamp ?? null,
      paymentDate: result.tokenAdOrder?.paymentTimestamp 
        ? new Date(result.tokenAdOrder.paymentTimestamp).toISOString() 
        : null,
      isApprovedBeforeMigration: result.tokenAdInfo?.isApprovedBeforeMigration ?? null,
      approvedVsMigrationMs: result.tokenAdInfo?.timeDifferenceMs ?? null,
      approvedVsMigration: result.tokenAdInfo?.timeDifferenceFormatted ?? null,
    } : null,
    communityTakeover: result.hasCommunityTakeover ? {
      hasCommunityTakeover: true,
      takeoverCount: result.communityTakeoverInfo?.takeoverCount ?? 0,
      paymentTimestamp: result.communityTakeoverOrder?.paymentTimestamp ?? null,
      paymentDate: result.communityTakeoverOrder?.paymentTimestamp 
        ? new Date(result.communityTakeoverOrder.paymentTimestamp).toISOString() 
        : null,
      isApprovedBeforeMigration: result.communityTakeoverInfo?.isApprovedBeforeMigration ?? null,
      approvedVsMigrationMs: result.communityTakeoverInfo?.timeDifferenceMs ?? null,
      approvedVsMigration: result.communityTakeoverInfo?.timeDifferenceFormatted ?? null,
    } : null,
    boost: result.boostInfo && result.boostInfo.hasBoosts ? {
      hasBoosts: true,
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
    launch: toLaunchJson(result.launchInfo),
  };

  approvedMap.set(result.tokenAddress, tokenData);

  // Keep tokens in processing order (Map maintains insertion order)
  const tokens = Array.from(approvedMap.values());

  const output = {
    totalApproved: approvedMap.size,
    highlightedCount: tokens.filter((t: any) => t.highlighted).length,
    checkedAt: new Date().toISOString(),
    tokens: tokens,
  };

  await writeFile(filename, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * Save unapproved token incrementally (append to existing)
 */
async function saveUnapprovedTokenIncremental(
  result: TokenCheckResult,
  unapprovedMap: Map<string, any>,
  filename: string = UNAPPROVED_TOKENS_JSON
): Promise<void> {
  if (result.hasTokenProfile) {
    return;
  }

  const tokenData = {
    tokenAddress: result.tokenAddress,
    gmgnUrl: `https://gmgn.ai/sol/token/${result.tokenAddress}`,
    error: result.error || null,
    launch: toLaunchJson(result.launchInfo),
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
  filename: string = APPROVED_TOKENS_JSON
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
          telegram: r.graduationInfo.telegram,
          website: r.graduationInfo.website,
          organicScore: r.graduationInfo.organicScore,
          organicScoreLabel: r.graduationInfo.organicScoreLabel,
          athPrice: r.graduationInfo.athPrice,
          athMarketcap: r.graduationInfo.athMarketcap,
          isApprovedBeforeMigration: r.graduationInfo.isApprovedBeforeMigration,
          approvedVsMigrationMs: r.graduationInfo.timeDifferenceMs,
          approvedVsMigration: r.graduationInfo.timeDifferenceFormatted,
          creationToMigrationMs: r.graduationInfo.creationToMigrationTime?.timeDifferenceMs ?? null,
          creationToMigration: r.graduationInfo.creationToMigrationTime?.timeDifferenceFormatted ?? null,
          websiteDetails: r.graduationInfo.websiteDetails ?? null,
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
        communityTakeover: r.hasCommunityTakeover ? {
          hasCommunityTakeover: true,
          takeoverCount: r.communityTakeoverInfo?.takeoverCount ?? 0,
          paymentTimestamp: r.communityTakeoverOrder?.paymentTimestamp ?? null,
          paymentDate: r.communityTakeoverOrder?.paymentTimestamp 
            ? new Date(r.communityTakeoverOrder.paymentTimestamp).toISOString() 
            : null,
          isApprovedBeforeMigration: r.communityTakeoverInfo?.isApprovedBeforeMigration ?? null,
          approvedVsMigrationMs: r.communityTakeoverInfo?.timeDifferenceMs ?? null,
          approvedVsMigration: r.communityTakeoverInfo?.timeDifferenceFormatted ?? null,
        } : null,
        boost: r.boostInfo && r.boostInfo.hasBoosts ? {
          hasBoosts: true,
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
        launch: toLaunchJson(r.launchInfo),
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
  filename: string = UNAPPROVED_TOKENS_JSON
): Promise<void> {
  const unapprovedTokens = results
    .filter((r) => !r.hasTokenProfile)
    .map((r) => ({
      tokenAddress: r.tokenAddress,
      gmgnUrl: `https://gmgn.ai/sol/token/${r.tokenAddress}`,
      error: r.error || null,
      launch: toLaunchJson(r.launchInfo),
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
    
    console.log(`\n✓ ${withTokenProfile.length} approved token(s) saved to ${APPROVED_TOKENS_JSON}`);
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
  await exportAllTokenCsvFiles();

  if (withoutTokenProfile.length > 0) {
    console.log(`✓ ${withoutTokenProfile.length} unapproved token(s) saved to ${UNAPPROVED_TOKENS_JSON}`);
  }
}

// Run the main function
main().catch(console.error);
