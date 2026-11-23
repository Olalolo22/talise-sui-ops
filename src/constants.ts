/**
 * Verified live Sui mainnet package IDs, shared singleton registries, and coin
 * types for Talise's public on-chain Move packages.
 *
 * `originalId` defines the canonical Move struct/type prefix on Sui;
 * `latestId` is the current upgraded package address to invoke in MoveCalls.
 */

export const SUI_MAINNET_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
export const SUI_MAINNET_GRPC_URL = "https://fullnode.mainnet.sui.io:443";
export const SUI_CLOCK_OBJECT_ID = "0x6";

export const COIN_TYPES = {
  USDSUI:
    "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI",
  SUI: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
  USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
} as const;

export const COIN_DECIMALS: Record<string, number> = {
  [COIN_TYPES.USDSUI]: 6,
  [COIN_TYPES.SUI]: 9,
  "0x2::sui::SUI": 9,
  [COIN_TYPES.USDC]: 6,
};

export type PackageEntry = {
  name: string;
  version: number;
  originalId: string;
  latestId: string;
  purpose: string;
};

export const TALISE_MAINNET_PACKAGES = {
  talise: {
    name: "talise",
    version: 9,
    originalId: "0xc74a7df07b4089d92f196d1db73ce0574db7f58ae0ba2b19b2a59d402958d394",
    latestId: "0x633b5d8665b522dc14d17ec59b5eda71b2e5e6eda835a1a010daa532a7a777c3",
    purpose: "Core payments (send, receipt, vault, auto_swap, batch_pay, remit_escrow)",
  },
  payroll: {
    name: "talise-payroll",
    version: 2,
    originalId: "0x7a4b457c24b3770882f4db375ea64e0a840b5462c3670339b6f918350016f7fc",
    latestId: "0xa3ea735b9423a9c8252c6fc54cbba7e05602b5a8b4f1f64fc8350030ccaaf0c5",
    purpose: "On-chain reusable Team rosters",
  },
  payrollStreams: {
    name: "talise-payroll-streams",
    version: 2,
    originalId: "0xcff874d3702572ea373053304c7d384aeaa4fb041905b355471a624331954c7c",
    latestId: "0xa0dde9dac8325df45393507c18fb6310b97e22806ae0ddfbdf16d28283f1df27",
    purpose: "Permissionless tranche-vested TeamStream payroll",
  },
  automations: {
    name: "talise-automations",
    version: 3,
    originalId: "0xf6190d582f88dc3301e060820ebe81b656d96f6bf71c0f6f2e0cf23cbde0339c",
    latestId: "0x66e40122bf83a7ea57e77bbd1f9987a4993e3100635fb03b5dc64fcf2104a6f4",
    purpose: "Permissionless StandingOrder scheduled payments",
  },
  pay: {
    name: "talise-pay",
    version: 2,
    originalId: "0x097a9560a34766d4556f98881672e81f33c1c0c35188728813595cd05fb160a8",
    latestId: "0x10bc32a5bb9d389eaace495a732c435a80b3d39de2ee988afe6d7dac239f8e1d",
    purpose: "Escrowed cheques and 1-to-1 payment streams",
  },
  payLegacy: {
    name: "talise-pay-legacy",
    version: 1,
    originalId: "0x4ba838c7ded1b57aededff4e825aa251858b05b720083856351dd8325094a13e",
    latestId: "0x4ba838c7ded1b57aededff4e825aa251858b05b720083856351dd8325094a13e",
    purpose: "Legacy cheques & 1-to-1 streams deployment (still holds live streams)",
  },
  goals: {
    name: "talise-goals",
    version: 2,
    originalId: "0xb0898eef5734ee9ebfbdbacd9e39533d7070159d4a87287ddde8a5b331059947",
    latestId: "0x9eaa832fb7b35fd3a17bc75e252df6d96eaecac6d49d345b4fc1e64ae48c9e62",
    purpose: "Owner-custodied GoalVault savings objects",
  },
  profile: {
    name: "talise-profile",
    version: 2,
    originalId: "0x2e09b4abfee5d2d590f94d9b1370480913ad9dd58363aa73c38552c99bf67dd2",
    latestId: "0x15eeb39352b8ad662c0d1f76fa1ac2cb5b389a3054dabf4e12777eededd51ec0",
    purpose: "On-chain Talise profile metadata",
  },
  yield: {
    name: "talise-yield",
    version: 2,
    originalId: "0xa58f2dee1dd01ac655ef2d9180a96228ab4667219049cfc1286752b3923ad730",
    latestId: "0x3943e5a8ecfd324c0a7e7c9396e4b8d976e59f8a47675a7d57829ed202e4eeff",
    purpose: "DeFi lending yield router positions",
  },
  privacy: {
    name: "talise-privacy",
    version: 1,
    originalId: "0x36d80185b4ee5890f95e743142fac280952ab013310a4b609d165f20fa1f26b4",
    latestId: "0x36d80185b4ee5890f95e743142fac280952ab013310a4b609d165f20fa1f26b4",
    purpose: "Groth16 shielded pool (pilot)",
  },
} as const satisfies Record<string, PackageEntry>;

