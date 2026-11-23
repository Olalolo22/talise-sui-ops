import { execFile, execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadSuiKeypair } from "../src/signer.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bin = resolve(root, "dist", "cli.js");

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((r) => {
    execFile("node", [bin, ...args], { encoding: "utf8" }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: unknown }).code === "number"
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
      r({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

beforeAll(() => {
  execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 60_000);

describe("talise-sui CLI binary & signer", () => {
  it("prints version and help cleanly", async () => {
    expect((await run(["--version"])).stdout).toMatch(/^talise-sui \d+\.\d+\.\d+/);
    expect((await run(["help"])).stdout).toContain("Permissionless Mainnet Cranker");
  });

  it("rejects unknown flags cleanly", async () => {
    const res = await run(["crank", "--wat"]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/Unknown flag/i);
  });

  it("loads 64-char hex Ed25519 keypairs cleanly and rejects garbage", () => {
    const kp = loadSuiKeypair("11".repeat(32));
    expect(kp.toSuiAddress()).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => loadSuiKeypair("not-a-key")).toThrow(/Unrecognized/);
  });
});
