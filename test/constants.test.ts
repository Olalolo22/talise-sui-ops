import { describe, expect, it } from "vitest";
import {
  COIN_TYPES,
  decimalToBaseUnits,
  formatBaseUnits,
  resolveCoinType,
  TALISE_MAINNET_PACKAGES,
  TALISE_MAINNET_REGISTRIES,
} from "../src/constants.js";
import { extractTypeArg, normalizeTaliseHandleToSuins } from "../src/graphql.js";

describe("constants & SuiNS normalization", () => {
  it("stores valid 66-char 0x hex package & registry IDs", () => {
    const idRe = /^0x[0-9a-f]{64}$/;
    for (const pkg of Object.values(TALISE_MAINNET_PACKAGES)) {
      expect(pkg.originalId).toMatch(idRe);
      expect(pkg.latestId).toMatch(idRe);
    }
    for (const reg of Object.values(TALISE_MAINNET_REGISTRIES)) {
      expect(reg).toMatch(idRe);
    }
  });

  it("converts decimals cleanly without floating-point drift", () => {
    expect(decimalToBaseUnits("12.345678", 6)).toBe(12_345_678n);
    expect(decimalToBaseUnits("$1,250.5", 6)).toBe(1_250_500_000n);
    expect(() => decimalToBaseUnits("1.0000001", 6)).toThrow();
    expect(() => decimalToBaseUnits("0", 6)).toThrow();
    expect(formatBaseUnits(12_500_000n, 6)).toBe("12.50");
  });

  it("resolves coin aliases and extracts Move type parameters", () => {
    expect(resolveCoinType("USDsui").coinType).toBe(COIN_TYPES.USDSUI);
    expect(resolveCoinType("SUI").decimals).toBe(9);
    expect(
      extractTypeArg(
        `0xcff8::team_stream::TeamStream<${COIN_TYPES.USDSUI}>`,
      ),
    ).toBe(COIN_TYPES.USDSUI);
  });

  it("normalizes Talise handle forms into SuiNS domains", () => {
    expect(normalizeTaliseHandleToSuins("@lala")).toBe("lala.talise.sui");
    expect(normalizeTaliseHandleToSuins("lala@talise")).toBe("lala.talise.sui");
    expect(normalizeTaliseHandleToSuins("lala@talise.sui")).toBe("lala.talise.sui");
    expect(normalizeTaliseHandleToSuins("lala.talise.sui")).toBe("lala.talise.sui");
    expect(normalizeTaliseHandleToSuins("alice.sui")).toBe("alice.sui");
  });
});
