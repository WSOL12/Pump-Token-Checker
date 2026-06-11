import { PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_PROGRAM = new PublicKey(PUMP_PROGRAM_ID);
const PUMP_FEE_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const PUMP_FEE_PROGRAM = new PublicKey(PUMP_FEE_PROGRAM_ID);
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SHARING_CONFIG_DISCR = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);
const UPDATE_FEE_SHARES_DISCR = Buffer.from([189, 13, 136, 99, 187, 164, 237, 35]);
const UPDATE_FEE_SHARES_V2_DISCR = Buffer.from([111, 251, 179, 16, 100, 228, 230, 161]);
const CREATE_FEE_SHARING_CONFIG_DISCR = Buffer.from([195, 78, 86, 76, 111, 52, 251, 213]);

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
export type SwapUnit = "SOL" | "USDC";

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

/** Scan this many oldest txs — tx #1 may be CreateFeeSharingConfig before CreateV2+Buy. */
const GTFA_TX_LIMIT = 5;

export const HELIUS_RPC_DELAY_MS = 50;

export interface FeeShareholder {
  address: string;
  shareBps: number;
}

export interface FirstBuyInfo {
  firstTxSignature: string;
  firstSwapAmount: number;
  firstSwapUnit: SwapUnit;
  firstBuyCreatorFeeAmount: number;
  firstBuyCreatorFeeUnit: SwapUnit;
  /** e.g. "Oldest tx #1 was CreateFeeSharingConfig (not the launch buy)" */
  launchNote?: string;
  /** Numeric SOL when swap is SOL; 0 when USDC pair */
  firstSwapSol: number;
  /** Numeric SOL fee when fee is SOL; 0 when USDC pair */
  firstBuyCreatorFeeSol: number;
  /** Coin opted into pump fee-sharing (CreateFeeSharingConfig) */
  hasFeeSharingConfig?: boolean;
  /** Shareholders at launch buy time — `wallet:bps` comma-separated */
  launchFeeShareholders?: string;
  /** Current on-chain shareholders who receive creator fees — `wallet:bps` comma-separated */
  feeShareholders?: string;
}

export function formatFeeShareholders(shareholders: FeeShareholder[]): string {
  return shareholders.map((s) => `${s.address}:${s.shareBps}`).join(",");
}

export function formatFirstSwapDisplay(info: FirstBuyInfo): string {
  if (info.firstSwapUnit === "USDC") {
    return `${info.firstSwapAmount} USDC`;
  }
  return String(info.firstSwapAmount);
}

export function formatCreatorFeeDisplay(info: FirstBuyInfo): string {
  if (info.firstBuyCreatorFeeUnit === "USDC") {
    return `${info.firstBuyCreatorFeeAmount} USDC`;
  }
  return String(info.firstBuyCreatorFeeAmount);
}

export function toLaunchJson(launchInfo: FirstBuyInfo | null | undefined) {
  if (!launchInfo) {
    return {
      firstTxSignature: null,
      firstSwapAmount: null,
      firstSwapUnit: null,
      firstBuyCreatorFeeAmount: null,
      firstBuyCreatorFeeUnit: null,
      firstSwapDisplay: null,
      firstBuyCreatorFeeDisplay: null,
      launchNote: null,
      firstSwapSol: null,
      firstBuyCreatorFeeSol: null,
      hasFeeSharingConfig: null,
      launchFeeShareholders: null,
      feeShareholders: null,
    };
  }

  return {
    firstTxSignature: launchInfo.firstTxSignature,
    firstSwapAmount: launchInfo.firstSwapAmount,
    firstSwapUnit: launchInfo.firstSwapUnit,
    firstBuyCreatorFeeAmount: launchInfo.firstBuyCreatorFeeAmount,
    firstBuyCreatorFeeUnit: launchInfo.firstBuyCreatorFeeUnit,
    firstSwapDisplay: formatFirstSwapDisplay(launchInfo),
    firstBuyCreatorFeeDisplay: formatCreatorFeeDisplay(launchInfo),
    launchNote: launchInfo.launchNote ?? null,
    firstSwapSol: launchInfo.firstSwapUnit === "SOL" ? launchInfo.firstSwapAmount : null,
    firstBuyCreatorFeeSol:
      launchInfo.firstBuyCreatorFeeUnit === "SOL" ? launchInfo.firstBuyCreatorFeeAmount : null,
    hasFeeSharingConfig: launchInfo.hasFeeSharingConfig ?? null,
    launchFeeShareholders: launchInfo.launchFeeShareholders ?? null,
    feeShareholders: launchInfo.feeShareholders ?? null,
  };
}