export const TALISE_MAINNET_REGISTRIES = {
  automationRegistry: "0x7a1d890e9b03ace32048ed09acb3856cbfbb021db67baf97e0fe41feebd10178",
  teamStreamRegistry: "0x8bc14d8dd959fdfebbf1b7b79250de41c3b769d779c297a27fc6b41fd510a250",
  streamRegistry: "0x464b05de106cbf9f01a71e7f6263616d9fa95d7d58c73beaf8669f3df879c7b5",
  chequeRegistry: "0xfab3729ac22049d8e428ebf5f2b64ccfc7151a00af6a880d594f8e46414b0767",
  streamRegistryLegacy: "0x8209bffc6e11355a38ee41c3269363f9d029a1150506a34a0eddc245eab5af9c",
  chequeRegistryLegacy: "0xfd010c37f6389a8ea35620980e8d14483fd689531dcc03d5869c6d5ea94ba13d",
  shieldedRegistry: "0xbb497abaf8d8bc465f712983c30cd690ab72f476e6c66e381d4eb20c9e7ea0f0",
  shieldedPoolUsdsui: "0x29c3ff62b0cd8fb13c3a317fe8e730be66a7ddb6465f3124be356ee6e871af07",
} as const;

export const MOVE_STRUCT_TYPES = {
  standingOrder: `${TALISE_MAINNET_PACKAGES.automations.originalId}::standing_order::StandingOrder`,
  teamStream: `${TALISE_MAINNET_PACKAGES.payrollStreams.originalId}::team_stream::TeamStream`,
  team: `${TALISE_MAINNET_PACKAGES.payroll.originalId}::payroll::Team`,
  stream: `${TALISE_MAINNET_PACKAGES.pay.originalId}::stream::Stream`,
  cheque: `${TALISE_MAINNET_PACKAGES.pay.originalId}::cheque::Cheque`,
  streamLegacy: `${TALISE_MAINNET_PACKAGES.payLegacy.originalId}::stream::Stream`,
  chequeLegacy: `${TALISE_MAINNET_PACKAGES.payLegacy.originalId}::cheque::Cheque`,
  goalVault: `${TALISE_MAINNET_PACKAGES.goals.originalId}::goal_vault::GoalVault`,
  shieldedPool: `${TALISE_MAINNET_PACKAGES.privacy.originalId}::shielded_pool::ShieldedPool`,
} as const;

export function resolveCoinType(assetOrType: string): { coinType: string; decimals: number; symbol: string } {
  const raw = assetOrType.trim();
  const upper = raw.toUpperCase();
  if (upper === "USDSUI" || upper === "USD") {
    return { coinType: COIN_TYPES.USDSUI, decimals: 6, symbol: "USDsui" };
  }
  if (upper === "SUI") {
    return { coinType: COIN_TYPES.SUI, decimals: 9, symbol: "SUI" };
  }
  if (upper === "USDC") {
    return { coinType: COIN_TYPES.USDC, decimals: 6, symbol: "USDC" };
  }
  if (/^0x[a-fA-F0-9]+::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) {
    const symbol = raw.split("::").at(-1) ?? raw;
    return { coinType: raw, decimals: COIN_DECIMALS[raw] ?? 6, symbol };
  }
  throw new Error(`Unsupported asset or coin type: "${assetOrType}"`);
}

export function decimalToBaseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === "number" ? amount.toString() : amount.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid positive decimal amount: "${amount}"`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(`Amount "${amount}" exceeds ${decimals} decimal places`);
  }
  const padded = frac.padEnd(decimals, "0");
  const units = BigInt(`${whole}${padded}`);
  if (units <= 0n) {
    throw new Error(`Amount must be greater than zero (got "${amount}")`);
  }
  return units;
}

export function formatBaseUnits(units: bigint, decimals: number, maxFrac = 2): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const frac = (units % scale).toString().padStart(decimals, "0");
  const trimmed = frac.slice(0, Math.max(maxFrac, 2)).replace(/0+$/, "");
  const shown = trimmed.length < 2 ? frac.slice(0, 2) : trimmed;
  return `${whole.toString()}.${shown}`;
}
