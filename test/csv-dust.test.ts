import { describe, expect, it } from "vitest";
import { computeTeamStreamSplit, escapeCsvCell, parseRosterCsv } from "../src/csv.js";

describe("CSV roster parser & TeamStream truncation dust", () => {
  it("parses headered and headerless CSV rosters", () => {
    const rows = parseRosterCsv(
      "recipient,amount,label\nlala@talise,100.25,Eng\n@ada,50,Design\n",
      6,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amountBase).toBe(100_250_000n);
    expect(rows[1]!.label).toBe("Design");

    const semi = parseRosterCsv("Alice;alice@talise;25\nBob;bob@talise;30\n", 6);
    expect(semi[0]).toMatchObject({ recipient: "alice@talise", amountBase: 25_000_000n, label: "Alice" });
  });

  it("matches exact Move integer truncation for TeamStream split & dust", () => {
    // 300 over 3 tranches to 3 members -> tranche 100 -> per_member 33 -> tranche_total 99 -> obligation 297 -> dust 3
    const split = computeTeamStreamSplit(300n, 3, 3);
    expect(split.perMemberPerTranche).toBe(33n);
    expect(split.trancheTotal).toBe(99n);
    expect(split.totalObligation).toBe(297n);
    expect(split.reclaimableDust).toBe(3n);

    // 100 over 1 tranche to 3 members -> dust 1
    expect(computeTeamStreamSplit(100n, 1, 3).reclaimableDust).toBe(1n);

    // Rejects dust-only funding where per-member share truncates to 0
    expect(() => computeTeamStreamSplit(5n, 3, 3)).toThrow(/truncates to 0/i);
  });

  it("neutralizes spreadsheet formula injection on exported cells", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("@formula")).toBe("'@formula");
  });
});
