import { writeFile } from "fs/promises";
import "dotenv/config";

interface MoralisGraduatedToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  logo?: string;
  decimals: string;
  priceNative: string;
  priceUsd: string;
  liquidity: string;
  fullyDilutedValuation: string;
  graduatedAt: string;
}

interface MoralisResponse {
  result: MoralisGraduatedToken[];
  cursor?: string;
}

/**
 * Fetch graduated Pump.fun tokens from Moralis API
 */
async function fetchMigratedTokens(): Promise<string[]> {
  const apiKey = process.env.MORALIS_API_KEY;
  
  if (!apiKey) {
    console.error("❌ MORALIS_API_KEY not found in environment variables.");
    console.error("   Please create a .env file with: MORALIS_API_KEY=your_api_key");
    console.error("   Get your API key from: https://developers.moralis.com");
    process.exit(1);
  }
  
  // Validate API key format
  if (apiKey.length < 20) {
    console.warn("⚠️  MORALIS_API_KEY appears to be invalid (too short).");
    console.warn("   Please verify your API key is correct.");
  }

  // Configurable limit
  const maxTokens = parseInt(process.env.MAX_TOKENS || "5000", 10); // Default: 5000 tokens max

  const tokenAddresses = new Set<string>();
  const limit = 100; // Max per request
  let cursor: string | undefined = undefined;
  let totalFetched = 0;
  let pageCount = 0;

  try {
    console.log("🔍 Fetching graduated Pump.fun tokens from Moralis API...");
    console.log(`   Limit: Max ${maxTokens} tokens\n`);
    
    do {
      // Check limit before fetching
      if (tokenAddresses.size >= maxTokens) {
        console.log(`\n⚠️  Reached maximum token limit (${maxTokens} tokens)`);
        break;
      }
      
      pageCount++;
      const url = new URL("https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated");
      url.searchParams.set("limit", limit.toString());
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      
      console.log(`📄 Fetching page ${pageCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ""}...`);
      
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "accept": "application/json",
          "X-API-Key": apiKey,
        },
      });

      if (!response.ok) {
        let errorDetails = "";
        try {
          const errorData = await response.json();
          errorDetails = JSON.stringify(errorData);
        } catch {
          errorDetails = await response.text();
        }
        
        if (response.status === 401) {
          console.error("❌ Moralis API authentication failed (401 Unauthorized)");
          console.error("   Please check your MORALIS_API_KEY in .env file");
          console.error("   Make sure the API key is valid and has the correct permissions");
          console.error("   Get your API key from: https://developers.moralis.com");
          throw new Error(`Moralis API authentication failed: Invalid or missing API key`);
        }
        
        throw new Error(`Moralis API error: ${response.status} ${response.statusText} - ${errorDetails.substring(0, 200)}`);
      }

      const data = (await response.json()) as MoralisResponse;

      if (!data.result || !Array.isArray(data.result)) {
        throw new Error("Invalid response format: missing result array");
      }

      // Extract token addresses
      for (const token of data.result) {
        if (token.tokenAddress && token.tokenAddress.trim() !== "") {
          tokenAddresses.add(token.tokenAddress.trim());
        }
      }

      totalFetched += data.result.length;
      cursor = data.cursor;
      
      console.log(`   ✓ Fetched ${data.result.length} tokens (${tokenAddresses.size} unique so far)`);
      
      // Small delay to avoid rate limiting
      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } while (cursor && tokenAddresses.size < maxTokens); // Continue while there's a cursor and limit not reached

    const addresses = Array.from(tokenAddresses);
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total pages fetched: ${pageCount}`);
    console.log(`   Total tokens received: ${totalFetched}`);
    console.log(`   Unique token addresses: ${addresses.length}${addresses.length >= maxTokens ? ` (limit reached)` : ""}`);
    if (cursor && addresses.length >= maxTokens) {
      console.log(`   ⚠️  More tokens available (stopped due to limit)`);
    }
    
    if (addresses.length > 0) {
      console.log(`\n✅ Successfully fetched ${addresses.length} unique graduated token address(es)`);
      console.log(`   Sample: ${addresses.slice(0, 3).join(", ")}${addresses.length > 3 ? "..." : ""}\n`);
    } else {
      console.log("\n⚠️  No token addresses found");
      console.log("   This might indicate:");
      console.log("   - The API returned no results");
      console.log("   - There are no graduated tokens\n");
    }
    
    return addresses;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error fetching from Moralis API: ${errorMessage}`);
    
    if (errorMessage.includes("authentication failed") || errorMessage.includes("401")) {
      console.error("\n💡 Troubleshooting:");
      console.error("   1. Verify your API key at: https://developers.moralis.com");
      console.error("   2. Make sure MORALIS_API_KEY is set correctly in your .env file");
      console.error("   3. Check that your API key has Solana API access");
    }
    
    throw error;
  }
}

/**
 * Save token addresses to file
 */
async function saveTokensToFile(
  addresses: string[],
  filename: string = "tokens.txt"
): Promise<void> {
  const header = `# Graduated Pump.fun token addresses fetched from Moralis API
# Generated at: ${new Date().toISOString()}
# Total addresses: ${addresses.length}
#
# Add your token addresses here, one per line
# Lines starting with # are comments and will be ignored
#
`;

  const content = header + addresses.join("\n") + "\n";
  await writeFile(filename, content, "utf-8");
  console.log(`💾 Saved ${addresses.length} token address(es) to ${filename}\n`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("🚀 Starting token fetch from Moralis API...\n");
    
    const tokenAddresses = await fetchMigratedTokens();
    
    if (tokenAddresses.length > 0) {
      await saveTokensToFile(tokenAddresses, "tokens.txt");
      console.log("✅ Token fetch completed successfully!");
      console.log(`   Found ${tokenAddresses.length} unique graduated Pump.fun tokens`);
    } else {
      console.log("⚠️  No tokens found. Check your Moralis API key.");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Failed to fetch tokens:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
