import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  COIN_TYPES,
  SUI_CLOCK_OBJECT_ID,
  TALISE_MAINNET_PACKAGES,
  TALISE_MAINNET_REGISTRIES,
} from "./constants.js";
import type { CoinObject } from "./graphql.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

function assertNonZeroAddress(addr: string, label: string): string {
  const norm = normalizeSuiAddress(addr);
  if (norm === ZERO_ADDRESS) {
    throw new Error(`${label} cannot be the zero address (${ZERO_ADDRESS})`);
  }
  return norm;
}

/**
 * Prepare a single `Coin<coinType>` holding exactly `amount` base units.
 * Uses `tx.gas` when funding with SUI, or merges/splits caller's owned coins.
 */
function prepareFundingCoin(
  tx: Transaction,
  coinType: string,
  amount: bigint,
  ownedCoins: CoinObject[],
) {
  if (amount <= 0n) throw new Error("Funding amount must be positive");
  const isSui =
    coinType === COIN_TYPES.SUI || coinType.toLowerCase() === "0x2::sui::sui";
  if (isSui && ownedCoins.length === 0) {
    const [split] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
    return split;
  }
  const total = ownedCoins.reduce((acc, c) => acc + c.balance, 0n);
  if (ownedCoins.length === 0 || total < amount) {
    throw new Error(
      `Insufficient ${coinType} balance: need ${amount.toString()} base units, have ${total.toString()}`,
    );
  }
  const primary = tx.object(ownedCoins[0]!.objectId);
  if (ownedCoins.length > 1) {
    let running = ownedCoins[0]!.balance;
    const toMerge = [];
    for (let i = 1; i < ownedCoins.length && running < amount; i++) {
      toMerge.push(tx.object(ownedCoins[i]!.objectId));
      running += ownedCoins[i]!.balance;
    }
    if (toMerge.length > 0) {
      tx.mergeCoins(primary, toMerge);
    }
  }
  const [split] = tx.splitCoins(primary, [tx.pure.u64(amount)]);
  return split;
}

// ── 1. On-chain Team Rosters (talise-payroll v2) ─────────────────────────────

export function buildTeamCreateTx(params: {
  name: string;
  members: { recipient: string; amountMicro: bigint; label: string }[];
  packageId?: string;
}): Transaction {
  if (params.members.length === 0 || params.members.length > 256) {
    throw new Error("Team must have between 1 and 256 members");
  }
  const seen = new Set<string>();
  const recipients: string[] = [];
  const amounts: bigint[] = [];
  const labels: string[] = [];

  for (const m of params.members) {
    const norm = assertNonZeroAddress(m.recipient, "member recipient");
    if (seen.has(norm)) throw new Error(`Duplicate team member address: ${norm}`);
    seen.add(norm);
    recipients.push(norm);
    amounts.push(m.amountMicro);
    labels.push(m.label);
  }

  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payroll.latestId;
  tx.moveCall({
    target: `${pkg}::payroll::create`,
    arguments: [
      tx.pure.string(params.name),
      tx.pure.vector("address", recipients),
      tx.pure.vector("u64", amounts),
      tx.pure.vector("string", labels),
    ],
  });
  return tx;
}

export function buildTeamSetRosterTx(params: {
  teamId: string;
  name: string;
  members: { recipient: string; amountMicro: bigint; label: string }[];
  packageId?: string;
}): Transaction {
  if (params.members.length === 0 || params.members.length > 256) {
    throw new Error("Team must have between 1 and 256 members");
  }
  const seen = new Set<string>();
  const recipients: string[] = [];
  const amounts: bigint[] = [];
  const labels: string[] = [];

  for (const m of params.members) {
    const norm = assertNonZeroAddress(m.recipient, "member recipient");
    if (seen.has(norm)) throw new Error(`Duplicate team member address: ${norm}`);
    seen.add(norm);
    recipients.push(norm);
    amounts.push(m.amountMicro);
    labels.push(m.label);
  }

  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payroll.latestId;
  tx.moveCall({
    target: `${pkg}::payroll::set_roster`,
    arguments: [
      tx.object(params.teamId),
      tx.pure.string(params.name),
      tx.pure.vector("address", recipients),
      tx.pure.vector("u64", amounts),
      tx.pure.vector("string", labels),
    ],
  });
  return tx;
}

