import { PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_PROGRAM = new PublicKey(PUMP_PROGRAM_ID);

const ACCOUNT_RENT_LAMPORTS = new Set([1691280, 2039280, 2074080, 2519520, 1294560]);

/** Pump IDL instruction discriminators (hex) */
const BUY_IX = {
  buy: "66063d1201daebea",
  buyV2: "b817ee6167c5d33d",
  buyExactSolIn: "38fc74089edfcd5f",
  buyExactQuoteInV2: "c2ab1c46684d5b2f",
} as const;

const CREATE_V2_IX = "d6904cec5f8b31b4";

type BuyKind = keyof typeof BUY_IX;

const CREATOR_VAULT_INDEX: Record<BuyKind, number> = {
  buy: 9,
  buyExactSolIn: 9,
  buyV2: 16,
  buyExactQuoteInV2: 16,
};

const USER_INDEX: Record<BuyKind, number> = {
  buy: 6,
  buyExactSolIn: 6,
  buyV2: 13,
  buyExactQuoteInV2: 13,
};

const BONDING_CURVE_INDEX: Record<BuyKind, number> = {
  buy: 3,
  buyExactSolIn: 3,
  buyV2: 10,
  buyExactQuoteInV2: 10,
};

export const HELIUS_RPC_DELAY_MS = 50;

export interface FirstBuyInfo {
  firstTxSignature: string;
  firstSwapSol: number;
  firstBuyCreatorFeeSol: number;
}

export function toLaunchJson(launchInfo: FirstBuyInfo | null | undefined) {
  if (!launchInfo) {
    return {
      firstTxSignature: null,
      firstSwapSol: null,
      firstBuyCreatorFeeSol: null,
    };
  }

  return {
    firstTxSignature: launchInfo.firstTxSignature,
    firstSwapSol: launchInfo.firstSwapSol,
    firstBuyCreatorFeeSol: launchInfo.firstBuyCreatorFeeSol,
  };
}

interface RpcTransaction {
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string } | string>;
      instructions: Array<{
        programId: string | number;
        accounts?: Array<string | number>;
        data?: string;
      }>;
    };
  };
  meta: {
    err?: unknown;
    logMessages?: string[];
    innerInstructions?: Array<{
      index: number;
      instructions: Array<{
        parsed?: {
          type?: string;
          info?: {
            source?: string;
            destination?: string;
            newAccount?: string;
            lamports?: number | string;
          };
        };
      }>;
    }>;
  } | null;
}

function getRpcUrl(): string | null {
  return process.env.HELIUS_RPC_URL?.trim() || null;
}

function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

export function bondingCurvePda(mintAddress: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mintAddress).toBuffer()],
    PUMP_PROGRAM
  );
  return pda.toBase58();
}

export function userVolumeAccumulatorPda(user: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), new PublicKey(user).toBuffer()],
    PUMP_PROGRAM
  );
  return pda.toBase58();
}

