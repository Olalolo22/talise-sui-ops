import { readFileSync } from "node:fs";
import { decodeSuiPrivateKey, type Keypair } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import type { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { SUI_MAINNET_GRPC_URL } from "./constants.js";

/**
 * Load a standard Sui keypair from:
 *   - Bech32 `suiprivkey1...` string (Ed25519 / Secp256k1 / Secp256r1)
 *   - 64-char hex 32-byte Ed25519 seed (optional `0x` prefix)
 *   - Base64 32-byte Ed25519 seed (or 33-byte Sui keystore entry `[flag, ...32]`)
 *   - Path to a single-line key file
 */
export function loadSuiKeypair(rawOrPath: string): Keypair {
  const input = rawOrPath.trim();
  if (!input) {
    throw new Error("Missing Sui signer key: set SUI_PRIVATE_KEY=suiprivkey1...");
  }
  const secret =
    input.startsWith("/") || input.startsWith("./") || input.startsWith("~")
      ? readFileSync(input, "utf8").trim()
      : input;

  if (secret.startsWith("suiprivkey1")) {
    const parsed = decodeSuiPrivateKey(secret);
    if (parsed.scheme === "ED25519") return Ed25519Keypair.fromSecretKey(parsed.secretKey);
    if (parsed.scheme === "Secp256k1") return Secp256k1Keypair.fromSecretKey(parsed.secretKey);
    if (parsed.scheme === "Secp256r1") return Secp256r1Keypair.fromSecretKey(parsed.secretKey);
    throw new Error(`Unsupported Sui key scheme: ${parsed.scheme}`);
  }

  const hexClean = secret.startsWith("0x") ? secret.slice(2) : secret;
  if (/^[0-9a-fA-F]{64}$/.test(hexClean)) {
    const bytes = new Uint8Array(Buffer.from(hexClean, "hex"));
    return Ed25519Keypair.fromSecretKey(bytes);
  }

  try {
    const decoded = fromBase64(secret);
    if (decoded.length === 32) {
      return Ed25519Keypair.fromSecretKey(decoded);
    }
    if (decoded.length === 33 && decoded[0] === 0) {
      return Ed25519Keypair.fromSecretKey(decoded.slice(1));
    }
  } catch {
    // Fall through to validation error.
  }

  throw new Error(
    "Unrecognized SUI_PRIVATE_KEY format (expected suiprivkey1..., 64-char hex seed, or 32-byte base64 seed)",
  );
}

export function createSuiGrpcClient(opts?: {
  baseUrl?: string;
  network?: "mainnet" | "testnet" | "devnet";
}): SuiGrpcClient {
  return new SuiGrpcClient({
    network: opts?.network ?? "mainnet",
    baseUrl: opts?.baseUrl ?? SUI_MAINNET_GRPC_URL,
  });
}

export type ExecutionOutcome = {
  digest: string;
  suiscanUrl: string;
  status: "success";
};

/**
 * Sign, execute, and confirm a Transaction over Sui gRPC.
 * Fails loudly if on-chain `effects.status` is not successful (never returns
 * success on an aborted Move transaction).
 */
export async function executeTransaction(
  grpc: SuiGrpcClient,
  signer: Keypair,
  tx: Transaction,
): Promise<ExecutionOutcome> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  const res = await grpc.signAndExecuteTransaction({
    signer,
    transaction: tx,
    include: { effects: true },
  });

  if (res.$kind === "FailedTransaction") {
    const failed = res.FailedTransaction;
    const errText = failed.status.error?.message ?? "Transaction aborted on-chain";
    throw new Error(`Transaction ${failed.digest} failed on-chain: ${errText}`);
  }

  const okTx = res.Transaction;
  if (!okTx.status.success) {
    throw new Error(
      `Transaction ${okTx.digest} failed on-chain: ${okTx.status.error?.message ?? "unknown error"}`,
    );
  }

  await grpc.waitForTransaction({ digest: okTx.digest });

  return {
    digest: okTx.digest,
    suiscanUrl: `https://suiscan.xyz/mainnet/tx/${okTx.digest}`,
    status: "success",
  };
}
