# talise-sui-ops

Clean-room direct-to-Sui CLI (`talise-sui`) and TypeScript SDK for Talise's live Sui mainnet Move contracts: on-chain payroll rosters (`talise-payroll` v2), tranche-vested team payroll streams (`talise-payroll-streams` v2), recurring standing orders (`talise-automations` v3), permissionless mainnet cranking, and wallet dust/exposure auditing.

> **Community tool notice:** Built and maintained independently by [Olu (`Olalolo22`)](https://github.com/Olalolo22), not affiliated with or endorsed by Talise Technologies Limited. Written clean-room on `@mysten/sui` v2 (GraphQL + gRPC) directly against public Sui mainnet Move package ABIs — no zkLogin, no `app.talise.io` account, and no private backend access required.

---

## Why Direct-to-Sui

Talise's core Move packages on Sui mainnet are permissionless by design:
- **DAO / company treasuries** can manage on-chain `Team` rosters, fund `TeamStream<USDsui>` schedules, and run atomic single-PTB payouts directly from a standard Sui keypair or CI signer.
- **Permissionless keepers** can execute due `StandingOrder` payments (`execute_due`), release due `TeamStream` tranches (`release_due_tranche`), claim accrued 1-to-1 `Stream` tranches (`claim_accrued`), and sweep expired `Cheque` escrows (`reclaim_expired`) — the Move contracts hardwire every destination and amount, so the cranker has zero custody or discretion.
- **Users & operators** can audit any Sui address or `@handle` for overdue streams, reclaimable `TeamStream` rounding dust, destroyable terminal streams (storage rebates), expired unclaimed cheques, and `GoalVault` owner drift.

---

## Live Mainnet Package IDs Verified Against Sui GraphQL

| Package | Version | Latest `published-at` | Original Type ID |
| --- | --- | --- | --- |
| `talise` | v9 | `0x633b5d86…77c3` | `0xc74a7df0…d394` |
| `talise-payroll` | v2 | `0xa3ea735b…f0c5` | `0x7a4b457c…f7fc` |
| `talise-payroll-streams` | v2 | `0xa0dde9da…df27` | `0xcff874d3…4c7c` |
| `talise-automations` | v3 | `0x66e40122…a6f4` | `0xf6190d58…339c` |
| `talise-pay` | v2 | `0x10bc32a5…8e1d` | `0x097a9560…60a8` |
| `talise-goals` | v2 | `0x9eaa832f…9e62` | `0xb0898eef…9947` |
| `talise-profile` | v2 | `0x15eeb393…1ec0` | `0x2e09b4ab…7dd2` |
| `talise-yield` | v2 | `0x3943e5a8…eeff` | `0xa58f2dee…d730` |
| `talise-privacy` | v1 | `0x36d80185…26b4` | `0x36d80185…26b4` |

Default asset: **USDsui** (`0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI`, 6 decimals).

---

## Install & Build

Requires **Node.js 22+**.

```bash
git clone https://github.com/Olalolo22/talise-sui-ops.git
cd talise-sui-ops
npm install
npm run build
```

---

## Quickstart

### Read-Only (no private key needed)

```bash
# 1. Inspect live mainnet package versions & shared registries
node dist/cli.js packages

# 2. Resolve any @handle, name@talise, or .sui name on-chain via SuiNS
node dist/cli.js resolve lala@talise

# 3. Audit any address or @handle for overdue streams, dust, expired cheques, or GoalVault drift
node dist/cli.js audit lala@talise --json

# 4. Dry-run the permissionless mainnet cranker
node dist/cli.js crank --dry-run

# 5. Plan a payroll CSV + preview exact TeamStream truncation dust
node dist/cli.js payroll plan examples/team-payroll.csv --tranches 4 --total 400
```

### Write Commands (standard Sui keypair)

Export `SUI_PRIVATE_KEY` (`suiprivkey1...`, 64-char hex seed, or 32-byte base64 seed). Non-interactive writes always require `--yes`.

```bash
# Trigger all due permissionless mainnet releases/reclaims (or run as a daemon with --watch)
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js crank --yes
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js crank --watch --interval-sec 60 --yes

# Create an on-chain talise-payroll Team roster from CSV
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js payroll team-create examples/team-payroll.csv --name "Core Eng" --yes

# Fund an on-chain TeamStream via create_v2 (4 weekly tranches)
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js payroll stream-create examples/team-payroll.csv \
  --total 400 --tranches 4 --interval-min 10080 --yes

# Vesting-safe cancel_v2 (refunds unvested remainder + dust) and destroy for storage rebate
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js payroll stream-cancel 0xSTREAM_ID --yes
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js payroll stream-destroy 0xSTREAM_ID --yes

# Atomic single-PTB payout with optional talise::send::send_v2 on-chain PaymentReceipts
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js payroll batch-send examples/team-payroll.csv \
  --with-receipt --max-total 1000 --yes

# Create/manage a permissionless StandingOrder (talise-automations v3)
SUI_PRIVATE_KEY=suiprivkey1... node dist/cli.js orders create @ada \
  --amount-per 50 --total 200 --interval-min 10080 --yes
```

---

## Safety Guarantees

- **Strict on-chain effect verification:** `executeTransaction` checks `status.success` and waits for finality over Sui gRPC — never silently treating an aborted Move tx as success.
- **Uses hardened v2/v3 Move entrypoints:** `team_stream::create_v2`, `team_stream::cancel_v2` (vesting-safe), `standing_order::create_v2`, and `talise::send::send_v2`.
- **Zero-address & duplicate guards:** Rejects `@0x0`, duplicate team/stream members, creator-in-roster, and missing `--yes` in non-TTY runs before signing.

## License

MIT — see [LICENSE](./LICENSE).