function decodeBase58(input: string): Buffer {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const char of input) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`invalid base58: ${char}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char === "1") bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

function resolveAccountKeys(tx: RpcTransaction): string[] {
  return tx.transaction.message.accountKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey
  );
}

function resolveAccounts(
  accounts: Array<string | number> | undefined,
  keys: string[]
): string[] {
  if (!accounts) return [];
  return accounts.map((a) => (typeof a === "number" ? keys[a]! : a));
}

function programId(id: string | number | undefined, keys: string[]): string | undefined {
  if (id === undefined) return undefined;
  return typeof id === "number" ? keys[id] : id;
}

function detectBuyKindFromData(data: string | undefined): BuyKind | null {
  if (!data) return null;
  try {
    const bytes = decodeBase58(data);
    if (bytes.length < 8) return null;
    const disc = bytes.subarray(0, 8).toString("hex");
    for (const [kind, expected] of Object.entries(BUY_IX) as [BuyKind, string][]) {
      if (disc === expected) return kind;
    }
  } catch {
    return null;
  }
  return null;
}

function detectBuyKind(logs: string[] | undefined): BuyKind | null {
  if (!logs) return null;
  const joined = logs.join("\n");
  if (joined.includes("Instruction: BuyExactQuoteInV2")) return "buyExactQuoteInV2";
  if (joined.includes("Instruction: BuyExactSolIn")) return "buyExactSolIn";
  if (joined.includes("Instruction: BuyV2")) return "buyV2";
  if (joined.includes("Instruction: Buy")) return "buy";
  return null;
}

function readSpendableFromIxData(data: string | undefined, buyKind: BuyKind): number | null {
  if (!data) return null;
  let bytes: Buffer;
  try {
    bytes = decodeBase58(data);
  } catch {
    return null;
  }
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 8).toString("hex") !== BUY_IX[buyKind]) return null;

  if (buyKind === "buyExactSolIn" || buyKind === "buyExactQuoteInV2") {
    return Number(bytes.readBigUInt64LE(8));
  }
  return null;
}

interface BuyContext {
  kind: BuyKind;
  ixIndex: number;
  user: string;
  bondingCurve: string;
  creatorVault: string;
  userVolumeAccumulator: string;
}

function findBuyContext(tx: RpcTransaction): BuyContext | null {
  const keys = resolveAccountKeys(tx);
  const topIxs = tx.transaction.message.instructions;

  for (let i = 0; i < topIxs.length; i++) {
    const ix = topIxs[i]!;
    if (programId(ix.programId, keys) !== PUMP_PROGRAM_ID) continue;

    const kind = detectBuyKindFromData(ix.data);
    if (!kind) continue;

    const accounts = resolveAccounts(ix.accounts, keys);
    const user = accounts[USER_INDEX[kind]];
    const bondingCurve = accounts[BONDING_CURVE_INDEX[kind]];
    const creatorVault = accounts[CREATOR_VAULT_INDEX[kind]];
    if (!user || !bondingCurve || !creatorVault) continue;

    return {
      kind,
      ixIndex: i,
      user,
      bondingCurve,
      creatorVault,
      userVolumeAccumulator: userVolumeAccumulatorPda(user),
    };
  }

  return null;
}

function findProtocolDestinations(amounts: number[]): Set<number> {
  const protocol = new Set<number>();
  const sorted = [...amounts].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]!;
    const right = sorted[i + 1]!;
    if (Math.abs(left - right) <= 1 && left > 100_000) {
      protocol.add(left);
      protocol.add(right);
    }
  }

  return protocol;
}

function parseAmountsFromBuyInner(
  tx: RpcTransaction,
  ctx: BuyContext
): { swapLamports: number; creatorFeeLamports: number; bondingLamports: number; protocolLamports: number } | null {
  if (!tx.meta?.innerInstructions) return null;

  const innerGroup = tx.meta.innerInstructions.find((g) => g.index === ctx.ixIndex);
  if (!innerGroup) return null;

  const payerTransfers: Array<{ destination: string; lamports: number }> = [];
  let uvaCreateLamports = 0;

  for (const ix of innerGroup.instructions) {
    const p = ix.parsed;
    if (!p?.info?.source || p.info.source !== ctx.user) continue;

    if (p.type === "transfer" && p.info.destination) {
      payerTransfers.push({
        destination: p.info.destination,
        lamports: Number(p.info.lamports ?? 0),
      });
    }

    if (p.type === "createAccount" && p.info.newAccount === ctx.userVolumeAccumulator) {
      uvaCreateLamports = Number(p.info.lamports ?? 0);
    }
  }

  if (payerTransfers.length === 0 && uvaCreateLamports === 0) return null;

  const vaultTransfers = payerTransfers
    .filter((t) => t.destination === ctx.creatorVault)
    .map((t) => t.lamports);

  let creatorFeeLamports = 0;
  if (vaultTransfers.length >= 2) {
    creatorFeeLamports = Math.min(...vaultTransfers);
  } else if (vaultTransfers.length === 1) {
    creatorFeeLamports = vaultTransfers[0]!;
  }

  const protocolAmounts = findProtocolDestinations(
    payerTransfers.map((t) => t.lamports)
  );

  let bondingLamports = 0;
  let protocolLamports = 0;

  for (const transfer of payerTransfers) {
    const { destination, lamports } = transfer;
    if (destination === ctx.bondingCurve) bondingLamports += lamports;
    if (protocolAmounts.has(lamports)) protocolLamports += lamports;
  }

  let swapLamports = 0;
  for (const transfer of payerTransfers) {
    const { destination, lamports } = transfer;

    if (ACCOUNT_RENT_LAMPORTS.has(lamports)) continue;
    if (destination === ctx.creatorVault && lamports !== creatorFeeLamports) continue;

    if (
      destination === ctx.bondingCurve ||
      destination === ctx.userVolumeAccumulator ||
      protocolAmounts.has(lamports) ||
      lamports === creatorFeeLamports
    ) {
      swapLamports += lamports;
    }
  }

  swapLamports += uvaCreateLamports;

  if (swapLamports <= 0) return null;

  return { swapLamports, creatorFeeLamports, bondingLamports, protocolLamports };
}

export function parseFirstBuyFromTx(tx: RpcTransaction): {
  firstSwapSol: number;
  firstBuyCreatorFeeSol: number;
} | null {
  if (!tx.meta || tx.meta.err) return null;

  const ctx = findBuyContext(tx);
  if (!ctx) return null;

  const keys = resolveAccountKeys(tx);
  const topIxs = tx.transaction.message.instructions;

  // Exact-budget buys: spendable_sol_in / spendable_quote_in from instruction data
  if (ctx.kind === "buyExactSolIn" || ctx.kind === "buyExactQuoteInV2") {
    for (const ix of topIxs) {
      if (programId(ix.programId, keys) !== PUMP_PROGRAM_ID) continue;
      const spendable = readSpendableFromIxData(ix.data, ctx.kind);
      if (spendable === null || spendable <= 0) continue;

      const amounts = parseAmountsFromBuyInner(tx, ctx);
      const creatorFeeLamports =
        amounts && amounts.bondingLamports + amounts.protocolLamports < spendable
          ? spendable - amounts.bondingLamports - amounts.protocolLamports
          : (amounts?.creatorFeeLamports ?? 0);

      return {
        firstSwapSol: lamportsToSol(spendable),
        firstBuyCreatorFeeSol: lamportsToSol(creatorFeeLamports),
      };
    }
  }

  const amounts = parseAmountsFromBuyInner(tx, ctx);
  if (!amounts) return null;

  return {
    firstSwapSol: lamportsToSol(amounts.swapLamports),
    firstBuyCreatorFeeSol: lamportsToSol(amounts.creatorFeeLamports),
  };
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) return null;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { result?: T; error?: unknown };
  if (data.error || data.result === undefined) return null;
  return data.result;
}

async function getSignaturesOldestFirst(address: string): Promise<string[]> {
  const collected: string[] = [];
  let before: string | undefined;

  while (true) {
    const page = await rpcCall<Array<{ signature: string }>>(
      "getSignaturesForAddress",
      [address, { before, limit: 1000 }]
    );
    if (!page || page.length === 0) break;
    collected.push(...page.map((e) => e.signature));
    before = page[page.length - 1]!.signature;
    if (page.length < 1000) break;
  }

  return collected.reverse();
}

async function fetchRpcTx(signature: string): Promise<RpcTransaction | null> {
  return rpcCall<RpcTransaction>("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
}

function txHasCreateV2(tx: RpcTransaction): boolean {
  const keys = resolveAccountKeys(tx);
  for (const ix of tx.transaction.message.instructions) {
    if (programId(ix.programId, keys) !== PUMP_PROGRAM_ID || !ix.data) continue;
    try {
      if (decodeBase58(ix.data).subarray(0, 8).toString("hex") === CREATE_V2_IX) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function tryParseLaunchTx(signature: string): Promise<(FirstBuyInfo & { isLaunchTx: boolean }) | null> {
  const tx = await fetchRpcTx(signature);
  if (!tx) return null;

  const parsed = parseFirstBuyFromTx(tx);
  if (!parsed) return null;

  return {
    firstTxSignature: signature,
    firstSwapSol: parsed.firstSwapSol,
    firstBuyCreatorFeeSol: parsed.firstBuyCreatorFeeSol,
    isLaunchTx: txHasCreateV2(tx),
  };
}

export async function fetchFirstBuyInfo(mintAddress: string): Promise<FirstBuyInfo | null> {
  if (!getRpcUrl()) return null;

  const bondingCurve = bondingCurvePda(mintAddress);

  let signatures: string[];
  try {
    signatures = await getSignaturesOldestFirst(bondingCurve);
  } catch {
    signatures = [];
  }

  if (signatures.length === 0) {
    try {
      signatures = await getSignaturesOldestFirst(mintAddress);
    } catch {
      return null;
    }
  }

  if (signatures.length === 0) return null;

  const candidates: Array<FirstBuyInfo & { isLaunchTx: boolean }> = [];

  for (const signature of signatures.slice(0, 8)) {
    const info = await tryParseLaunchTx(signature);
    if (info) candidates.push(info);
    await new Promise((r) => setTimeout(r, HELIUS_RPC_DELAY_MS));
  }

  if (candidates.length === 0) return null;

  const launch = candidates.find((c) => c.isLaunchTx);
  if (launch) {
    const { isLaunchTx: _, ...info } = launch;
    return info;
  }

  const { isLaunchTx: _, ...info } = candidates[0]!;
  return info;
}

export const parseBuyExactSolInFromTx = parseFirstBuyFromTx;
