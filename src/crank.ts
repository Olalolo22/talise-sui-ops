import type { Transaction } from "@mysten/sui/transactions";
import { MOVE_STRUCT_TYPES } from "./constants.js";
import type {
  ChequeFields,
  MoveObjectRecord,
  PersonalStreamFields,
  StandingOrderFields,
  SuiGraphQLClient,
  TeamStreamFields,
} from "./graphql.js";
import {
  buildChequeReclaimExpiredTx,
  buildStandingOrderExecuteTx,
  buildStreamClaimAccruedTx,
  buildTeamStreamReleaseTx,
} from "./ptb.js";

export type CrankKind =
  | "standing_order"
  | "team_stream"
  | "stream"
  | "stream_legacy"
  | "cheque_expired"
  | "cheque_expired_legacy";

export type CrankCandidate = {
  kind: CrankKind;
  objectId: string;
  coinType: string;
  recipientOrCreator: string;
  releasableBase: bigint;
  dueTranches: number;
  dueSinceMs: number;
  description: string;
  buildTx: () => Transaction;
};

/** Pure evaluator: determine if a StandingOrder is currently executable. */
export function evaluateStandingOrder(
  rec: MoveObjectRecord<StandingOrderFields>,
  nowMs: number,
): CrankCandidate | null {
  const f = rec.fields;
  if (!rec.coinType || f.cancelled || f.paused) return null;
  const pot = BigInt(f.pot ?? "0");
  const amountPer = BigInt(f.amount_per ?? "0");
  const nextDue = Number(f.next_due_ms ?? "0");
  if (amountPer <= 0n || pot < amountPer || nowMs < nextDue) return null;
  return {
    kind: "standing_order",
    objectId: rec.objectId,
    coinType: rec.coinType,
    recipientOrCreator: f.recipient,
    releasableBase: amountPer,
    dueTranches: 1,
    dueSinceMs: nextDue,
    description: `standing_order::execute_due -> ${f.recipient}`,
    buildTx: () =>
      buildStandingOrderExecuteTx({ orderId: rec.objectId, coinType: rec.coinType! }),
  };
}

/** Pure evaluator: determine if a TeamStream has a due tranche ready for release. */
export function evaluateTeamStream(
  rec: MoveObjectRecord<TeamStreamFields>,
  nowMs: number,
): CrankCandidate | null {
  const f = rec.fields;
  if (!rec.coinType || f.cancelled) return null;
  const num = Number(f.num_tranches ?? "0");
  const done = Number(f.tranches_done ?? "0");
  const remaining = num - done;
  if (remaining <= 0) return null;
  const nextDue = Number(f.next_due_ms ?? "0");
  const interval = Number(f.interval_ms ?? "1");
  const pot = BigInt(f.pot ?? "0");
  const trancheTotal = BigInt(f.tranche_total ?? "0");
  if (nowMs < nextDue || pot < trancheTotal || trancheTotal <= 0n) return null;

  const elapsed = interval > 0 ? Math.floor((nowMs - nextDue) / interval) : 0;
  const dueTranches = Math.min(remaining, elapsed + 1);
  return {
    kind: "team_stream",
    objectId: rec.objectId,
    coinType: rec.coinType,
    recipientOrCreator: `${(f.members ?? []).length} members`,
    releasableBase: trancheTotal,
    dueTranches,
    dueSinceMs: nextDue,
    description: `team_stream::release_due_tranche (${done + 1}/${num}, ${dueTranches} due)`,
    buildTx: () =>
      buildTeamStreamReleaseTx({ streamId: rec.objectId, coinType: rec.coinType! }),
  };
}