interface ParsedInstructionInfo {
  source?: string;
  authority?: string;
  destination?: string;
  newAccount?: string;
  mint?: string;
  lamports?: number | string;
  amount?: string;
  tokenAmount?: {
    uiAmount?: number | null;
    uiAmountString?: string;
    amount?: string;
    decimals?: number;
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
          info?: ParsedInstructionInfo;
        };
      }>;
    }>;
  } | null;
}

interface ParsedBuyAmounts {
  firstSwapAmount: number;
  firstSwapUnit: SwapUnit;
  firstBuyCreatorFeeAmount: number;
  firstBuyCreatorFeeUnit: SwapUnit;
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

export function feeSharingConfigPda(mintAddress: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sharing-config"), new PublicKey(mintAddress).toBuffer()],
    PUMP_FEE_PROGRAM
  );
  return pda.toBase58();
}

function discriminatorMatches(data: Buffer, expected: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(expected);
}

export function decodeSharingConfigAccount(data: Buffer): FeeShareholder[] | null {
  if (data.length < 8 || !discriminatorMatches(data, SHARING_CONFIG_DISCR)) {
    return null;
  }

  let offset = 8;
  offset += 1; // bump
  offset += 1; // version
  offset += 1; // status
  offset += 32; // mint
  offset += 32; // admin
  offset += 1; // adminRevoked

  if (offset + 4 > data.length) return null;

  const count = data.readUInt32LE(offset);
  offset += 4;

  const shareholders: FeeShareholder[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 34 > data.length) return null;
    const address = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const shareBps = data.readUInt16LE(offset);
    offset += 2;
    shareholders.push({ address, shareBps });
  }

  return shareholders;
}

function parseShareholdersFromPumpFeesIxData(data: string | undefined): FeeShareholder[] | null {
  if (!data) return null;

  let bytes: Buffer;
  try {
    bytes = decodeBase58(data);
  } catch {
    return null;
  }

  if (
    !discriminatorMatches(bytes, UPDATE_FEE_SHARES_DISCR) &&
    !discriminatorMatches(bytes, UPDATE_FEE_SHARES_V2_DISCR)
  ) {
    return null;
  }

  let offset = 8;
  if (offset + 4 > bytes.length) return null;

  const count = bytes.readUInt32LE(offset);
  offset += 4;

  const shareholders: FeeShareholder[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 34 > bytes.length) return null;
    const address = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const shareBps = bytes.readUInt16LE(offset);
    offset += 2;
    shareholders.push({ address, shareBps });
  }

  return shareholders.length > 0 ? shareholders : null;
}

function txHasLogInstruction(tx: RpcTransaction, instructionName: string): boolean {
  const logs = tx.meta?.logMessages ?? [];
  return logs.some((line) => line.includes(`Instruction: ${instructionName}`));
}

function extractCreateFeeSharingConfigPayer(tx: RpcTransaction): string | null {
  const keys = resolveAccountKeys(tx);

  for (const ix of tx.transaction.message.instructions) {
    if (programId(ix.programId, keys) !== PUMP_FEE_PROGRAM_ID) continue;

    let bytes: Buffer;
    try {
      bytes = decodeBase58(ix.data ?? "");
    } catch {
      continue;
    }

    if (!discriminatorMatches(bytes, CREATE_FEE_SHARING_CONFIG_DISCR)) continue;

    const accounts = resolveAccounts(ix.accounts, keys);
    return accounts[2] ?? null;
  }

  return null;
}

function extractUpdateFeeSharesFromTx(tx: RpcTransaction): FeeShareholder[] | null {
  const keys = resolveAccountKeys(tx);

  for (const ix of tx.transaction.message.instructions) {
    if (programId(ix.programId, keys) !== PUMP_FEE_PROGRAM_ID) continue;

    const shareholders = parseShareholdersFromPumpFeesIxData(ix.data);
    if (shareholders) return shareholders;
  }

  return null;
}

function scanLaunchFeeShareholders(
  txs: Array<{ tx: RpcTransaction; signature: string }>,
  launchBuyIndex: number
): FeeShareholder[] | null {
  let shareholders: FeeShareholder[] | null = null;

  for (let i = 0; i < launchBuyIndex; i++) {
    const { tx } = txs[i]!;

    if (txHasLogInstruction(tx, "CreateFeeSharingConfig")) {
      const payer = extractCreateFeeSharingConfigPayer(tx);
      if (payer) {
        shareholders = [{ address: payer, shareBps: 10_000 }];
      }
    }

    const updated = extractUpdateFeeSharesFromTx(tx);
    if (updated) {
      shareholders = updated;
    }
  }

  return shareholders;
}

