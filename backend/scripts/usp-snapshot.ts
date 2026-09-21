/**
 * USP parameter snapshot + diff tool.
 *
 * Usage:
 *   bun run usp:snapshot -- --agent proto::FHTTC051E643 --label fh-before
 *   bun run usp:snapshot -- diff docs/snapshots/fh-before.json docs/snapshots/fh-after.json [--only Link,VLAN,PPP] [--include-stats]
 *
 * Env:
 *   USP_API   controller base URL (default http://192.168.1.100:3000)
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

const API = process.env.USP_API || "http://192.168.1.100:3000";
const args = process.argv.slice(2);
const mode = args[0] || "snapshot";

function argOf(name: string, def = ""): string {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const NOISE = /\.Stats\.|Uptime|LastChange|PacketsSent|PacketsReceived|BytesSent|BytesReceived|Throughput|LastPeriod|ErrorsSent|ErrorsReceived/;

async function snapshot() {
  const agent = argOf("--agent");
  const label = argOf("--label");
  if (!agent || !label) {
    console.error("usage: snapshot --agent <id> --label <name>");
    process.exit(1);
  }

  const res = await fetch(`${API}/api/usp/${encodeURIComponent(agent)}/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["Device."], maxDepth: 0, timeout: 60 }),
  });
  if (!res.ok) {
    console.error(`GET failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const j = (await res.json()) as any;
  const reqs = j?.result?.msg?.body?.response?.get_resp?.req_path_results || [];
  const map: Record<string, string> = {};
  for (const rq of reqs) {
    for (const rp of rq.resolved_path_results || []) {
      const base = rp.resolved_path || rq.requested_path || "";
      for (const [k, v] of Object.entries(rp.result_params || {})) {
        map[`${base}${k}`] = String(v);
      }
    }
  }

  const keys = Object.keys(map).sort();
  const sorted: Record<string, string> = {};
  for (const k of keys) sorted[k] = map[k];

  const out = resolve(`docs/snapshots/${label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(sorted, null, 2));
  console.log(`[+] ${keys.length} parameters -> ${out}`);
}

function diff() {
  const aPath = args[1];
  const bPath = args[2];
  if (!aPath || !bPath) {
    console.error("usage: diff <a.json> <b.json> [--only substr] [--include-stats]");
    process.exit(1);
  }
  const a = JSON.parse(readFileSync(resolve(aPath), "utf8")) as Record<string, string>;
  const b = JSON.parse(readFileSync(resolve(bPath), "utf8")) as Record<string, string>;
  const only = argOf("--only");
  const includeStats = args.includes("--include-stats");
  const onlyMatch = (k: string) => !only || only.split(",").some((s) => k.toLowerCase().includes(s.toLowerCase().trim()));
  const noiseMatch = (k: string) => !includeStats && NOISE.test(k);

  const added = Object.keys(b).filter((k) => !(k in a) && onlyMatch(k) && !noiseMatch(k));
  const removed = Object.keys(a).filter((k) => !(k in b) && onlyMatch(k) && !noiseMatch(k));
  const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k] && onlyMatch(k) && !noiseMatch(k));

  const lines: string[] = [];
  lines.push(`# diff ${aPath} -> ${bPath}`);
  lines.push(`# added ${added.length} | removed ${removed.length} | changed ${changed.length} (stats excluded: ${!includeStats})`);
  lines.push("");
  lines.push(`## ADDED (${added.length})`);
  for (const k of added) lines.push(`+ ${k} = ${b[k]}`);
  lines.push("");
  lines.push(`## REMOVED (${removed.length})`);
  for (const k of removed) lines.push(`- ${k} = ${a[k]}`);
  lines.push("");
  lines.push(`## CHANGED (${changed.length})`);
  for (const k of changed) lines.push(`~ ${k}: ${a[k] || "(empty)"} -> ${b[k] || "(empty)"}`);

  const outPath = resolve(`${bPath.replace(/\.json$/, "")}.diff.txt`);
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(lines.slice(0, 120).join("\n"));
  console.log(`\n[+] full diff (${added.length + removed.length + changed.length} entries) -> ${outPath}`);
}

if (mode === "diff") diff();
else await snapshot();
