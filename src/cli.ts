#!/usr/bin/env node
/**
 * talise-sui — Clean-room direct-to-Sui CLI for Talise mainnet payroll,
 * standing orders, permissionless cranking, and wallet auditing.
 *
 * Unofficial community tool built by Olu (Olalolo22), not affiliated with or
 * endorsed by Talise Technologies Limited.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { auditWalletOnMainnet } from "./audit.js";
import {
  decimalToBaseUnits,
  formatBaseUnits,
  resolveCoinType,
  SUI_MAINNET_GRAPHQL_URL,
  SUI_MAINNET_GRPC_URL,
  TALISE_MAINNET_PACKAGES,
  TALISE_MAINNET_REGISTRIES,
} from "./constants.js";
import { scanCrankCandidates } from "./crank.js";
import { computeTeamStreamSplit, parseRosterCsv } from "./csv.js";
import { SuiGraphQLClient } from "./graphql.js";
import {
  buildAtomicBatchSendTx,
  buildStandingOrderCancelTx,
  buildStandingOrderCreateTx,
  buildStandingOrderPauseTx,
  buildTeamCreateTx,
  buildTeamDeleteTx,
  buildTeamStreamCancelTx,
  buildTeamStreamCreateTx,
  buildTeamStreamDestroyTx,
} from "./ptb.js";
import { createSuiGrpcClient, executeTransaction, loadSuiKeypair } from "./signer.js";

type Flags = {
  json: boolean;
  yes: boolean;
  help: boolean;
  dryRun: boolean;
  watch: boolean;
  withReceipt: boolean;
  noLegacy: boolean;
  asset: string;
  graphqlUrl?: string;
  grpcUrl?: string;
  name?: string;
  total?: string;
  tranches?: number;
  intervalMin?: number;
  firstDueMin?: number;
  amountPer?: string;
  only?: string;
  intervalSec?: number;
  maxTotal?: string;
  _: string[];
};

function pkgVersion(): string {
  try {
    const pkgPath = resolve(fileURLToPath(new URL("../package.json", import.meta.url)));
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    json: false,
    yes: false,
    help: false,
    dryRun: false,
    watch: false,
    withReceipt: false,
    noLegacy: false,
    asset: "USDsui",
    _: [],
  };
  const takeStr = (flag: string, i: number): [string, number] => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return [v, i + 1];
  };
  const takeNum = (flag: string, i: number): [number, number] => {
    const [raw, next] = takeStr(flag, i);
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${flag} requires a finite number (got "${raw}")`);
    return [n, next];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      f._.push(...argv.slice(i + 1));
      break;
    }
    switch (a) {
      case "--json":
        f.json = true;
        break;
      case "--yes":
      case "-y":
        f.yes = true;
        break;
      case "--help":
      case "-h":
        f.help = true;
        break;
      case "--dry-run":
        f.dryRun = true;
        break;
      case "--watch":
        f.watch = true;
        break;
      case "--with-receipt":
        f.withReceipt = true;
        break;
      case "--no-legacy":
        f.noLegacy = true;
        break;
      case "--asset":
        [f.asset, i] = takeStr(a, i);
        break;
      case "--graphql-url":
        [f.graphqlUrl, i] = takeStr(a, i);
        break;
      case "--grpc-url":
        [f.grpcUrl, i] = takeStr(a, i);
        break;
      case "--name":
        [f.name, i] = takeStr(a, i);
        break;
      case "--total":
        [f.total, i] = takeStr(a, i);
        break;
      case "--tranches":
        [f.tranches, i] = takeNum(a, i);
        break;
      case "--interval-min":
        [f.intervalMin, i] = takeNum(a, i);
        break;
      case "--first-due-min":
        [f.firstDueMin, i] = takeNum(a, i);
        break;
      case "--amount-per":
        [f.amountPer, i] = takeStr(a, i);
        break;
      case "--only":
        [f.only, i] = takeStr(a, i);
        break;
      case "--interval-sec":
        [f.intervalSec, i] = takeNum(a, i);
        break;
      case "--max-total":
        [f.maxTotal, i] = takeStr(a, i);
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown flag: ${a} (run \`talise-sui help\`)`);
        f._.push(a);
    }
  }
  return f;
}

async function confirmAction(flags: Flags, prompt: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error("Refusing to sign a transaction non-interactively without --yes");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const ans = await new Promise<string>((r) => rl.question(`${prompt} [y/N] `, r));
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

function emit(flags: Flags, data: unknown, human: () => void): void {
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        data,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ) + "\n",
    );
  } else {
    human();
  }
}

function topHelp(): string {
  return [
    "talise-sui — Clean-room direct-to-Sui CLI for Talise mainnet payroll, standing orders & cranking",
    "",
    "Usage:",
    "  talise-sui <command> [args] [flags]",
    "",
    "Read & Audit (no private key required):",
    "  packages [--live]                    List Talise mainnet Move package IDs & registries",
    "  resolve <@handle|name@talise|.sui>   Resolve a Talise SuiNS name directly on Sui mainnet",
    "  inspect <objectId>                   Inspect any Move object on Sui mainnet",
    "  audit <@handle|0x...>                Scan wallet for overdue streams, TeamStream dust, expired cheques, GoalVault drift",
    "",
    "Permissionless Mainnet Cranker:",
    "  crank [--dry-run] [--only <id>] [--watch] [--interval-sec 60] [--yes]",
    "                                       Scan & trigger due StandingOrders, TeamStreams, Streams, and expired Cheques",
    "",
    "Payroll & Team Streams (talise-payroll v2, talise-payroll-streams v2, talise v9):",
    "  payroll plan <file.csv> [--tranches N] [--total AMT] [--asset USDsui]",
    "                                       Resolve CSV handles on-chain + preview exact TeamStream rounding dust",
    "  payroll team-create <file.csv> --name <teamName> [--yes]",
    "                                       Create an on-chain talise-payroll Team roster",
    "  payroll team-delete <teamObjectId> [--yes]",
    "  payroll stream-create <file.csv> --total <amt> --tranches <n> --interval-min <min> [--first-due-min <min>] [--asset USDsui] [--yes]",
    "                                       Fund an on-chain TeamStream via create_v2",
    "  payroll stream-cancel <streamObjectId> [--yes]",
    "                                       Vesting-safe cancel_v2 (refunds unvested + rounding dust)",
    "  payroll stream-destroy <streamObjectId> [--yes]",
    "                                       Delete terminal TeamStream and reclaim storage rebate",
    "  payroll batch-send <file.csv> [--asset USDsui] [--with-receipt] [--max-total N] [--yes]",
    "                                       Atomic single-PTB payout (optional talise::send::send_v2 receipts)",
    "",
    "Standing Orders (talise-automations v3):",
    "  orders create <recipient> --amount-per <amt> --total <amt> --interval-min <min> [--first-due-min <min>] [--asset USDsui] [--yes]",
    "  orders pause <orderObjectId> [--yes]",
    "  orders resume <orderObjectId> [--yes]",
    "  orders cancel <orderObjectId> [--yes]",
    "",
    "Global Flags:",
    "  --json                Machine-readable JSON on stdout",
    "  --yes, -y             Skip confirmation (required for non-interactive writes)",
    "  --asset <sym|type>    Coin symbol/type (default: USDsui; supports USDsui, SUI, USDC, or 0x...::m::T)",
    "  --graphql-url <url>   Sui GraphQL endpoint (default: mainnet)",
    "  --grpc-url <url>      Sui gRPC endpoint (default: mainnet)",
    "  --version, -v         Print version",
    "  --help, -h            Show help",
  ].join("\n");
}

function makeClients(flags: Flags) {
  const gql = new SuiGraphQLClient({
    url: flags.graphqlUrl ?? process.env.SUI_GRAPHQL_URL ?? SUI_MAINNET_GRAPHQL_URL,
  });
  const grpc = createSuiGrpcClient({
    baseUrl: flags.grpcUrl ?? process.env.SUI_GRPC_URL ?? SUI_MAINNET_GRPC_URL,
  });
  return { gql, grpc };
}

function requireSigner() {
  return loadSuiKeypair(process.env.SUI_PRIVATE_KEY ?? "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(topHelp() + "\n");
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    process.stdout.write(`talise-sui ${pkgVersion()}\n`);
    return;
  }

  const cmd = argv[0]!;
  const flags = parseArgs(argv.slice(1));
  if (flags.help) {
    process.stdout.write(topHelp() + "\n");
    return;
  }

  const { gql, grpc } = makeClients(flags);

  switch (cmd) {
    case "packages": {
      const snapshot = await gql.getProtocolSnapshot();
      emit(flags, snapshot, () => {
        process.stdout.write("Talise Sui Mainnet Packages:\n");
        for (const pkg of Object.values(TALISE_MAINNET_PACKAGES)) {
          process.stdout.write(
            `  ${pkg.name.padEnd(24)} v${pkg.version}  latest=${pkg.latestId}\n`,
          );
        }
        process.stdout.write("\nShared Registries:\n");
        for (const [k, v] of Object.entries(TALISE_MAINNET_REGISTRIES)) {
          process.stdout.write(`  ${k.padEnd(24)} ${v}\n`);
        }
      });
      return;
    }

    case "resolve": {
      const q = flags._[0];
      if (!q) throw new Error("Usage: talise-sui resolve <@handle|name@talise|.sui|0x...>");
      const res = await gql.resolveRecipient(q);
      emit(flags, res, () => {
        process.stdout.write(`${res.domain ?? res.input} -> ${res.address}\n`);
      });
      return;
    }

    case "inspect": {
      const id = flags._[0];
      if (!id) throw new Error("Usage: talise-sui inspect <objectId>");
      const obj = await gql.getMoveObject(id);
      if (!obj) throw new Error(`Object ${id} not found on Sui mainnet`);
      emit(flags, obj, () => {
        process.stdout.write(
          `Object ${obj.objectId} (v${obj.version})\n` +
            `  type:   ${obj.typeRepr}\n` +
            `  shared: ${obj.isShared}${obj.ownerAddress ? `  owner: ${obj.ownerAddress}` : ""}\n` +
            `  fields: ${JSON.stringify(obj.fields, null, 2)}\n`,
        );
      });
      return;
    }

    case "audit": {
      const target = flags._[0];
      if (!target) throw new Error("Usage: talise-sui audit <@handle|0x...>");
      const resolved = await gql.resolveRecipient(target);
      const report = await auditWalletOnMainnet(gql, resolved.address);
      emit(flags, { query: target, domain: resolved.domain, ...report }, () => {
        process.stdout.write(
          `Talise Mainnet Audit for ${resolved.domain ?? resolved.address} (${resolved.address})\n` +
            `  Teams: ${report.counts.teamsOwned}  TeamStreams: ${report.counts.teamStreamsCreated}  StandingOrders: ${report.counts.standingOrdersOwned}\n` +
            `  1-to-1 Streams: ${report.counts.personalStreamsInvolved}  Cheques: ${report.counts.chequesCreated}  GoalVaults: ${report.counts.goalVaultsHeld}\n`,
        );
        if (report.findings.length === 0) {
          process.stdout.write("  No overdue items, dust, or drift findings.\n");
        } else {
          process.stdout.write(`\nFindings (${report.findings.length}):\n`);
          for (const f of report.findings) {
            process.stdout.write(
              `  [${f.severity.toUpperCase()}] ${f.category} (${f.objectId})\n` +
                `    ${f.summary}\n` +
                `    Action: ${f.recommendedAction}\n`,
            );
          }
        }
      });
      return;
    }

    case "crank": {
      const runOnce = async () => {
        const all = await scanCrankCandidates(gql, { includeLegacy: !flags.noLegacy });
        const targets = flags.only
          ? all.filter((c) => c.objectId.toLowerCase() === flags.only!.toLowerCase())
          : all;

        if (flags.dryRun || targets.length === 0) {
          const serializable = targets.map(({ buildTx: _, ...rest }) => rest);
          emit(flags, { dryRun: true, count: serializable.length, candidates: serializable }, () => {
            if (serializable.length === 0) {
              process.stdout.write("No due StandingOrders, TeamStreams, Streams, or expired Cheques found.\n");
              return;
            }
            process.stdout.write(`Found ${serializable.length} crankable mainnet object(s):\n`);
            for (const c of serializable) {
              process.stdout.write(`  [${c.kind}] ${c.objectId} — ${c.description}\n`);
            }
          });
          return;
        }

        const signer = requireSigner();
        const ok = await confirmAction(
          flags,
          `Execute ${targets.length} permissionless crank transaction(s) from ${signer.toSuiAddress()}?`,
        );
        if (!ok) {
          process.stderr.write("Cancelled.\n");
          return;
        }

        const results: (
          | { objectId: string; kind: string; ok: true; digest: string; suiscanUrl: string; status: "success" }
          | { objectId: string; kind: string; ok: false; error: string }
        )[] = [];
        for (const c of targets) {
          try {
            const outcome = await executeTransaction(grpc, signer, c.buildTx());
            results.push({ objectId: c.objectId, kind: c.kind, ok: true, ...outcome });
          } catch (err) {
            results.push({
              objectId: c.objectId,
              kind: c.kind,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        emit(flags, { executed: results.length, results }, () => {
          for (const r of results) {
            process.stdout.write(
              r.ok
                ? `✓ [${r.kind}] ${r.objectId} -> ${r.suiscanUrl}\n`
                : `✗ [${r.kind}] ${r.objectId} -> ${r.error}\n`,
            );
          }
        });
      };

      if (!flags.watch) {
        await runOnce();
      } else {
        const sec = flags.intervalSec ?? 60;
        if (sec < 10) throw new Error("--interval-sec must be at least 10");
        for (;;) {
          await runOnce();
          await new Promise((r) => setTimeout(r, sec * 1000));
        }
      }
      return;
    }

    case "payroll": {
      const sub = flags._[0];
      const { coinType, decimals, symbol } = resolveCoinType(flags.asset);

      if (sub === "plan") {
        const csvPath = flags._[1];
        if (!csvPath) throw new Error("Usage: talise-sui payroll plan <file.csv>");
        const rows = parseRosterCsv(readFileSync(csvPath, "utf8"), decimals);
        const resolved: {
          line: number;
          input: string;
          domain: string | null;
          address: string;
          amountBase: bigint;
          amountFormatted: string;
          label: string;
        }[] = [];
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const r of rows) {
          const hit = await gql.resolveRecipient(r.recipient);
          if (seen.has(hit.address)) duplicates.push(hit.address);
          seen.add(hit.address);
          resolved.push({
            line: r.line,
            input: r.recipient,
            domain: hit.domain,
            address: hit.address,
            amountBase: r.amountBase,
            amountFormatted: formatBaseUnits(r.amountBase, decimals),
            label: r.label,
          });
        }
        const csvTotal = resolved.reduce((acc, r) => acc + r.amountBase, 0n);
        const streamSplit =
          flags.tranches !== undefined
            ? computeTeamStreamSplit(
                flags.total ? decimalToBaseUnits(flags.total, decimals) : csvTotal,
                flags.tranches,
                resolved.length,
              )
            : null;

        emit(
          flags,
          {
            asset: symbol,
            coinType,
            memberCount: resolved.length,
            csvTotalBase: csvTotal,
            csvTotalFormatted: formatBaseUnits(csvTotal, decimals),
            duplicates,
            streamSplit,
            members: resolved,
          },
          () => {
            process.stdout.write(
              `Payroll Plan (${symbol}): ${resolved.length} recipients, CSV total ${formatBaseUnits(csvTotal, decimals)} ${symbol}\n`,
            );
            if (duplicates.length > 0) {
              process.stdout.write(`  WARNING: ${duplicates.length} duplicate address(es) detected!\n`);
            }
            for (const m of resolved) {
              process.stdout.write(
                `  line ${m.line}: ${m.input.padEnd(20)} -> ${m.address.slice(0, 10)}…  ${m.amountFormatted} ${symbol}  ${m.label}\n`,
              );
            }
            if (streamSplit) {
              process.stdout.write(
                `\nTeamStream Preview (${streamSplit.numTranches} tranches × ${streamSplit.memberCount} members):\n` +
                  `  Per member / tranche: ${formatBaseUnits(streamSplit.perMemberPerTranche, decimals)} ${symbol}\n` +
                  `  Per tranche total:    ${formatBaseUnits(streamSplit.trancheTotal, decimals)} ${symbol}\n` +
                  `  Total obligation:     ${formatBaseUnits(streamSplit.totalObligation, decimals)} ${symbol}\n` +
                  `  Reclaimable dust:     ${streamSplit.reclaimableDust.toString()} base units (${formatBaseUnits(streamSplit.reclaimableDust, decimals, decimals)} ${symbol})\n`,
              );
            }
          },
        );
        return;
      }

      if (sub === "team-create") {
        const csvPath = flags._[1];
        if (!csvPath || !flags.name) {
          throw new Error("Usage: talise-sui payroll team-create <file.csv> --name <teamName> [--yes]");
        }
        const rows = parseRosterCsv(readFileSync(csvPath, "utf8"), 6);
        const members = [];
        for (const r of rows) {
          const hit = await gql.resolveRecipient(r.recipient);
          members.push({ recipient: hit.address, amountMicro: r.amountBase, label: r.label });
        }
        const signer = requireSigner();
        const ok = await confirmAction(
          flags,
          `Create on-chain Team "${flags.name}" with ${members.length} members from ${signer.toSuiAddress()}?`,
        );
        if (!ok) return;
        const tx = buildTeamCreateTx({ name: flags.name, members });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, name: flags.name, memberCount: members.length, ...out }, () => {
          process.stdout.write(`✓ Team "${flags.name}" created -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      if (sub === "team-delete") {
        const teamId = flags._[1];
        if (!teamId) throw new Error("Usage: talise-sui payroll team-delete <teamObjectId> [--yes]");
        const signer = requireSigner();
        const ok = await confirmAction(flags, `Delete on-chain Team ${teamId}?`);
        if (!ok) return;
        const out = await executeTransaction(grpc, signer, buildTeamDeleteTx({ teamId }));
        emit(flags, { ok: true, teamId, ...out }, () => {
          process.stdout.write(`✓ Team deleted -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      if (sub === "stream-create") {
        const csvPath = flags._[1];
        if (!csvPath || !flags.total || !flags.tranches || !flags.intervalMin) {
          throw new Error(
            "Usage: talise-sui payroll stream-create <file.csv> --total <amt> --tranches <n> --interval-min <min> [--first-due-min <min>] [--yes]",
          );
        }
        const rows = parseRosterCsv(readFileSync(csvPath, "utf8"), decimals);
        const members = [];
        for (const r of rows) {
          members.push((await gql.resolveRecipient(r.recipient)).address);
        }
        const fundedBase = decimalToBaseUnits(flags.total, decimals);
        const split = computeTeamStreamSplit(fundedBase, flags.tranches, members.length);
        const intervalMs = Math.round(flags.intervalMin * 60_000);
        const firstDueMs = Date.now() + Math.round((flags.firstDueMin ?? flags.intervalMin) * 60_000);

        const signer = requireSigner();
        const coins = await gql.getOwnedCoins(signer.toSuiAddress(), coinType);
        const ok = await confirmAction(
          flags,
          `Fund TeamStream with ${formatBaseUnits(fundedBase, decimals)} ${symbol} (${split.numTranches} tranches, ${members.length} members, dust=${split.reclaimableDust})?`,
        );
        if (!ok) return;

        const tx = buildTeamStreamCreateTx({
          coinType,
          fundedBase,
          ownedCoins: coins,
          members,
          numTranches: flags.tranches,
          intervalMs,
          firstDueMs,
          creatorAddress: signer.toSuiAddress(),
        });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, split, ...out }, () => {
          process.stdout.write(`✓ TeamStream funded -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      if (sub === "stream-cancel" || sub === "stream-destroy") {
        const streamId = flags._[1];
        if (!streamId) throw new Error(`Usage: talise-sui payroll ${sub} <streamObjectId> [--yes]`);
        const obj = await gql.getMoveObject(streamId);
        if (!obj || !obj.coinType) throw new Error(`TeamStream ${streamId} not found`);
        const signer = requireSigner();
        const ok = await confirmAction(
          flags,
          `${sub === "stream-cancel" ? "Vesting-safe cancel_v2" : "Destroy"} TeamStream ${streamId}?`,
        );
        if (!ok) return;
        const tx =
          sub === "stream-cancel"
            ? buildTeamStreamCancelTx({
                streamId,
                coinType: obj.coinType,
                refundRecipient: signer.toSuiAddress(),
              })
            : buildTeamStreamDestroyTx({ streamId, coinType: obj.coinType });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, streamId, ...out }, () => {
          process.stdout.write(`✓ ${sub} complete -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      if (sub === "batch-send") {
        const csvPath = flags._[1];
        if (!csvPath) {
          throw new Error(
            "Usage: talise-sui payroll batch-send <file.csv> [--asset USDsui] [--with-receipt] [--max-total N] [--yes]",
          );
        }
        const rows = parseRosterCsv(readFileSync(csvPath, "utf8"), decimals);
        const legs = [];
        for (const r of rows) {
          if (r.amountBase <= 0n) {
            throw new Error(`CSV line ${r.line}: amount is required for batch-send`);
          }
          const hit = await gql.resolveRecipient(r.recipient);
          legs.push({ recipient: hit.address, amountBase: r.amountBase, memo: r.label });
        }
        const total = legs.reduce((acc, l) => acc + l.amountBase, 0n);
        if (flags.maxTotal) {
          const cap = decimalToBaseUnits(flags.maxTotal, decimals);
          if (total > cap) {
            throw new Error(
              `Batch total ${formatBaseUnits(total, decimals)} exceeds --max-total ${flags.maxTotal}`,
            );
          }
        }
        const signer = requireSigner();
        const coins = await gql.getOwnedCoins(signer.toSuiAddress(), coinType);
        const ok = await confirmAction(
          flags,
          `Atomically send ${formatBaseUnits(total, decimals)} ${symbol} to ${legs.length} recipients${flags.withReceipt ? " (with on-chain talise::send_v2 receipts)" : ""}?`,
        );
        if (!ok) return;
        const tx = buildAtomicBatchSendTx({
          coinType,
          assetSymbol: symbol,
          ownedCoins: coins,
          legs,
          withOnChainReceipt: flags.withReceipt,
        });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, recipients: legs.length, totalBase: total, ...out }, () => {
          process.stdout.write(`✓ Paid ${legs.length} recipients -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      throw new Error(
        "Usage: talise-sui payroll <plan|team-create|team-delete|stream-create|stream-cancel|stream-destroy|batch-send>",
      );
    }

    case "orders": {
      const sub = flags._[0];
      const { coinType, decimals, symbol } = resolveCoinType(flags.asset);

      if (sub === "create") {
        const recipientRaw = flags._[1];
        if (!recipientRaw || !flags.amountPer || !flags.total || !flags.intervalMin) {
          throw new Error(
            "Usage: talise-sui orders create <recipient> --amount-per <amt> --total <amt> --interval-min <min> [--first-due-min <min>] [--yes]",
          );
        }
        const recipient = (await gql.resolveRecipient(recipientRaw)).address;
        const amountPerBase = decimalToBaseUnits(flags.amountPer, decimals);
        const fundedBase = decimalToBaseUnits(flags.total, decimals);
        const intervalMs = Math.round(flags.intervalMin * 60_000);
        const firstDueMs = Date.now() + Math.round((flags.firstDueMin ?? flags.intervalMin) * 60_000);

        const signer = requireSigner();
        const coins = await gql.getOwnedCoins(signer.toSuiAddress(), coinType);
        const ok = await confirmAction(
          flags,
          `Create StandingOrder funding ${formatBaseUnits(fundedBase, decimals)} ${symbol} (${formatBaseUnits(amountPerBase, decimals)} every ${flags.intervalMin}m to ${recipient})?`,
        );
        if (!ok) return;
        const tx = buildStandingOrderCreateTx({
          coinType,
          fundedBase,
          ownedCoins: coins,
          recipient,
          amountPerBase,
          intervalMs,
          firstDueMs,
        });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, recipient, ...out }, () => {
          process.stdout.write(`✓ StandingOrder created -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      if (sub === "pause" || sub === "resume" || sub === "cancel") {
        const orderId = flags._[1];
        if (!orderId) throw new Error(`Usage: talise-sui orders ${sub} <orderObjectId> [--yes]`);
        const obj = await gql.getMoveObject(orderId);
        if (!obj || !obj.coinType) throw new Error(`StandingOrder ${orderId} not found`);
        const signer = requireSigner();
        const ok = await confirmAction(flags, `${sub} StandingOrder ${orderId}?`);
        if (!ok) return;
        const tx =
          sub === "cancel"
            ? buildStandingOrderCancelTx({
                orderId,
                coinType: obj.coinType,
                refundRecipient: signer.toSuiAddress(),
              })
            : buildStandingOrderPauseTx({
                orderId,
                coinType: obj.coinType,
                pause: sub === "pause",
              });
        const out = await executeTransaction(grpc, signer, tx);
        emit(flags, { ok: true, orderId, action: sub, ...out }, () => {
          process.stdout.write(`✓ StandingOrder ${sub}d -> ${out.suiscanUrl}\n`);
        });
        return;
      }

      throw new Error("Usage: talise-sui orders <create|pause|resume|cancel>");
    }

    default:
      throw new Error(`Unknown command: ${cmd} (run \`talise-sui help\`)`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  } else {
    process.stderr.write(`Error: ${msg}\n`);
  }
  process.exit(1);
});
