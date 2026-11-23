import { normalizeSuiAddress } from "@mysten/sui/utils";
import { MOVE_STRUCT_TYPES } from "./constants.js";
import {
  evaluateExpiredCheque,
  evaluatePersonalStream,
  evaluateStandingOrder,
  evaluateTeamStream,
} from "./crank.js";
import type {
  ChequeFields,
  GoalVaultFields,
  MoveObjectRecord,
  PersonalStreamFields,
  StandingOrderFields,
  SuiGraphQLClient,
  TeamFields,
  TeamStreamFields,
} from "./graphql.js";

export type AuditFindingSeverity = "info" | "warning" | "actionable";

export type WalletAuditFinding = {
  severity: AuditFindingSeverity;
  category:
    | "reclaimable_dust"
    | "overdue_stream"
    | "expired_cheque"
    | "due_standing_order"
    | "goal_owner_mismatch"
    | "destroyable_stream";
  objectId: string;
  coinType: string | null;
  amountBase: string;
  summary: string;
  recommendedAction: string;
};

export type WalletAuditReport = {
  address: string;
  checkedAt: string;
  counts: {
    teamsOwned: number;
    teamStreamsCreated: number;
    standingOrdersOwned: number;
    personalStreamsInvolved: number;
    chequesCreated: number;
    goalVaultsHeld: number;
  };
  findings: WalletAuditFinding[];
};

export function analyzeWalletObjects(params: {
  address: string;
  nowMs: number;
  teams: MoveObjectRecord<TeamFields>[];
  teamStreams: MoveObjectRecord<TeamStreamFields>[];
  standingOrders: MoveObjectRecord<StandingOrderFields>[];
  streams: { rec: MoveObjectRecord<PersonalStreamFields>; legacy: boolean }[];
  cheques: { rec: MoveObjectRecord<ChequeFields>; legacy: boolean }[];
  goalVaults: MoveObjectRecord<GoalVaultFields>[];
}): WalletAuditReport {
  const addr = normalizeSuiAddress(params.address);
  const findings: WalletAuditFinding[] = [];

  const teamsOwned = params.teams.filter((t) => normalizeSuiAddress(t.fields.owner) === addr);
  const teamStreamsCreated = params.teamStreams.filter(
    (s) => normalizeSuiAddress(s.fields.creator) === addr,
  );
  const standingOrdersOwned = params.standingOrders.filter(
    (o) => normalizeSuiAddress(o.fields.owner) === addr,
  );
  const streamsInvolved = params.streams.filter(
    ({ rec }) =>
      normalizeSuiAddress(rec.fields.sender) === addr ||
      normalizeSuiAddress(rec.fields.recipient) === addr,
  );
  const chequesCreated = params.cheques.filter(
    ({ rec }) => normalizeSuiAddress(rec.fields.creator) === addr,
  );
  const goalVaultsHeld = params.goalVaults.filter(
    (g) =>
      (g.ownerAddress && normalizeSuiAddress(g.ownerAddress) === addr) ||
      normalizeSuiAddress(g.fields.owner) === addr,
  );

  for (const s of teamStreamsCreated) {
    const f = s.fields;
    const pot = BigInt(f.pot ?? "0");
    const num = BigInt(f.num_tranches ?? "0");
    const done = BigInt(f.tranches_done ?? "0");
    const trancheTotal = BigInt(f.tranche_total ?? "0");
    const owed = trancheTotal * (num > done ? num - done : 0n);
    const dust = pot > owed ? pot - owed : 0n;

    if (f.cancelled && pot === 0n) {
      findings.push({
        severity: "info",
        category: "destroyable_stream",
        objectId: s.objectId,
        coinType: s.coinType,
        amountBase: "0",
        summary: "Completed/cancelled TeamStream can be destroyed to reclaim Sui storage rebate.",
        recommendedAction: `talise-sui payroll stream-destroy ${s.objectId}`,
      });
    } else if (!f.cancelled && done >= num && dust > 0n) {
      findings.push({
        severity: "actionable",
        category: "reclaimable_dust",
        objectId: s.objectId,
        coinType: s.coinType,
        amountBase: dust.toString(),
        summary: `Completed TeamStream holds ${dust.toString()} base units of reclaimable rounding dust.`,
        recommendedAction: `talise-sui payroll stream-cancel ${s.objectId}`,
      });
    }

    const due = evaluateTeamStream(s, params.nowMs);
    if (due) {
      findings.push({
        severity: "actionable",
        category: "overdue_stream",
        objectId: s.objectId,
        coinType: s.coinType,
        amountBase: due.releasableBase.toString(),
        summary: `TeamStream has ${due.dueTranches} due tranche(s) ready for permissionless release.`,
        recommendedAction: `talise-sui crank --only ${s.objectId}`,
      });
    }
  }

  for (const o of standingOrdersOwned) {
    const due = evaluateStandingOrder(o, params.nowMs);
    if (due) {
      findings.push({
        severity: "actionable",
        category: "due_standing_order",
        objectId: o.objectId,
        coinType: o.coinType,
        amountBase: due.releasableBase.toString(),
        summary: `StandingOrder to ${o.fields.recipient} is due for release.`,
        recommendedAction: `talise-sui crank --only ${o.objectId}`,
      });
    }
  }

  for (const { rec, legacy } of streamsInvolved) {
    const due = evaluatePersonalStream(rec, params.nowMs, legacy);
    if (due) {
      findings.push({
        severity: "actionable",
        category: "overdue_stream",
        objectId: rec.objectId,
        coinType: rec.coinType,
        amountBase: due.releasableBase.toString(),
        summary: `1-to-1 Stream (${legacy ? "legacy" : "v2"}) has ${due.dueTranches} accrued tranche(s) unclaimed.`,
        recommendedAction: `talise-sui crank --only ${rec.objectId}`,
      });
    }
  }

  for (const { rec, legacy } of chequesCreated) {
    if (!legacy) {
      const exp = evaluateExpiredCheque(rec, params.nowMs);
      if (exp) {
        findings.push({
          severity: "actionable",
          category: "expired_cheque",
          objectId: rec.objectId,
          coinType: rec.coinType,
          amountBase: exp.releasableBase.toString(),
          summary: "Expired unclaimed Cheque (v2) can be swept back to creator permissionlessly.",
          recommendedAction: `talise-sui crank --only ${rec.objectId}`,
        });
      }
      continue;
    }

    const f = rec.fields;
    const escrow = BigInt(f.escrow ?? "0");
    const expiry = Number(f.expiry_ms ?? "0");
    if (!f.claimed && !f.reclaimed && escrow > 0n && expiry > 0 && params.nowMs >= expiry) {
      findings.push({
        severity: "actionable",
        category: "expired_cheque",
        objectId: rec.objectId,
        coinType: rec.coinType,
        amountBase: escrow.toString(),
        summary:
          "Expired unclaimed legacy v1 Cheque can be reclaimed by its creator (legacy package has no permissionless reclaim_expired).",
        recommendedAction:
          `Sign 0x4ba838c7...::cheque::reclaim from creator wallet for object ${rec.objectId}`,
      });
    }
  }

  for (const g of goalVaultsHeld) {
    const recordedOwner = normalizeSuiAddress(g.fields.owner);
    if (g.ownerAddress && normalizeSuiAddress(g.ownerAddress) !== recordedOwner) {
      findings.push({
        severity: "warning",
        category: "goal_owner_mismatch",
        objectId: g.objectId,
        coinType: g.coinType,
        amountBase: String(g.fields.principal ?? "0"),
        summary: `GoalVault "${g.fields.name}" holder (${g.ownerAddress}) differs from recorded vault.owner (${recordedOwner}).`,
        recommendedAction:
          "Transfer the GoalVault object back to recorded vault.owner so they can call goal_vault::transfer_ownership.",
      });
    }
  }

  return {
    address: addr,
    checkedAt: new Date(params.nowMs).toISOString(),
    counts: {
      teamsOwned: teamsOwned.length,
      teamStreamsCreated: teamStreamsCreated.length,
      standingOrdersOwned: standingOrdersOwned.length,
      personalStreamsInvolved: streamsInvolved.length,
      chequesCreated: chequesCreated.length,
      goalVaultsHeld: goalVaultsHeld.length,
    },
    findings,
  };
}

