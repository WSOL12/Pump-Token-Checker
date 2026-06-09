import "dotenv/config";

const key = process.env.HELIUS_RPC_URL!.match(/api-key=([^&]+)/)![1]!;
const sigs = [
  "4CWtbQdKye6CWw5P72tB7pSQoTbnsViMHzDXuPXEWK8YzwmoyAKQTc7RfFrWQBk8zQQHNkigGxfuc7nXCcnzYT84",
  "4F7KSYYHi7pjvFPEpcGtChb7AQxQv5c5fHzeJWaACYTXkuP2uPnTzd9zBtb4Woo2UrCFVBgPmVLJWY6cfpm1XxV2",
];

for (const sig of sigs) {
  const r = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: [sig] }),
  });
  const tx = ((await r.json()) as any[])[0];
  console.log("\n", sig.slice(0, 12), tx.type, tx.source);
  for (const t of tx.nativeTransfers.filter((x: any) => x.fromUserAccount === tx.feePayer)) {
    console.log(" ", (t.amount / 1e9).toFixed(9), "->", t.toUserAccount);
  }
}
