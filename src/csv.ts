import { decimalToBaseUnits } from "./constants.js";

export type RosterCsvRow = {
  line: number;
  recipient: string;
  amountBase: bigint;
  label: string;
};

export type TeamStreamSplit = {
  fundedBase: bigint;
  numTranches: number;
  memberCount: number;
  perMemberPerTranche: bigint;
  trancheTotal: bigint;
  totalObligation: bigint;
  reclaimableDust: bigint;
};

const MAX_ROSTER_ROWS = 256;

export function detectDelimiter(content: string): "," | ";" | "\t" {
  const first = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
  if (!first) return ",";
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  const tabs = (first.match(/\t/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

export function splitCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (inQuotes) throw new Error(`Unterminated quote in CSV line: ${line.slice(0, 60)}`);
  cells.push(cur.trim());
  return cells;
}

/**
 * Parse a payroll/team roster CSV (`recipient,amount[,label]` or `name,recipient,amount[,label]`).
 * Supports `@handle`, `handle@talise`, `handle.talise.sui`, `.sui`, or `0x...` addresses.
 */
export function parseRosterCsv(content: string, decimals = 6): RosterCsvRow[] {
  const cleaned = content.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(cleaned);
  const rawLines = cleaned.split(/\r?\n/);

  const nonEmpty: { line: number; cells: string[] }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    nonEmpty.push({ line: i + 1, cells: splitCsvLine(line, delim) });
  }
  if (nonEmpty.length === 0) throw new Error("CSV file is empty");

  let start = 0;
  let recipientIdx = 0;
  let amountIdx = 1;
  let labelIdx = 2;

  const firstLower = nonEmpty[0]!.cells.map((c) => c.toLowerCase());
  const hasHeader = firstLower.some((h) =>
    ["recipient", "to", "address", "handle", "amount", "amount_usd", "salary"].includes(h),
  );

  if (hasHeader) {
    start = 1;
    recipientIdx = firstLower.findIndex((h) =>
      ["recipient", "to", "address", "handle", "member"].includes(h),
    );
    amountIdx = firstLower.findIndex((h) =>
      ["amount", "amount_usd", "usd", "salary"].includes(h),
    );
    labelIdx = firstLower.findIndex((h) => ["label", "name", "role", "note", "memo"].includes(h));
    if (recipientIdx < 0) {
      throw new Error('CSV header must include a recipient column ("recipient", "to", or "address")');
    }
  } else if (nonEmpty[0]!.cells.length >= 3 && !looksLikeAmount(nonEmpty[0]!.cells[1]!)) {
    // Support headerless `label,recipient,amount`
    labelIdx = 0;
    recipientIdx = 1;
    amountIdx = 2;
  }

  const rows: RosterCsvRow[] = [];
  for (let i = start; i < nonEmpty.length; i++) {
    const entry = nonEmpty[i]!;
    const recipient = (entry.cells[recipientIdx] ?? "").trim();
    if (!recipient) throw new Error(`CSV line ${entry.line}: missing recipient`);
    const rawAmt = amountIdx >= 0 ? (entry.cells[amountIdx] ?? "").trim() : "";
    const amountBase = rawAmt ? decimalToBaseUnits(rawAmt, decimals) : 0n;
    const label = labelIdx >= 0 ? (entry.cells[labelIdx] ?? "").trim() : "";
    rows.push({ line: entry.line, recipient, amountBase, label });
  }

  if (rows.length === 0) throw new Error("CSV contains no data rows");
  if (rows.length > MAX_ROSTER_ROWS) {
    throw new Error(`CSV exceeds Move MAX_MEMBERS (${MAX_ROSTER_ROWS})`);
  }
  return rows;
}

function looksLikeAmount(raw: string): boolean {
  return /^\$?\d[\d,]*(?:\.\d+)?$/.test(raw.trim());
}

/**
 * Compute exact integer truncation math matching `talise_payroll_streams::team_stream`:
 *   per_member = (funded / num_tranches) / member_count
 *   tranche_total = per_member * member_count
 *   obligation = tranche_total * num_tranches
 *   dust = funded - obligation
 */
export function computeTeamStreamSplit(
  fundedBase: bigint,
  numTranches: number,
  memberCount: number,
): TeamStreamSplit {
  if (!Number.isInteger(numTranches) || numTranches < 1 || numTranches > 365) {
    throw new Error("numTranches must be an integer between 1 and 365");
  }
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 50) {
    throw new Error("memberCount must be an integer between 1 and 50");
  }
  if (fundedBase <= 0n) {
    throw new Error("fundedBase must be positive");
  }
  const k = BigInt(numTranches);
  const n = BigInt(memberCount);
  const perMemberPerTranche = fundedBase / k / n;
  if (perMemberPerTranche <= 0n) {
    throw new Error("Funded amount is too small: per-member share truncates to 0");
  }
  const trancheTotal = perMemberPerTranche * n;
  const totalObligation = trancheTotal * k;
  const reclaimableDust = fundedBase - totalObligation;
  return {
    fundedBase,
    numTranches,
    memberCount,
    perMemberPerTranche,
    trancheTotal,
    totalObligation,
    reclaimableDust,
  };
}

/** Neutralize spreadsheet formula prefixes (`=`, `+`, `-`, `@`, tab, CR). */
export function escapeCsvCell(raw: string | number | bigint | null | undefined): string {
  const s = raw === null || raw === undefined ? "" : String(raw);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