/** Pure evaluator: determine if a 1-to-1 Stream has accrued tranches ready to claim. */
export function evaluatePersonalStream(
  rec: MoveObjectRecord<PersonalStreamFields>,
  nowMs: number,
  legacy: boolean,
): CrankCandidate | null {
  const f = rec.fields;
  if (!rec.coinType || f.cancelled || f.paused) return null;
  const num = Number(f.num_tranches ?? "0");
  const done = Number(f.tranches_done ?? "0");
  if (done >= num) return null;
  const start = Number(f.start_ms ?? "0");
  const interval = Number(f.interval_ms ?? "0");
  const nextDue = start + done * interval;
  const escrow = BigInt(f.escrow ?? "0");
  if (nowMs < nextDue || escrow <= 0n) return null;

  const remaining = num - done;
  const elapsed = interval > 0 ? Math.floor((nowMs - nextDue) / interval) : 0;
  const dueTranches = Math.min(remaining, elapsed + 1);
  const trancheAmt = BigInt(f.tranche_amount ?? "0");
  const est =
    dueTranches === remaining ? escrow : BigInt(dueTranches) * trancheAmt;

  return {
    kind: legacy ? "stream_legacy" : "stream",
    objectId: rec.objectId,
    coinType: rec.coinType,
    recipientOrCreator: f.recipient,
    releasableBase: est > escrow ? escrow : est,
    dueTranches,
    dueSinceMs: nextDue,
    description: `${legacy ? "legacy " : ""}stream::claim_accrued -> ${f.recipient} (${dueTranches} due)`,
    buildTx: () =>
      buildStreamClaimAccruedTx({
        streamId: rec.objectId,
        coinType: rec.coinType!,
        legacy,
      }),
  };
}

/** Pure evaluator: determine if an unclaimed Cheque is expired and sweepable back to creator. */
export function evaluateExpiredCheque(
  rec: MoveObjectRecord<ChequeFields>,
  nowMs: number,
  legacy: boolean,
): CrankCandidate | null {
  const f = rec.fields;
  if (!rec.coinType || f.claimed || f.reclaimed) return null;
  const escrow = BigInt(f.escrow ?? "0");
  const expiry = Number(f.expiry_ms ?? "0");
  if (escrow <= 0n || expiry <= 0 || nowMs < expiry) return null;
  return {
    kind: legacy ? "cheque_expired_legacy" : "cheque_expired",
    objectId: rec.objectId,
    coinType: rec.coinType,
    recipientOrCreator: f.creator,
    releasableBase: escrow,
    dueTranches: 1,
    dueSinceMs: expiry,
    description: `${legacy ? "legacy " : ""}cheque::reclaim_expired -> creator ${f.creator}`,
    buildTx: () =>
      buildChequeReclaimExpiredTx({
        chequeId: rec.objectId,
        coinType: rec.coinType!,
        legacy,
      }),
  };
}

export type ScanCrankOptions = {
  nowMs?: number;
  includeLegacy?: boolean;
  maxPerType?: number;
};

/** Scan live Sui mainnet for every permissionless crankable Talise object. */
export async function scanCrankCandidates(
  gql: SuiGraphQLClient,
  opts: ScanCrankOptions = {},
): Promise<CrankCandidate[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const maxPerType = opts.maxPerType ?? 200;
  const includeLegacy = opts.includeLegacy !== false;

  const [orders, teamStreams, streams, cheques, legacyStreams, legacyCheques] =
    await Promise.all([
      gql.listObjectsByType<StandingOrderFields>(MOVE_STRUCT_TYPES.standingOrder, maxPerType),
      gql.listObjectsByType<TeamStreamFields>(MOVE_STRUCT_TYPES.teamStream, maxPerType),
      gql.listObjectsByType<PersonalStreamFields>(MOVE_STRUCT_TYPES.stream, maxPerType),
      gql.listObjectsByType<ChequeFields>(MOVE_STRUCT_TYPES.cheque, maxPerType),
      includeLegacy
        ? gql.listObjectsByType<PersonalStreamFields>(MOVE_STRUCT_TYPES.streamLegacy, maxPerType)
        : Promise.resolve([]),
      includeLegacy
        ? gql.listObjectsByType<ChequeFields>(MOVE_STRUCT_TYPES.chequeLegacy, maxPerType)
        : Promise.resolve([]),
    ]);

  const candidates: CrankCandidate[] = [];
  for (const r of orders) {
    const c = evaluateStandingOrder(r, nowMs);
    if (c) candidates.push(c);
  }
  for (const r of teamStreams) {
    const c = evaluateTeamStream(r, nowMs);
    if (c) candidates.push(c);
  }
  for (const r of streams) {
    const c = evaluatePersonalStream(r, nowMs, false);
    if (c) candidates.push(c);
  }
  for (const r of legacyStreams) {
    const c = evaluatePersonalStream(r, nowMs, true);
    if (c) candidates.push(c);
  }
  for (const r of cheques) {
    const c = evaluateExpiredCheque(r, nowMs, false);
    if (c) candidates.push(c);
  }
  for (const r of legacyCheques) {
    const c = evaluateExpiredCheque(r, nowMs, true);
    if (c) candidates.push(c);
  }

  candidates.sort((a, b) => a.dueSinceMs - b.dueSinceMs);
  return candidates;
}
