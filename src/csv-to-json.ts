import "dotenv/config";
import { exportAllTokensJsonFromCsv } from "./tokens-csv.js";
import { ALL_TOKENS_CSV, ALL_TOKENS_JSON, ensureDataDir } from "./paths.js";

async function main() {
  await ensureDataDir();

  console.log(`📄 Reading ${ALL_TOKENS_CSV}...`);
  const count = await exportAllTokensJsonFromCsv();
  console.log(`✓ Wrote ${count} token(s) to ${ALL_TOKENS_JSON}`);
}

main().catch((error) => {
  console.error("❌ CSV to JSON failed:", error);
  process.exit(1);
});
