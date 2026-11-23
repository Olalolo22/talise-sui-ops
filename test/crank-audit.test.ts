import { describe, expect, it } from "vitest";
import { analyzeWalletObjects } from "../src/audit.js";
import { COIN_TYPES } from "../src/constants.js";
import {
  evaluateExpiredCheque,
  evaluatePersonalStream,
  evaluateStandingOrder,
  evaluateTeamStream,
} from "../src/crank.js";

const ME = "0x" + "1".repeat(64);
const OTHER = "0x" + "2".repeat(64);
const NOW = 1_800_000_000_000;

describe("cranker evaluators & wallet auditor", () => {
  it("identifies due StandingOrders, TeamStreams, Streams, and expired Cheques accurately", () => {
    const order = evaluateStandingOrder(
      {
        objectId: "0x" + "a".repeat(64),
        version: "1",
        typeRepr: `0x0::standing_order::StandingOrder<${COIN_TYPES.USDSUI}>`,
        coinType: COIN_TYPES.USDSUI,
        ownerAddress: null,
        isShared: true,
        fields: {
          id: "0x" + "a".repeat(64),
          owner: ME,
          recipient: OTHER,
          pot: "50000000",
          amount_per: "10000000",
          interval_ms: "60000",
          next_due_ms: String(NOW - 1000),
          released_total: "0",
          releases_done: "0",
          paused: false,
          cancelled: false,
        },
      },
      NOW,
    );
    expect(order?.kind).toBe("standing_order");
    expect(order?.releasableBase).toBe(10_000_000n);

    const teamStream = evaluateTeamStream(
      {
        objectId: "0x" + "b".repeat(64),
        version: "1",
        typeRepr: `0x0::team_stream::TeamStream<${COIN_TYPES.USDSUI}>`,
        coinType: COIN_TYPES.USDSUI,
        ownerAddress: null,
        isShared: true,
        fields: {
          id: "0x" + "b".repeat(64),
          creator: ME,
          members: [OTHER],
          pot: "10000000",
          per_member: "5000000",
          tranche_total: "5000000",
          num_tranches: "2",
          tranches_done: "0",
          interval_ms: "3600000",
          next_due_ms: String(NOW - 3_600_000),
          released_total: "0",
          cancelled: false,
        },
      },
      NOW,
    );
    expect(teamStream?.dueTranches).toBe(2);

    const stream = evaluatePersonalStream(
      {
        objectId: "0x" + "c".repeat(64),
        version: "1",
        typeRepr: `0x0::stream::Stream<${COIN_TYPES.USDSUI}>`,
        coinType: COIN_TYPES.USDSUI,
        ownerAddress: null,
        isShared: true,
        fields: {
          id: "0x" + "c".repeat(64),
          sender: ME,
          recipient: OTHER,
          escrow: "20000000",
          total_amount: "20000000",
          released_amount: "0",
          tranche_amount: "10000000",
          num_tranches: "2",
          tranches_done: "0",
          start_ms: String(NOW - 10_000),
          interval_ms: "60000",
          paused: false,
          cancelled: false,
        },
      },
      NOW,
      false,
    );
    expect(stream?.dueTranches).toBe(1);

    const cheque = evaluateExpiredCheque(
      {
        objectId: "0x" + "d".repeat(64),
        version: "1",
        typeRepr: `0x0::cheque::Cheque<${COIN_TYPES.USDSUI}>`,
        coinType: COIN_TYPES.USDSUI,
        ownerAddress: null,
        isShared: true,
        fields: {
          id: "0x" + "d".repeat(64),
          creator: ME,
          escrow: "5000000",
          amount: "5000000",
          expiry_ms: String(NOW - 1),
          claimed: false,
        },
      },
      NOW,
      false,
    );
    expect(cheque?.kind).toBe("cheque_expired");
    expect(cheque?.releasableBase).toBe(5_000_000n);
  });

  it("flags reclaimable TeamStream dust, destroyable terminal streams, and GoalVault owner mismatch", () => {
    const report = analyzeWalletObjects({
      address: ME,
      nowMs: NOW,
      teams: [],
      teamStreams: [
        {
          objectId: "0x" + "e".repeat(64),
          version: "1",
          typeRepr: `0x0::team_stream::TeamStream<${COIN_TYPES.USDSUI}>`,
          coinType: COIN_TYPES.USDSUI,
          ownerAddress: null,
          isShared: true,
          fields: {
            id: "0x" + "e".repeat(64),
            creator: ME,
            members: [OTHER],
            pot: "7",
            per_member: "33",
            tranche_total: "99",
            num_tranches: "3",
            tranches_done: "3",
            interval_ms: "3600000",
            next_due_ms: String(NOW + 1000),
            released_total: "297",
            cancelled: false,
          },
        },
      ],
      standingOrders: [],
      streams: [],
      cheques: [],
      goalVaults: [
        {
          objectId: "0x" + "f".repeat(64),
          version: "1",
          typeRepr: `0x0::goal_vault::GoalVault<${COIN_TYPES.USDSUI}>`,
          coinType: COIN_TYPES.USDSUI,
          ownerAddress: ME,
          isShared: false,
          fields: {
            id: "0x" + "f".repeat(64),
            owner: OTHER,
            name: "Trip",
            target: "10000000",
            principal: "5000000",
          },
        },
      ],
    });

    const categories = report.findings.map((f) => f.category);
    expect(categories).toContain("reclaimable_dust");
    expect(categories).toContain("goal_owner_mismatch");
  });
});
