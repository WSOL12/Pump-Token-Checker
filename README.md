# Token Profile Checker

A tool to check if Solana tokens have completed tokenProfile orders via the DexScreener API.

## Features

- **Automated token fetching** from Moralis API (graduated Pump.fun tokens)
- Check multiple token addresses for tokenProfile orders
- Rate limiting (respects 60 requests/minute limit)
- Detailed results with payment timestamps
- Error handling for failed requests
- Saves both approved and unapproved tokens to separate JSON files

## Setup

### Step 1: Fetch Tokens (Optional)

1. Get your API keys:
   - **Moralis API key** from: https://developers.moralis.com (free signup) - for fetching tokens
   - **Jupiter API key** from: https://portal.jup.ag (optional) - for migration time comparison
   
2. Create a `.env` file in the project root:
   ```
   MORALIS_API_KEY=your_moralis_api_key_here
   JUPITER_API_KEY=your_jupiter_api_key_here  # Optional: enables migration comparison
   NAMERDAP_API_KEY=your_namerdap_api_key_here  # Optional: WHOIS lookup via namerdap.systems
   ```
   
   Optional: Set limit to control how many tokens to fetch:
   ```
   MAX_TOKENS=5000   # Maximum number of unique tokens to fetch (default: 5000)
   ```

3. Fetch graduated Pump.fun tokens:
   ```bash
   npm run fetch-tokens
   ```

This will:
- Fetch graduated Pump.fun tokens from Moralis API
- Handle pagination automatically (with configurable limit)
- Save them to `tokens.txt`
- Default limit: 5000 tokens - adjust via MAX_TOKENS environment variable

### Step 2: Check Tokens

1. Make sure `tokens.txt` has your token addresses (one per line)
2. Run the checker:

```bash
npm run dev
```

Or build and run:

```bash
npm run build
npm start
```

## Output

The tool will:
- Check each token address sequentially
- Display real-time progress
- Show which tokens have approved tokenProfile orders
- Save approved tokens to `data/approved_tokens.json` with GMGN URLs
- Save unapproved tokens to `data/unapproved_tokens.json`
- Export CSV to `data/approved_tokens.csv`
- Provide a summary at the end

### Output File Format

**`data/approved_tokens.json`** contains:
- Token addresses with approved tokenProfile
- GMGN URLs for each token
- Payment timestamps and dates
- Migration comparison (if Jupiter API key provided):
  - Whether tokenProfile was approved before or after migration
  - Time difference between approval and migration
  - Graduation timestamp
- Website details (when a website URL is present):
  - Hosting IP (hosting-checker.net)
  - Registrar, phone, mailing address (namerdap.systems RDAP)
- Summary statistics

**`data/unapproved_tokens.json`** contains:
- Token addresses without approved tokenProfile
- GMGN URLs for each token
- Error messages (if any)
- Summary statistics

## APIs Used

### DexScreener API
- Endpoint: `GET https://api.dexscreener.com/orders/v1/solana/{tokenAddress}`
- Rate limit: 60 requests per minute
- Used to check if tokens have approved tokenProfile orders

### Moralis API
- Endpoint: `GET https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated`
- Used to fetch graduated Pump.fun tokens
- Requires API key (get one at https://developers.moralis.com - free signup)
- Automatically handles pagination to fetch all available tokens

### Website Lookup APIs
- **Hosting IP**: `GET https://hosting-checker.net/api/hosting/{domain}` (no API key)
- **WHOIS/RDAP**: `GET https://namerdap.systems/domain/{domain}` (optional `NAMERDAP_API_KEY`)

### Jupiter API (Optional)
- Endpoint: `GET https://api.jup.ag/tokens/v2/search`
- Used to fetch token graduation/migration information
- Requires API key (get one at https://portal.jup.ag)
- Used to compare tokenProfile approval time with migration time
- If not provided, migration comparison will be skipped