export function buildTeamDeleteTx(params: {
  teamId: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payroll.latestId;
  tx.moveCall({
    target: `${pkg}::payroll::delete`,
    arguments: [tx.object(params.teamId)],
  });
  return tx;
}

// ── 2. Team Payroll Streams (talise-payroll-streams v2) ──────────────────────

export function buildTeamStreamCreateTx(params: {
  coinType: string;
  fundedBase: bigint;
  ownedCoins: CoinObject[];
  members: string[];
  numTranches: number;
  intervalMs: number;
  firstDueMs: number;
  creatorAddress?: string;
  registryId?: string;
  packageId?: string;
}): Transaction {
  if (params.members.length === 0 || params.members.length > 50) {
    throw new Error("TeamStream requires 1..50 members");
  }
  if (!Number.isInteger(params.numTranches) || params.numTranches < 1 || params.numTranches > 365) {
    throw new Error("numTranches must be 1..365");
  }
  if (params.intervalMs < 3_600_000 || params.intervalMs > 31_536_000_000) {
    throw new Error("create_v2 requires intervalMs between 1 hour (3,600,000 ms) and 365 days");
  }
  const seen = new Set<string>();
  const members = params.members.map((m) => {
    const norm = assertNonZeroAddress(m, "stream member");
    if (params.creatorAddress && norm === normalizeSuiAddress(params.creatorAddress)) {
      throw new Error(`Creator cannot be a TeamStream member: ${norm}`);
    }
    if (seen.has(norm)) throw new Error(`Duplicate TeamStream member: ${norm}`);
    seen.add(norm);
    return norm;
  });

  const tx = new Transaction();
  const fundingCoin = prepareFundingCoin(tx, params.coinType, params.fundedBase, params.ownedCoins);
  const balance = tx.moveCall({
    target: "0x2::coin::into_balance",
    typeArguments: [params.coinType],
    arguments: [fundingCoin],
  });

  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payrollStreams.latestId;
  const reg = params.registryId ?? TALISE_MAINNET_REGISTRIES.teamStreamRegistry;

  tx.moveCall({
    target: `${pkg}::team_stream::create_v2`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(reg),
      balance,
      tx.pure.vector("address", members),
      tx.pure.u64(params.numTranches),
      tx.pure.u64(params.intervalMs),
      tx.pure.u64(params.firstDueMs),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** Permissionless crank call: release one due tranche to the hardwired roster. */
export function buildTeamStreamReleaseTx(params: {
  streamId: string;
  coinType: string;
  registryId?: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payrollStreams.latestId;
  const reg = params.registryId ?? TALISE_MAINNET_REGISTRIES.teamStreamRegistry;
  tx.moveCall({
    target: `${pkg}::team_stream::release_due_tranche`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(reg),
      tx.object(params.streamId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** Creator-only vesting-safe cancel (`cancel_v2`): refunds only unvested remainder + dust. */
export function buildTeamStreamCancelTx(params: {
  streamId: string;
  coinType: string;
  refundRecipient: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payrollStreams.latestId;
  const refundCoin = tx.moveCall({
    target: `${pkg}::team_stream::cancel_v2`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.streamId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  tx.transferObjects([refundCoin], tx.pure.address(assertNonZeroAddress(params.refundRecipient, "refundRecipient")));
  return tx;
}

/** Creator-only post-completion destroy to reclaim Sui storage rebate. */
export function buildTeamStreamDestroyTx(params: {
  streamId: string;
  coinType: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.payrollStreams.latestId;
  tx.moveCall({
    target: `${pkg}::team_stream::destroy`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.streamId)],
  });
  return tx;
}

// ── 3. Standing Orders (talise-automations v3) ───────────────────────────────

export function buildStandingOrderCreateTx(params: {
  coinType: string;
  fundedBase: bigint;
  ownedCoins: CoinObject[];
  recipient: string;
  amountPerBase: bigint;
  intervalMs: number;
  firstDueMs: number;
  registryId?: string;
  packageId?: string;
}): Transaction {
  if (params.intervalMs < 60_000 || params.intervalMs > 366 * 24 * 3_600_000) {
    throw new Error("StandingOrder intervalMs must be between 60,000 ms (1 min) and 366 days");
  }
  if (params.fundedBase < params.amountPerBase) {
    throw new Error("Initial funding must cover at least one release (fundedBase >= amountPerBase)");
  }
  const recipient = assertNonZeroAddress(params.recipient, "standing order recipient");
  const tx = new Transaction();
  const fundingCoin = prepareFundingCoin(tx, params.coinType, params.fundedBase, params.ownedCoins);
  const balance = tx.moveCall({
    target: "0x2::coin::into_balance",
    typeArguments: [params.coinType],
    arguments: [fundingCoin],
  });

  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.automations.latestId;
  const reg = params.registryId ?? TALISE_MAINNET_REGISTRIES.automationRegistry;

  tx.moveCall({
    target: `${pkg}::standing_order::create_v2`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(reg),
      balance,
      tx.pure.address(recipient),
      tx.pure.u64(params.amountPerBase),
      tx.pure.u64(params.intervalMs),
      tx.pure.u64(params.firstDueMs),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** Permissionless crank call: release one due standing order payment to hardwired recipient. */
export function buildStandingOrderExecuteTx(params: {
  orderId: string;
  coinType: string;
  registryId?: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.automations.latestId;
  const reg = params.registryId ?? TALISE_MAINNET_REGISTRIES.automationRegistry;
  tx.moveCall({
    target: `${pkg}::standing_order::execute_due`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(reg),
      tx.object(params.orderId),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildStandingOrderPauseTx(params: {
  orderId: string;
  coinType: string;
  pause: boolean;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.automations.latestId;
  tx.moveCall({
    target: `${pkg}::standing_order::${params.pause ? "pause" : "resume"}`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.orderId)],
  });
  return tx;
}

export function buildStandingOrderCancelTx(params: {
  orderId: string;
  coinType: string;
  refundRecipient: string;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg = params.packageId ?? TALISE_MAINNET_PACKAGES.automations.latestId;
  const refundCoin = tx.moveCall({
    target: `${pkg}::standing_order::cancel`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.orderId)],
  });
  tx.transferObjects([refundCoin], tx.pure.address(assertNonZeroAddress(params.refundRecipient, "refundRecipient")));
  return tx;
}

// ── 4. Permissionless 1-to-1 Stream Claim & Expired Cheque Sweep (talise-pay) ─

export function buildStreamClaimAccruedTx(params: {
  streamId: string;
  coinType: string;
  legacy?: boolean;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg =
    params.packageId ??
    (params.legacy
      ? TALISE_MAINNET_PACKAGES.payLegacy.latestId
      : TALISE_MAINNET_PACKAGES.pay.latestId);
  tx.moveCall({
    target: `${pkg}::stream::claim_accrued`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.streamId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildChequeReclaimExpiredTx(params: {
  chequeId: string;
  coinType: string;
  legacy?: boolean;
  packageId?: string;
}): Transaction {
  const tx = new Transaction();
  const pkg =
    params.packageId ??
    (params.legacy
      ? TALISE_MAINNET_PACKAGES.payLegacy.latestId
      : TALISE_MAINNET_PACKAGES.pay.latestId);
  tx.moveCall({
    target: `${pkg}::cheque::reclaim_expired`,
    typeArguments: [params.coinType],
    arguments: [tx.object(params.chequeId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

// ── 5. Atomic Multi-Recipient Payout PTB (with optional talise::send_v2 receipts)

export function buildAtomicBatchSendTx(params: {
  coinType: string;
  assetSymbol: string;
  ownedCoins: CoinObject[];
  legs: { recipient: string; amountBase: bigint; memo?: string }[];
  withOnChainReceipt?: boolean;
  talisePackageId?: string;
}): Transaction {
  if (params.legs.length === 0) throw new Error("Batch send requires at least one leg");
  if (params.legs.length > 100) {
    throw new Error("Chunk atomic batch sends to at most 100 recipients per PTB");
  }
  const total = params.legs.reduce((acc, l) => {
    if (l.amountBase <= 0n) throw new Error("Every leg amount must be positive");
    return acc + l.amountBase;
  }, 0n);

  const tx = new Transaction();
  const fundingPool = prepareFundingCoin(tx, params.coinType, total, params.ownedCoins);
  const splitCoins = tx.splitCoins(
    fundingPool,
    params.legs.map((l) => tx.pure.u64(l.amountBase)),
  );
  // Destroy the empty 0-balance remainder coin cleanly.
  tx.moveCall({
    target: "0x2::coin::destroy_zero",
    typeArguments: [params.coinType],
    arguments: [fundingPool],
  });

  const pkg = params.talisePackageId ?? TALISE_MAINNET_PACKAGES.talise.latestId;
  for (let i = 0; i < params.legs.length; i++) {
    const leg = params.legs[i]!;
    const recipient = assertNonZeroAddress(leg.recipient, `leg[${i}] recipient`);
    if (params.withOnChainReceipt) {
      // Verified live signature on talise v9:
      // send_v2<T>(coin: Coin<T>, asset: String, memo: String, recipient: address, clock: &Clock)
      const memo = (leg.memo ?? "").slice(0, 80);
      tx.moveCall({
        target: `${pkg}::send::send_v2`,
        typeArguments: [params.coinType],
        arguments: [
          splitCoins[i]!,
          tx.pure.string(params.assetSymbol),
          tx.pure.string(memo),
          tx.pure.address(recipient),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    } else {
      tx.transferObjects([splitCoins[i]!], tx.pure.address(recipient));
    }
  }
  return tx;
}