export async function auditWalletOnMainnet(
  gql: SuiGraphQLClient,
  address: string,
  maxPerType = 200,
): Promise<WalletAuditReport> {
  const [teams, teamStreams, standingOrders, streams, legacyStreams, cheques, legacyCheques, goalVaults] =
    await Promise.all([
      gql.listObjectsByType<TeamFields>(MOVE_STRUCT_TYPES.team, maxPerType),
      gql.listObjectsByType<TeamStreamFields>(MOVE_STRUCT_TYPES.teamStream, maxPerType),
      gql.listObjectsByType<StandingOrderFields>(MOVE_STRUCT_TYPES.standingOrder, maxPerType),
      gql.listObjectsByType<PersonalStreamFields>(MOVE_STRUCT_TYPES.stream, maxPerType),
      gql.listObjectsByType<PersonalStreamFields>(MOVE_STRUCT_TYPES.streamLegacy, maxPerType),
      gql.listObjectsByType<ChequeFields>(MOVE_STRUCT_TYPES.cheque, maxPerType),
      gql.listObjectsByType<ChequeFields>(MOVE_STRUCT_TYPES.chequeLegacy, maxPerType),
      gql.listObjectsByType<GoalVaultFields>(MOVE_STRUCT_TYPES.goalVault, maxPerType),
    ]);

  return analyzeWalletObjects({
    address,
    nowMs: Date.now(),
    teams,
    teamStreams,
    standingOrders,
    streams: [
      ...streams.map((rec) => ({ rec, legacy: false })),
      ...legacyStreams.map((rec) => ({ rec, legacy: true })),
    ],
    cheques: [
      ...cheques.map((rec) => ({ rec, legacy: false })),
      ...legacyCheques.map((rec) => ({ rec, legacy: true })),
    ],
    goalVaults,
  });
}
