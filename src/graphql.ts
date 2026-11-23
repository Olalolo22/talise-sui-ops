import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  MOVE_STRUCT_TYPES,
  SUI_MAINNET_GRAPHQL_URL,
  TALISE_MAINNET_PACKAGES,
  TALISE_MAINNET_REGISTRIES,
} from "./constants.js";

export type GraphQLClientOptions = {
  url?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export type MoveObjectRecord<T = Record<string, unknown>> = {
  objectId: string;
  version: string;
  typeRepr: string;
  coinType: string | null;
  ownerAddress: string | null;
  isShared: boolean;
  fields: T;
};

export type StandingOrderFields = {
  id: string;
  owner: string;
  recipient: string;
  pot: string;
  amount_per: string;
  interval_ms: string;
  next_due_ms: string;
  released_total: string;
  releases_done: string;
  paused: boolean;
  cancelled: boolean;
};

export type TeamStreamFields = {
  id: string;
  creator: string;
  members: string[];
  pot: string;
  per_member: string;
  tranche_total: string;
  num_tranches: string;
  tranches_done: string;
  interval_ms: string;
  next_due_ms: string;
  released_total: string;
  cancelled: boolean;
};

export type PersonalStreamFields = {
  id: string;
  sender: string;
  recipient: string;
  escrow: string;
  total_amount: string;
  released_amount: string;
  tranche_amount: string;
  num_tranches: string;
  tranches_done: string;
  start_ms: string;
  interval_ms: string;
  paused: boolean;
  cancelled: boolean;
};

export type ChequeFields = {
  id: string;
  creator: string;
  escrow: string;
  amount: string;
  expiry_ms: string;
  claimed: boolean;
  reclaimed?: boolean;
  bound_recipient?: string | null;
};

export type TeamFields = {
  id: string;
  owner: string;
  name: string;
  members: { recipient: string; amount_micro: string; label: string }[];
  seq: string;
};

export type GoalVaultFields = {
  id: string;
  owner: string;
  name: string;
  target: string;
  principal: string;
  deposits_total?: string;
  withdrawals_total?: string;
  venue?: number;
};

export type CoinObject = {
  objectId: string;
  version: string;
  digest: string;
  balance: bigint;
  coinType: string;
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{1,64}$/;

/** Extract `<CoinType>` from `0x...::mod::Struct<0x...::coin::COIN>`. */
export function extractTypeArg(typeRepr: string): string | null {
  const lt = typeRepr.indexOf("<");
  const gt = typeRepr.lastIndexOf(">");
  if (lt < 0 || gt <= lt) return null;
  return typeRepr.slice(lt + 1, gt).trim();
}

/**
 * Normalize Talise handles and SuiNS names into SuiNS domain form:
 *   `@lala`           -> `lala.talise.sui`
 *   `lala@talise`     -> `lala.talise.sui`
 *   `lala@talise.sui` -> `lala.talise.sui`
 *   `lala.talise.sui` -> `lala.talise.sui`
 *   `alice.sui`       -> `alice.sui`
 */
export function normalizeTaliseHandleToSuins(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) throw new Error("Empty recipient or handle");
  if (trimmed.endsWith(".sui") && !trimmed.includes("@")) return trimmed;
  if (trimmed.endsWith("@talise.sui")) {
    return `${trimmed.slice(0, -"@talise.sui".length)}.talise.sui`;
  }
  if (trimmed.endsWith("@talise")) {
    return `${trimmed.slice(0, -"@talise".length)}.talise.sui`;
  }
  if (trimmed.startsWith("@")) {
    return `${trimmed.slice(1)}.talise.sui`;
  }
  if (!trimmed.includes(".") && !trimmed.includes("@")) {
    return `${trimmed}.talise.sui`;
  }
  return trimmed;
}

export class SuiGraphQLClient {
  readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: GraphQLClientOptions = {}) {
    this.url = opts.url ?? SUI_MAINNET_GRAPHQL_URL;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "talise-sui-ops/0.1.0",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Sui GraphQL HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const parsed = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (parsed.errors && parsed.errors.length > 0 && !parsed.data) {
      throw new Error(`Sui GraphQL error: ${parsed.errors[0]!.message}`);
    }
    return parsed.data as T;
  }

  /** Resolve a `0x...` address, `@handle`, `handle@talise`, or `.sui` name on-chain via SuiNS. */
  async resolveRecipient(input: string): Promise<{
    input: string;
    domain: string | null;
    address: string;
  }> {
    const trimmed = input.trim();
    if (ADDRESS_RE.test(trimmed)) {
      return { input, domain: null, address: normalizeSuiAddress(trimmed) };
    }
    const domain = normalizeTaliseHandleToSuins(trimmed);
    const data = await this.query<{
      nameRecord?: { domain?: string; target?: { address?: string } | null } | null;
    }>(
      `query($name: String!) {
        nameRecord(name: $name) {
          domain
          target { address }
        }
      }`,
      { name: domain },
    );
    const addr = data?.nameRecord?.target?.address;
    if (!addr) {
      throw new Error(`SuiNS name "${domain}" (from "${input}") did not resolve on mainnet`);
    }
    return {
      input,
      domain: data.nameRecord?.domain ?? domain,
      address: normalizeSuiAddress(addr),
    };
  }

  /** Fetch the latest published version of a package given its original ID. */
  async getLatestPackage(originalId: string): Promise<{
    address: string;
    version: number;
    modules: string[];
  } | null> {
    const data = await this.query<{
      packageVersions?: {
        nodes?: { address: string; version: number; modules?: { nodes?: { name: string }[] } }[];
      };
    }>(
      `query($addr: SuiAddress!) {
        packageVersions(address: $addr, last: 1) {
          nodes {
            address
            version
            modules { nodes { name } }
          }
        }
      }`,
      { addr: originalId },
    );
    const node = data?.packageVersions?.nodes?.[0];
    if (!node) return null;
    return {
      address: node.address,
      version: node.version,
      modules: (node.modules?.nodes ?? []).map((m) => m.name),
    };
  }

  /** Fetch live objects of a Move struct type (paginated up to `maxObjects`). */
  async listObjectsByType<T = Record<string, unknown>>(
    structType: string,
    maxObjects = 200,
  ): Promise<MoveObjectRecord<T>[]> {
    const out: MoveObjectRecord<T>[] = [];
    let cursor: string | null = null;

    while (out.length < maxObjects) {
      const pageSize = Math.min(50, maxObjects - out.length);
      const data: {
        objects?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: {
            address: string;
            version: string | number;
            owner?: { __typename?: string; address?: { address?: string } };
            asMoveObject?: {
              contents?: { type?: { repr?: string }; json?: T };
            };
          }[];
        };
      } = await this.query(
        `query($t: String!, $first: Int!, $after: String) {
          objects(filter: { type: $t }, first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              address
              version
              owner {
                __typename
                ... on AddressOwner { address { address } }
              }
              asMoveObject {
                contents {
                  type { repr }
                  json
                }
              }
            }
          }
        }`,
        { t: structType, first: pageSize, after: cursor },
      );

      const nodes = data?.objects?.nodes ?? [];
      for (const n of nodes) {
        const contents = n.asMoveObject?.contents;
        if (!contents?.json || !contents.type?.repr) continue;
        out.push({
          objectId: n.address,
          version: String(n.version),
          typeRepr: contents.type.repr,
          coinType: extractTypeArg(contents.type.repr),
          ownerAddress: n.owner?.address?.address
            ? normalizeSuiAddress(n.owner.address.address)
            : null,
          isShared: n.owner?.__typename === "Shared",
          fields: contents.json,
        });
      }

      if (!data?.objects?.pageInfo?.hasNextPage || !data.objects.pageInfo.endCursor) break;
      cursor = data.objects.pageInfo.endCursor;
    }

    return out;
  }

  /** Fetch a single Move object by object ID. */
  async getMoveObject<T = Record<string, unknown>>(
    objectId: string,
  ): Promise<MoveObjectRecord<T> | null> {
    const data = await this.query<{
      object?: {
        address: string;
        version: string | number;
        owner?: { __typename?: string; address?: { address?: string } };
        asMoveObject?: {
          contents?: { type?: { repr?: string }; json?: T };
        };
      } | null;
    }>(
      `query($id: SuiAddress!) {
        object(address: $id) {
          address
          version
          owner {
            __typename
            ... on AddressOwner { address { address } }
          }
          asMoveObject {
            contents {
              type { repr }
              json
            }
          }
        }
      }`,
      { id: objectId },
    );
    const n = data?.object;
    const contents = n?.asMoveObject?.contents;
    if (!n || !contents?.json || !contents.type?.repr) return null;
    return {
      objectId: n.address,
      version: String(n.version),
      typeRepr: contents.type.repr,
      coinType: extractTypeArg(contents.type.repr),
      ownerAddress: n.owner?.address?.address
        ? normalizeSuiAddress(n.owner.address.address)
        : null,
      isShared: n.owner?.__typename === "Shared",
      fields: contents.json,
    };
  }

  /** Fetch owned Coin<CoinType> objects for an address (for PTB funding). */
  async getOwnedCoins(owner: string, coinType: string, limit = 50): Promise<CoinObject[]> {
    const data = await this.query<{
      objects?: {
        nodes?: {
          address: string;
          version: string | number;
          digest: string;
          asMoveObject?: { contents?: { json?: { balance?: string } } };
        }[];
      };
    }>(
      `query($owner: SuiAddress!, $t: String!, $first: Int!) {
        objects(filter: { owner: $owner, type: $t }, first: $first) {
          nodes {
            address
            version
            digest
            asMoveObject { contents { json } }
          }
        }
      }`,
      { owner: normalizeSuiAddress(owner), t: `0x2::coin::Coin<${coinType}>`, first: limit },
    );
    return (data?.objects?.nodes ?? [])
      .map((n) => ({
        objectId: n.address,
        version: String(n.version),
        digest: n.digest,
        balance: BigInt(n.asMoveObject?.contents?.json?.balance ?? "0"),
        coinType,
      }))
      .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  }

  /** Fetch live status of Talise's shared registries and shielded pool. */
  async getProtocolSnapshot() {
    const [autoReg, tsReg, streamReg, chequeReg, shieldedPool] = await Promise.all([
      this.getMoveObject(TALISE_MAINNET_REGISTRIES.automationRegistry),
      this.getMoveObject(TALISE_MAINNET_REGISTRIES.teamStreamRegistry),
      this.getMoveObject(TALISE_MAINNET_REGISTRIES.streamRegistry),
      this.getMoveObject(TALISE_MAINNET_REGISTRIES.chequeRegistry),
      this.getMoveObject(TALISE_MAINNET_REGISTRIES.shieldedPoolUsdsui),
    ]);
    return {
      packages: TALISE_MAINNET_PACKAGES,
      registries: {
        automationRegistry: autoReg?.fields ?? null,
        teamStreamRegistry: tsReg?.fields ?? null,
        streamRegistry: streamReg?.fields ?? null,
        chequeRegistry: chequeReg?.fields ?? null,
        shieldedPoolUsdsui: shieldedPool
          ? {
              objectId: shieldedPool.objectId,
              coinType: shieldedPool.coinType,
              paused: shieldedPool.fields.paused ?? null,
              paused_until_ms: shieldedPool.fields.paused_until_ms ?? null,
              max_deposit: shieldedPool.fields.max_deposit ?? null,
              max_withdraw: shieldedPool.fields.max_withdraw ?? null,
            }
          : null,
      },
      structTypes: MOVE_STRUCT_TYPES,
    };
  }
}