async function fetchCurrentFeeShareholders(mintAddress: string): Promise<FeeShareholder[] | null> {
  const { result } = await rpcCallWithError<{ value: { data: [string, string] } | null }>(
    "getAccountInfo",
    [feeSharingConfigPda(mintAddress), { encoding: "base64" }]
  );

  if (!result?.value?.data?.[0]) return null;

  const data = Buffer.from(result.value.data[0], "base64");
  return decodeSharingConfigAccount(data);
}

async function buildFeeSharingFields(
  mintAddress: string,
  txs: Array<{ tx: RpcTransaction; signature: string }>,
  launchBuyIndex: number
): Promise<Pick<FirstBuyInfo, "hasFeeSharingConfig" | "launchFeeShareholders" | "feeShareholders">> {
  const launchShareholders = scanLaunchFeeShareholders(txs, launchBuyIndex);
  const currentShareholders = await fetchCurrentFeeShareholders(mintAddress);

  const hadCreateBeforeLaunch = txs
    .slice(0, launchBuyIndex)
    .some(({ tx }) => txHasLogInstruction(tx, "CreateFeeSharingConfig"));

  const hasFeeSharingConfig = hadCreateBeforeLaunch || currentShareholders !== null;

  return {
    hasFeeSharingConfig,
    launchFeeShareholders: launchShareholders
      ? formatFeeShareholders(launchShareholders)
      : undefined,
    feeShareholders: currentShareholders
      ? formatFeeShareholders(currentShareholders)
      : undefined,
  };
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

function payerMatches(info: ParsedInstructionInfo | undefined, user: string): boolean {
  if (!info) return false;
  return info.source === user || info.authority === user;
}

function tokenAmountToNumber(info: ParsedInstructionInfo): number {
  const ta = info.tokenAmount;
  if (ta?.uiAmount != null) return ta.uiAmount;
  if (ta?.uiAmountString) return parseFloat(ta.uiAmountString);
  const decimals = ta?.decimals ?? 6;
  if (info.amount) return Number(info.amount) / 10 ** decimals;
  if (ta?.amount) return Number(ta.amount) / 10 ** decimals;
  return 0;
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

/** Non-buy pump instruction seen before the launch buy (e.g. CreateFeeSharingConfig). */
export function detectSkippedTxPurpose(tx: RpcTransaction): string | null {
  const logs = tx.meta?.logMessages ?? [];
  const seen = new Set<string>();

  for (const line of logs) {
    const match = line.match(/Instruction: (\w+)/);
    if (!match) continue;
    const name = match[1]!;
    if (
      name === "Buy" ||
      name === "BuyV2" ||
      name === "BuyExactSolIn" ||
      name === "BuyExactQuoteInV2" ||
      name === "CreateV2"
    ) {
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      return name;
    }
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

function buyLegHasUsdcTransfers(tx: RpcTransaction, ctx: BuyContext): boolean {
  if (!tx.meta?.innerInstructions) return false;

  const innerGroup = tx.meta.innerInstructions.find((g) => g.index === ctx.ixIndex);
  if (!innerGroup) return false;

  for (const ix of innerGroup.instructions) {
    const p = ix.parsed;
    if (
      p?.type === "transferChecked" &&
      p.info?.mint === USDC_MINT &&
      payerMatches(p.info, ctx.user)
    ) {
      return true;
    }
  }

  return false;
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

function parseAmountsFromBuyInnerSol(
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
    if (!payerMatches(p?.info, ctx.user)) continue;

    if (p?.type === "transfer" && p.info?.destination) {
      payerTransfers.push({
        destination: p.info.destination,
        lamports: Number(p.info.lamports ?? 0),
      });
    }

    if (p?.type === "createAccount" && p.info?.newAccount === ctx.userVolumeAccumulator) {
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

function parseAmountsFromBuyInnerUsdc(
  tx: RpcTransaction,
  ctx: BuyContext
): { swapUsdc: number; creatorFeeUsdc: number } | null {
  if (!tx.meta?.innerInstructions) return null;

  const innerGroup = tx.meta.innerInstructions.find((g) => g.index === ctx.ixIndex);
  if (!innerGroup) return null;

  const payerTransfers: Array<{ destination: string; amount: number }> = [];

  for (const ix of innerGroup.instructions) {
    const p = ix.parsed;
    if (!payerMatches(p?.info, ctx.user)) continue;

    if (p?.type === "transferChecked" && p.info?.mint === USDC_MINT && p.info.destination) {
      payerTransfers.push({
        destination: p.info.destination,
        amount: tokenAmountToNumber(p.info),
      });
    }
  }

  if (payerTransfers.length === 0) return null;

  const vaultTransfers = payerTransfers
    .filter((t) => t.destination === ctx.creatorVault)
    .map((t) => t.amount);

  const protocolMicro = findProtocolDestinations(
    payerTransfers.map((t) => Math.round(t.amount * 1_000_000))
  );

  const nonProtocol = payerTransfers.filter(
    (t) => !protocolMicro.has(Math.round(t.amount * 1_000_000))
  );

  let creatorFeeUsdc = 0;
  if (vaultTransfers.length >= 1) {
    creatorFeeUsdc = Math.min(...vaultTransfers);
  } else if (nonProtocol.length >= 2) {
    // Smallest non-protocol USDC leg is typically the creator fee (~0.3% of swap)
    creatorFeeUsdc = Math.min(...nonProtocol.map((t) => t.amount));
  }

  const swapUsdc = payerTransfers.reduce((sum, t) => sum + t.amount, 0);

  if (swapUsdc <= 0) return null;

  return { swapUsdc, creatorFeeUsdc };
}

export function parseFirstBuyFromTx(tx: RpcTransaction): ParsedBuyAmounts | null {
  if (!tx.meta || tx.meta.err) return null;

  const ctx = findBuyContext(tx);
  if (!ctx) return null;

  const keys = resolveAccountKeys(tx);
  const topIxs = tx.transaction.message.instructions;
  const isUsdcQuote = buyLegHasUsdcTransfers(tx, ctx);

  if (isUsdcQuote) {
    if (ctx.kind === "buyExactQuoteInV2") {
      for (const ix of topIxs) {
        if (programId(ix.programId, keys) !== PUMP_PROGRAM_ID) continue;
        const spendableMicro = readSpendableFromIxData(ix.data, ctx.kind);
        if (spendableMicro === null || spendableMicro <= 0) continue;

        const amounts = parseAmountsFromBuyInnerUsdc(tx, ctx);
        if (!amounts) continue;

        return {
          firstSwapAmount: amounts.swapUsdc,
          firstSwapUnit: "USDC",
          firstBuyCreatorFeeAmount: amounts.creatorFeeUsdc,
          firstBuyCreatorFeeUnit: "USDC",
        };
      }
    }

    const usdcAmounts = parseAmountsFromBuyInnerUsdc(tx, ctx);
    if (!usdcAmounts) return null;

    return {
      firstSwapAmount: usdcAmounts.swapUsdc,
      firstSwapUnit: "USDC",
      firstBuyCreatorFeeAmount: usdcAmounts.creatorFeeUsdc,
      firstBuyCreatorFeeUnit: "USDC",
    };
  }

  if (ctx.kind === "buyExactQuoteInV2" || ctx.kind === "buyExactSolIn") {
    for (const ix of topIxs) {
      if (programId(ix.programId, keys) !== PUMP_PROGRAM_ID) continue;
      const spendable = readSpendableFromIxData(ix.data, ctx.kind);
      if (spendable === null || spendable <= 0) continue;

      const amounts = parseAmountsFromBuyInnerSol(tx, ctx);
      const creatorFeeLamports =
        amounts && amounts.bondingLamports + amounts.protocolLamports < spendable
          ? spendable - amounts.bondingLamports - amounts.protocolLamports
          : (amounts?.creatorFeeLamports ?? 0);

      return {
        firstSwapAmount: lamportsToSol(spendable),
        firstSwapUnit: "SOL",
        firstBuyCreatorFeeAmount: lamportsToSol(creatorFeeLamports),
        firstBuyCreatorFeeUnit: "SOL",
      };
    }
  }

  const amounts = parseAmountsFromBuyInnerSol(tx, ctx);
  if (!amounts) return null;

  return {
    firstSwapAmount: lamportsToSol(amounts.swapLamports),
    firstSwapUnit: "SOL",
    firstBuyCreatorFeeAmount: lamportsToSol(amounts.creatorFeeLamports),
    firstBuyCreatorFeeUnit: "SOL",
  };
}

function buildFirstBuyInfo(
  signature: string,
  parsed: ParsedBuyAmounts,
  launchNote?: string
): FirstBuyInfo {
  return {
    firstTxSignature: signature,
    firstSwapAmount: parsed.firstSwapAmount,
    firstSwapUnit: parsed.firstSwapUnit,
    firstBuyCreatorFeeAmount: parsed.firstBuyCreatorFeeAmount,
    firstBuyCreatorFeeUnit: parsed.firstBuyCreatorFeeUnit,
    launchNote,
    firstSwapSol: parsed.firstSwapUnit === "SOL" ? parsed.firstSwapAmount : 0,
    firstBuyCreatorFeeSol: parsed.firstBuyCreatorFeeUnit === "SOL" ? parsed.firstBuyCreatorFeeAmount : 0,
  };
}

async function rpcCallWithError<T>(
  method: string,
  params: unknown[]
): Promise<{ result: T | null; error: { code: number; message: string } | null }> {
  const rpcUrl = getRpcUrl();
  if (!rpcUrl) return { result: null, error: null };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) return { result: null, error: null };

  const data = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (data.error) {
    return { result: null, error: data.error };
  }

  return { result: data.result ?? null, error: null };
}

interface GtfaTxItem {
  slot: number;
  transactionIndex: number;
  blockTime: number | null;
  signature?: string;
  transaction: RpcTransaction["transaction"] & { signatures?: string[] };
  meta: RpcTransaction["meta"];
}

interface GtfaResult {
  data: GtfaTxItem[];
  paginationToken: string | null;
}

async function fetchOldestTransactionsViaGtfa(
  address: string,
  limit: number = GTFA_TX_LIMIT
): Promise<{
  txs: Array<{ tx: RpcTransaction; signature: string }>;
  error: string | null;
}> {
  const { result, error } = await rpcCallWithError<GtfaResult>("getTransactionsForAddress", [
    address,
    {
      sortOrder: "asc",
      limit,
      transactionDetails: "full",
      encoding: "jsonParsed",
      commitment: "confirmed",
    },
  ]);

  if (error) {
    return { txs: [], error: error.message };
  }

  if (!result?.data.length) {
    return { txs: [], error: null };
  }

  const txs = result.data
    .map((item) => {
      const signature = item.signature ?? item.transaction?.signatures?.[0] ?? "";
      if (!signature) return null;
      return {
        tx: { transaction: item.transaction, meta: item.meta } satisfies RpcTransaction,
        signature,
      };
    })
    .filter((item): item is { tx: RpcTransaction; signature: string } => item !== null);

  return { txs, error: null };
}

interface PickedLaunch {
  info: FirstBuyInfo;
  launchBuyIndex: number;
}

function pickLaunchFromOldestTxs(
  txs: Array<{ tx: RpcTransaction; signature: string }>
): PickedLaunch | null {
  const skippedNotes: string[] = [];

  for (let i = 0; i < txs.length; i++) {
    const { tx, signature } = txs[i]!;
    const parsed = parseFirstBuyFromTx(tx);

    if (!parsed) {
      const purpose = detectSkippedTxPurpose(tx);
      if (purpose) {
        skippedNotes.push(`Oldest tx #${i + 1} was ${purpose} (not the launch buy)`);
      }
      continue;
    }

    const launchNote =
      skippedNotes.length > 0 ? skippedNotes.join("; ") : undefined;

    return { info: buildFirstBuyInfo(signature, parsed, launchNote), launchBuyIndex: i };
  }

  return null;
}

export async function fetchFirstBuyInfo(mintAddress: string): Promise<FirstBuyInfo | null> {
  if (!getRpcUrl()) return null;

  const { txs: mintTxs, error: mintError } = await fetchOldestTransactionsViaGtfa(mintAddress);
  if (mintError) {
    console.error(`    ⚠ gTFA error: ${mintError}`);
    return null;
  }

  let picked = pickLaunchFromOldestTxs(mintTxs);

  if (!picked) {
    const { txs: bcTxs, error: bcError } = await fetchOldestTransactionsViaGtfa(
      bondingCurvePda(mintAddress)
    );
    if (bcError) {
      console.error(`    ⚠ gTFA error: ${bcError}`);
      return null;
    }
    picked = pickLaunchFromOldestTxs(bcTxs);
  }

  if (!picked) return null;

  const feeSharing = await buildFeeSharingFields(mintAddress, mintTxs, picked.launchBuyIndex);
  return { ...picked.info, ...feeSharing };
}

export const parseBuyExactSolInFromTx = parseFirstBuyFromTx;
