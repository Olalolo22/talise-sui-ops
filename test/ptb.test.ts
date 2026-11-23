import { describe, expect, it } from "vitest";
import { COIN_TYPES, TALISE_MAINNET_PACKAGES } from "../src/constants.js";
import {
  buildAtomicBatchSendTx,
  buildChequeReclaimExpiredTx,
  buildStandingOrderCancelTx,
  buildStandingOrderCreateTx,
  buildStandingOrderExecuteTx,
  buildStreamClaimAccruedTx,
  buildTeamCreateTx,
  buildTeamStreamCancelTx,
  buildTeamStreamCreateTx,
  buildTeamStreamDestroyTx,
  buildTeamStreamReleaseTx,
} from "../src/ptb.js";

const A1 = "0x" + "1".repeat(64);
const A2 = "0x" + "2".repeat(64);
const OBJ = "0x" + "9".repeat(64);
const ZERO = "0x" + "0".repeat(64);
const COINS = [
  { objectId: "0x" + "a".repeat(64), version: "1", digest: "d1", balance: 1_000_000_000n, coinType: COIN_TYPES.USDSUI },
];

describe("PTB builders", () => {
  it("builds talise-payroll v2 Team creation and rejects duplicates or zero addresses", () => {
    const tx = buildTeamCreateTx({
      name: "Core",
      members: [
        { recipient: A1, amountMicro: 100_000_000n, label: "Eng" },
        { recipient: A2, amountMicro: 50_000_000n, label: "Design" },
      ],
    });
    const cmds = tx.getData().commands;
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.$kind).toBe("MoveCall");
    expect(cmds[0]!.MoveCall!.package).toBe(TALISE_MAINNET_PACKAGES.payroll.latestId);
    expect(cmds[0]!.MoveCall!.function).toBe("create");

    expect(() =>
      buildTeamCreateTx({
        name: "Dup",
        members: [
          { recipient: A1, amountMicro: 1n, label: "" },
          { recipient: A1, amountMicro: 2n, label: "" },
        ],
      }),
    ).toThrow(/Duplicate/);

    expect(() =>
      buildTeamCreateTx({
        name: "Zero",
        members: [{ recipient: ZERO, amountMicro: 1n, label: "" }],
      }),
    ).toThrow(/zero address/);
  });

  it("builds TeamStream v2 create_v2, release_due_tranche, cancel_v2, and destroy", () => {
    const createTx = buildTeamStreamCreateTx({
      coinType: COIN_TYPES.USDSUI,
      fundedBase: 100_000_000n,
      ownedCoins: COINS,
      members: [A1, A2],
      numTranches: 4,
      intervalMs: 3_600_000,
      firstDueMs: Date.now() + 3_600_000,
      creatorAddress: "0x" + "c".repeat(64),
    });
    const createCall = createTx.getData().commands.find((c) => c.$kind === "MoveCall" && c.MoveCall?.function === "create_v2");
    expect(createCall?.MoveCall?.package).toBe(TALISE_MAINNET_PACKAGES.payrollStreams.latestId);

    // Rejects sub-hour interval on create_v2
    expect(() =>
      buildTeamStreamCreateTx({
        coinType: COIN_TYPES.USDSUI,
        fundedBase: 100_000_000n,
        ownedCoins: COINS,
        members: [A1],
        numTranches: 2,
        intervalMs: 60_000,
        firstDueMs: Date.now() + 60_000,
      }),
    ).toThrow(/1 hour/);

    expect(
      buildTeamStreamReleaseTx({ streamId: OBJ, coinType: COIN_TYPES.USDSUI }).getData().commands[0]!
        .MoveCall!.function,
    ).toBe("release_due_tranche");
    expect(
      buildTeamStreamCancelTx({
        streamId: OBJ,
        coinType: COIN_TYPES.USDSUI,
        refundRecipient: A1,
      }).getData().commands[0]!.MoveCall!.function,
    ).toBe("cancel_v2");
    expect(
      buildTeamStreamDestroyTx({ streamId: OBJ, coinType: COIN_TYPES.USDSUI }).getData().commands[0]!
        .MoveCall!.function,
    ).toBe("destroy");
  });

  it("builds StandingOrder v3, Stream claim_accrued, Cheque reclaim_expired, and atomic batch send_v2", () => {
    const orderTx = buildStandingOrderCreateTx({
      coinType: COIN_TYPES.USDSUI,
      fundedBase: 50_000_000n,
      ownedCoins: COINS,
      recipient: A1,
      amountPerBase: 10_000_000n,
      intervalMs: 60_000,
      firstDueMs: Date.now() + 60_000,
    });
    expect(
      orderTx.getData().commands.some(
        (c) => c.$kind === "MoveCall" && c.MoveCall?.function === "create_v2",
      ),
    ).toBe(true);

    expect(
      buildStandingOrderExecuteTx({ orderId: OBJ, coinType: COIN_TYPES.USDSUI }).getData().commands[0]!
        .MoveCall!.function,
    ).toBe("execute_due");
    expect(
      buildStandingOrderCancelTx({
        orderId: OBJ,
        coinType: COIN_TYPES.USDSUI,
        refundRecipient: A1,
      }).getData().commands[0]!.MoveCall!.function,
    ).toBe("cancel");
    expect(
      buildStreamClaimAccruedTx({ streamId: OBJ, coinType: COIN_TYPES.USDSUI, legacy: true }).getData()
        .commands[0]!.MoveCall!.package,
    ).toBe(TALISE_MAINNET_PACKAGES.payLegacy.latestId);
    expect(
      buildChequeReclaimExpiredTx({ chequeId: OBJ, coinType: COIN_TYPES.USDSUI }).getData().commands[0]!
        .MoveCall!.function,
    ).toBe("reclaim_expired");

    const batchTx = buildAtomicBatchSendTx({
      coinType: COIN_TYPES.USDSUI,
      assetSymbol: "USDsui",
      ownedCoins: COINS,
      legs: [
        { recipient: A1, amountBase: 10_000_000n, memo: "Payroll 1" },
        { recipient: A2, amountBase: 20_000_000n, memo: "Payroll 2" },
      ],
      withOnChainReceipt: true,
    });
    const sendCalls = batchTx
      .getData()
      .commands.filter((c) => c.$kind === "MoveCall" && c.MoveCall?.function === "send_v2");
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0]!.MoveCall!.package).toBe(TALISE_MAINNET_PACKAGES.talise.latestId);
  });
});
