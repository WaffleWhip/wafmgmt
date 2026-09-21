import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { db, type DBConfig, type DBService, type DBRoute, type DBNginxRoute, type DBPeerMeta } from "./storage";
import { telemetryStatus, startTelemetry, stopTelemetry, telemetrySamples, TELEMETRY_METRICS } from "./telemetry";

const PORT = parseInt(process.env.PORT || "3000");
const LAB_ID = process.env.LAB_ID || "[lab-id]";
const DATA_DIR = process.env.DATA_DIR || "/data";

const WG_CONFIG_DIR = process.env.WG_CONFIG_DIR || "/etc/wireguard";
const WG_CONFIG_FILE = join(WG_CONFIG_DIR, "wg0.conf");
const SERVER_PUBKEY_FILE = join(WG_CONFIG_DIR, "server_public.key");
const SERVER_PRIVKEY_FILE = join(WG_CONFIG_DIR, "server_private.key");
const NGINX_CONF_DIR = join(DATA_DIR, "nginx", "conf.d");
const NGINX_ROUTES_FILE = join(NGINX_CONF_DIR, "50-wafmgmt-routes.conf");
const NGINX_CONTAINER = process.env.NGINX_CONTAINER || "proxy-tls";
const NGINX_CERT = process.env.NGINX_CERT || "/etc/nginx/certs/server.crt";
const NGINX_KEY = process.env.NGINX_KEY || "/etc/nginx/certs/server.key";
const DOCKER_SOCK = process.env.DOCKER_SOCK || "/var/run/docker.sock";
const LOGO_DIR = join(DATA_DIR, "core", "logo");
const BRAND_DIR = join(DATA_DIR, "core", "brand");
const USP_SERVICE_URL = process.env.USP_SERVICE_URL || "http://127.0.0.1:8000";
const HOST_SYSNET = "/host-sys-net";
const HOST_PROCNET = "/host-proc-net";

function runCmd(cmd: string[]): string {
  try {
    const proc = Bun.spawnSync(cmd, { stderr: "pipe" });
    return proc.stdout.toString();
  } catch {
    return "";
  }
}

interface NetworkInterface {
  name: string;
  state: string;
  mac: string | null;
  mtu: number | null;
  speedMbps: number | null;
  isVirtual: boolean;
  addresses: Array<{ family: string; address: string; prefix: number }>;
}

let networkCache: { at: number; payload: any } | null = null;

function readBase(path: string, file: string): string {
  try { return readFileSync(join(path, file), "utf-8").trim(); } catch { return ""; }
}

function expandIpv6(hex: string): string {
  if (hex.length !== 32) return hex;
  const parts: string[] = [];
  for (let i = 0; i < 32; i += 4) {
    let seg = hex.substring(i, i + 4);
    parts.push(seg.replace(/^0+/, "") || "0");
  }
  let collapsed = parts.join(":");
  collapsed = collapsed.replace(/(^|:)(0(:0)+)(?=:|$)/, "::").replace(/^:::/, "::").replace(/::+/, "::");
  return collapsed;
}

function readIfacesContainer(): NetworkInterface[] {
  const out: NetworkInterface[] = [];
  try {
    const raw = runCmd(["ip", "-j", "addr"]);
    if (!raw) return out;
    const arr = JSON.parse(raw);
    for (const i of arr) {
      if (i.ifname === "lo") continue;
      out.push({
        name: i.ifname,
        state: (i.operstate || "UNKNOWN").toUpperCase(),
        mac: i.address || null,
        mtu: i.mtu ?? null,
        speedMbps: i.linkinfo?.speed ?? null,
        isVirtual: ["dummy", "veth", "bridge"].includes(i.link_type) ||
                   !!i.linkinfo?.info_slave_data ||
                   i.ifname.startsWith("br-") ||
                   i.ifname.startsWith("veth") ||
                   i.ifname === "docker0",
        addresses: (i.addr_info || []).map((a: any) => ({
          family: (a.family === "inet6" || a.family === 10) ? "ipv6" : "ipv4",
          address: a.local,
          prefix: a.prefixlen
        }))
      });
    }
  } catch {}
  return out;
}

function readIfacesHost(): NetworkInterface[] {
  if (!existsSync(HOST_SYSNET)) return [];
  const out: NetworkInterface[] = [];
  let names: string[] = [];
  try { names = Bun.spawnSync(["ls", HOST_SYSNET]).stdout.toString().trim().split("\n"); } catch { return []; }
  const ipv6ByIface = new Map<string, Array<{ address: string; prefix: number }>>();
  if (existsSync(HOST_PROCNET)) {
    try {
      const text = readFileSync(join(HOST_PROCNET, "if_inet6"), "utf-8");
      for (const line of text.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const name = parts[parts.length - 1];
        if (name === "lo") continue;
        const addr = expandIpv6(parts.slice(0, 4).join(""));
        const prefix = parseInt(parts[4]) || 64;
        const arr = ipv6ByIface.get(name) ?? [];
        arr.push({ address: addr, prefix });
        ipv6ByIface.set(name, arr);
      }
    } catch {}
  }
  for (const name of names) {
    if (!name || name === "lo") continue;
    const base = join(HOST_SYSNET, name);
    const state = (readBase(base, "operstate") || "UNKNOWN").toUpperCase();
    const mac = readBase(base, "address") || null;
    const mtu = parseInt(readBase(base, "mtu")) || null;
    let speedMbps: number | null = null;
    const s = readBase(base, "speed");
    if (s && /^\d+$/.test(s) && parseInt(s) > 0) speedMbps = parseInt(s);
    const type = readBase(base, "type");
    const isVirtual = ["dummy", "bridge"].includes(type);
    out.push({
      name,
      state,
      mac,
      mtu,
      speedMbps,
      isVirtual,
      addresses: (ipv6ByIface.get(name) ?? []).map((a) => ({ family: "ipv6", ...a }))
    });
  }
  return out;
}

function readDefaultRouteContainer(): any {
  try {
    const out = runCmd(["ip", "-j", "route", "show", "default"]).trim();
    if (!out) return null;
    const routes = JSON.parse(out);
    const r = routes[0];
    if (!r) return null;
    return { gateway: r.gateway, iface: r.dev, metric: r.metric };
  } catch { return null; }
}

function readDefaultRouteHost(): any {
  if (!existsSync(HOST_PROCNET)) return null;
  try {
    const text = readFileSync(join(HOST_PROCNET, "route"), "utf-8");
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      if (parts[0] !== "00000000" || parts[1] !== "00000000") continue;
      const gw = parts[2];
      const flags = parts[3];
      const gwIp = `${parseInt(gw.slice(6, 8), 16)}.${parseInt(gw.slice(4, 6), 16)}.${parseInt(gw.slice(2, 4), 16)}.${parseInt(gw.slice(0, 2), 16)}`;
      const iface = parts[parts.length - 1];
      return { gateway: gwIp, iface, metric: null };
    }
  } catch {}
  return null;
}

function getNetworkInfo(force = false): any {
  const now = Date.now();
  if (!force && networkCache && now - networkCache.at < 5000) {
    return networkCache.payload;
  }
  let interfaces = readIfacesContainer();
  let defaultRoute = readDefaultRouteContainer();

  const hasIpv4 = interfaces.some(i => i.addresses.some(a => a.family === "ipv4"));
  if (!hasIpv4 && existsSync(HOST_SYSNET)) {
    const hostIfaces = readIfacesHost();
    if (hostIfaces.length > 0) {
      interfaces = hostIfaces;
      defaultRoute = readDefaultRouteHost();
    }
  }

  const payload = { interfaces, defaultRoute, source: "host", ts: now };
  networkCache = { at: now, payload };
  return payload;
}

// Active SSE client dispatchers
const sseClients = new Set<(chunk: Uint8Array) => void>();

// Real-time peer packet activity map
const peerActivityMap: Record<string, { lastRx: number; lastActiveTs: number }> = {};

function broadcastSSE(type: string, data: any) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  const encoded = new TextEncoder().encode(payload);
  for (const send of sseClients) {
    try {
      send(encoded);
    } catch {}
  }
}

async function initStorage() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(join(DATA_DIR, "nginx"), { recursive: true });
    mkdirSync(join(DATA_DIR, "adguard", "conf"), { recursive: true });
    mkdirSync(join(DATA_DIR, "adguard", "work"), { recursive: true });
    mkdirSync(BRAND_DIR, { recursive: true });

    // Migrate legacy data/logo and data/brand into data/core/*
    for (const dir of ["logo", "brand"]) {
      const legacy = join(DATA_DIR, dir);
      const target = join(DATA_DIR, "core", dir);
      try {
        if (existsSync(legacy)) {
          mkdirSync(target, { recursive: true });
          for (const f of readdirSync(legacy)) {
            const src = join(legacy, f);
            const dst = join(target, f);
            if (!existsSync(dst)) { try { renameSync(src, dst); } catch {} }
          }
        }
      } catch {}
    }

    await db.init();

    // 1. Initial Default Config if empty
    let currentConfig = await db.getConfig();
    if (!currentConfig || Object.keys(currentConfig).length === 0) {
      const initialCfg: DBConfig = {
        brandName: "[brand]",
        brandSubtitle: "[subheader]",
        logoUrl: "",
        title: "[app-title]",
        subtitle: "[app-subtitle]",
        primaryColor: "[primary-color]",
        accentColor: "[accent-color]",
        adminUser: "[admin-user]",
        adminPass: "[admin-pass]",
        endpointWan: "[endpoint:port]",
        interface: "[wg-interface]",
        address: "[wg-address]",
        listenPort: 51820,
        dnsDefault: "[dns-default]",
        allowedIpsTemplate: "[allowed-ips]",
        keepaliveDefault: 15
      };
      await db.saveConfig(initialCfg);
    }

    // 2. Sync peers from kernel
    try {
      const wgProc = Bun.spawnSync(["wg", "show", "wg0", "dump"], { stderr: "pipe" });
      const wgOut = wgProc.stdout.toString();
      const wgLines = wgOut.trim().split("\n").slice(1);
      const existingMeta = await db.getPeersMeta();
      for (const line of wgLines) {
        const parts = line.split("\t");
        if (parts.length < 5) continue;
        const [pubkey, , , allowedIps] = parts;
        if (!existingMeta[pubkey]) {
          await db.savePeerMeta({
            pubkey,
            name: "Client-" + pubkey.substring(0, 6),
            ip: allowedIps,
            dns: "[dns-default]",
            allowedIps: "[allowed-ips]",
            conf: "",
            createdAt: Math.floor(Date.now() / 1000)
          });
        }
      }
    } catch (e) {
      // WireGuard kernel interface might not exist in dev container
    }

    initWireGuardServer();
    await initNginxConfig();
  } catch (e) {
    console.error("Storage init error:", e);
  }
}

function initWireGuardServer() {
  try {
    mkdirSync(WG_CONFIG_DIR, { recursive: true });

    if (!existsSync(SERVER_PRIVKEY_FILE) || !existsSync(SERVER_PUBKEY_FILE)) {
      const privProc = Bun.spawnSync(["wg", "genkey"]);
      const priv = privProc.stdout.toString().trim();
      const pubProc = Bun.spawnSync(["wg", "pubkey"], { stdin: new TextEncoder().encode(priv) });
      const pub = pubProc.stdout.toString().trim();

      if (priv && pub) {
        writeFileSync(SERVER_PRIVKEY_FILE, priv, "utf-8");
        writeFileSync(SERVER_PUBKEY_FILE, pub, "utf-8");
      }
    }

    try { Bun.spawnSync(["wg-quick", "up", "wg0"]); } catch {}
  } catch (e) {}
}

async function initNginxConfig() {
  const routes = await db.getNginxRoutes();
  generateAndReloadNginx(routes);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function wgSet(args: string[]): void {
  try {
    Bun.spawnSync(["wg", "set", "wg0", ...args], { stderr: "pipe" });
  } catch {}
}

function wgQuickSave(): void {
  try {
    Bun.spawn(["wg-quick", "save", "wg0"], { stderr: "pipe" });
  } catch {}
}

function getServerPubkey(): string {
  if (existsSync(SERVER_PUBKEY_FILE)) {
    const key = readFileSync(SERVER_PUBKEY_FILE, "utf-8").trim();
    if (key) return key;
  }
  return "";
}

function normalizeUpstream(upstream: string): string {
  if (!upstream) return upstream;
  return /^https?:\/\//i.test(upstream) ? upstream : `http://${upstream}`;
}

function nginxServerBlock(r: DBNginxRoute): string {
  const upstream = normalizeUpstream(r.upstream);

  // When the upstream targets a sub-path (e.g. http://host/myadmin/), nginx
  // strips it from the browser URL, but the upstream app may still scope its
  // cookies to that sub-path (e.g. phpMyAdmin sets path=/myadmin/). Rewrite
  // those cookie paths back to "/" so sessions work behind the proxy.
  let upstreamPath = "";
  try {
    const parsed = new URL(upstream);
    if (parsed.pathname && parsed.pathname !== "/") upstreamPath = parsed.pathname;
  } catch {
    /* not a valid URL — skip cookie rewrite */
  }

  const lines: string[] = [
    `server {`,
    `    listen 80;`,
    `    listen [::]:80;`,
    `    listen 443 ssl;`,
    `    listen [::]:443 ssl;`,
    `    http2 on;`,
    `    server_name ${r.domain};`,
    `    ssl_certificate     ${NGINX_CERT};`,
    `    ssl_certificate_key ${NGINX_KEY};`,
    `    ssl_protocols TLSv1.2 TLSv1.3;`,
    ``,
    `    location / {`,
    `        proxy_pass ${upstream};`
  ];
  if (upstreamPath) lines.push(`        proxy_cookie_path ${upstreamPath} /;`);
  if (r.skipTlsVerify === true) lines.push(`        proxy_ssl_verify off;`);
  lines.push(
    `        proxy_set_header Host $host;`,
    `        proxy_set_header X-Real-IP $remote_addr;`,
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto $scheme;`,
    `        proxy_http_version 1.1;`,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection "upgrade";`,
    `        proxy_buffering off;`,
    `        proxy_read_timeout 300s;`,
    `    }`,
    `}`
  );
  return lines.join("\n");
}

function buildNginxRoutes(routes: DBNginxRoute[]): string {
  const header = "# Auto-generated by wafmgmt. Do not edit manually.";
  const blocks = routes
    .filter((r) => r.enabled !== false && r.domain && r.upstream)
    .map((r) => nginxServerBlock(r));
  return blocks.length ? `${header}\n\n${blocks.join("\n\n")}\n` : `${header}\n`;
}

function generateAndReloadNginx(routes: DBNginxRoute[]): string {
  const conf = buildNginxRoutes(routes);
  try {
    mkdirSync(NGINX_CONF_DIR, { recursive: true });
    writeFileSync(NGINX_ROUTES_FILE, conf, "utf-8");
  } catch (e: any) {
    console.warn("Failed to write nginx config:", e?.message || e);
  }
  reloadNginx();
  return conf;
}

async function reloadNginx(): Promise<void> {
  try {
    const res = await fetch(`http://localhost/containers/${NGINX_CONTAINER}/kill?signal=HUP`, {
      method: "POST",
      // Bun Unix domain socket option
      unix: DOCKER_SOCK
    } as any);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`nginx reload failed (${res.status}): ${body}`);
    }
  } catch (e: any) {
    console.warn("nginx reload error:", e?.message || e);
  }
}

async function getRealPeers() {
  const meta = await db.getPeersMeta();
  const cfg = await db.getConfig();

  const peersMap: Record<string, any> = {};
  let totalRx = 0;
  let totalTx = 0;
  const now = Math.floor(Date.now() / 1000);

  // 1. Initialize all peers from PostgreSQL single source of truth
  for (const [pubkey, m] of Object.entries(meta)) {
    peersMap[pubkey] = {
      pubkey,
      name: m.name || "Client-" + pubkey.substring(0, 6),
      ip: m.ip || "10.8.0.x",
      endpoint: "-",
      rx: "0 B",
      tx: "0 B",
      rxBytes: 0,
      txBytes: 0,
      lastHandshake: "Never",
      online: false,
      conf: m.conf || "",
      dns: m.dns || cfg.dnsDefault || "10.8.0.1",
      allowedIpsStr: m.allowedIps || cfg.allowedIpsTemplate || "10.8.0.0/24"
    };
  }

  // 2. Overlay live kernel metrics if WireGuard interface is present
  try {
    const proc = Bun.spawn(["wg", "show", "wg0", "dump"], { stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    const lines = output.trim().split("\n");

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length >= 8) {
        const [pubkey, , endpoint, allowedIps, latestHandshake, rx, tx] = parts;
        const rxBytes = parseInt(rx) || 0;
        const txBytes = parseInt(tx) || 0;
        const handshakeTs = parseInt(latestHandshake) || 0;

        totalRx += rxBytes;
        totalTx += txBytes;

        const prev = peerActivityMap[pubkey];
        if (!prev) {
          peerActivityMap[pubkey] = { lastRx: rxBytes, lastActiveTs: handshakeTs };
        } else {
          if (rxBytes > prev.lastRx) {
            peerActivityMap[pubkey] = { lastRx: rxBytes, lastActiveTs: now };
          } else if (handshakeTs > prev.lastActiveTs) {
            peerActivityMap[pubkey].lastActiveTs = handshakeTs;
          }
        }

        const lastActiveTs = peerActivityMap[pubkey]?.lastActiveTs || handshakeTs;
        const isOnline = handshakeTs > 0 && (now - handshakeTs < 45) && (now - lastActiveTs < 45);

        let handshakeStr = "Never";
        if (handshakeTs > 0) {
          const diff = now - handshakeTs;
          if (diff < 60) handshakeStr = `${diff}s ago`;
          else if (diff < 3600) handshakeStr = `${Math.floor(diff / 60)}m ago`;
          else if (diff < 86400) handshakeStr = `${Math.floor(diff / 3600)}h ago`;
          else handshakeStr = `${Math.floor(diff / 86400)}d ago`;
        }

        if (peersMap[pubkey]) {
          peersMap[pubkey].endpoint = endpoint !== "(none)" ? endpoint : "-";
          peersMap[pubkey].rx = formatBytes(rxBytes);
          peersMap[pubkey].tx = formatBytes(txBytes);
          peersMap[pubkey].rxBytes = rxBytes;
          peersMap[pubkey].txBytes = txBytes;
          peersMap[pubkey].lastHandshake = handshakeStr;
          peersMap[pubkey].online = isOnline;
          if (allowedIps && allowedIps !== "(none)") {
            peersMap[pubkey].ip = allowedIps;
          }
        } else {
          peersMap[pubkey] = {
            pubkey,
            name: "Client-" + pubkey.substring(0, 6),
            ip: allowedIps,
            endpoint: endpoint !== "(none)" ? endpoint : "-",
            rx: formatBytes(rxBytes),
            tx: formatBytes(txBytes),
            rxBytes,
            txBytes,
            lastHandshake: handshakeStr,
            online: isOnline,
            conf: "",
            dns: cfg.dnsDefault || "10.8.0.1",
            allowedIpsStr: cfg.allowedIpsTemplate || "10.8.0.0/24"
          };
        }
      }
    }
  } catch {}

  const peers = Object.values(peersMap);

  return {
    peers,
    totalRx: formatBytes(totalRx),
    totalTx: formatBytes(totalTx),
    serverPubkey: getServerPubkey() || cfg.serverPubkey || "uKwCdGiNR8Mx3FetK72EOhpnJzgm2XzMtUjU2DRnCFs=",
    endpointWan: cfg.endpointWan || "vpn.example.com:51820",
    interface: cfg.interface || "wg0",
    address: cfg.address || "10.8.0.1/24"
  };
}

async function getFullState() {
  const [peersData, config, services, routes, nginxRoutes, devices] = await Promise.all([
    getRealPeers(),
    db.getConfig(),
    db.getServices(),
    db.getRoutes(),
    db.getNginxRoutes(),
    db.listDevices()
  ]);

  return {
    peers: peersData.peers,
    totalRx: peersData.totalRx,
    totalTx: peersData.totalTx,
    serverPubkey: peersData.serverPubkey,
    endpointWan: peersData.endpointWan,
    config,
    services,
    routes,
    nginxRoutes,
    devices,
    topology: [],
    cluster: []
  };
}

initStorage();

console.log(`Starting WAFMGMT Gateway Engine (${LAB_ID}) with File-Based Storage on port ${PORT}...`);

const sshSessions = new Map<string, any>();

export async function coreFetch(req: Request, server: any): Promise<Response | undefined> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ssh") {
      const ip = url.searchParams.get("ip") || "";
      const port = url.searchParams.get("port") || "22";
      const deviceId = url.searchParams.get("deviceId") || "";

      const upgraded = server.upgrade(req, {
        data: {
          ip,
          port,
          deviceId
        }
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (path === "/api/stream" || path === "/api/events") {
      let sendFn: (chunk: Uint8Array) => void;
      let intervalId: any;

      const stream = new ReadableStream({
        async start(controller) {
          sendFn = (chunk: Uint8Array) => {
            try { controller.enqueue(chunk); } catch {}
          };
          sseClients.add(sendFn);

          getFullState().then(initialState => {
            const initialPayload = `data: ${JSON.stringify({ type: "full_sync", data: initialState })}\n\n`;
            sendFn(new TextEncoder().encode(initialPayload));
          });

          intervalId = setInterval(async () => {
            try {
              const peersData = await getRealPeers();
              const payload = `data: ${JSON.stringify({ type: "metrics", data: peersData })}\n\n`;
              sendFn(new TextEncoder().encode(payload));
            } catch {}
          }, 1500);

          req.signal.addEventListener("abort", () => {
            if (intervalId) clearInterval(intervalId);
            sseClients.delete(sendFn);
          });
        },
        cancel() {
          if (intervalId) clearInterval(intervalId);
          if (sendFn) sseClients.delete(sendFn);
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path.startsWith("/logo/") || path.startsWith("/brand/")) {
      const prefix = path.startsWith("/logo/") ? "/logo/" : "/brand/";
      const filename = decodeURIComponent(path.slice(prefix.length));
      if (!/^[A-Za-z0-9_.\-]+$/.test(filename)) {
        return new Response("Not Found", { status: 404 });
      }
      let filepath = join(LOGO_DIR, filename);
      if (!existsSync(filepath)) {
        filepath = join(BRAND_DIR, filename);
      }
      if (!existsSync(filepath)) return new Response("Not Found", { status: 404 });
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon"
      };
      try {
        const file = Bun.file(filepath);
        return new Response(file, {
          headers: {
            "Content-Type": mimeMap[ext] ?? "application/octet-stream",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    // --- USP telemetry (handled locally, before the USP proxy catch-all) ---
    if (path === "/api/usp/telemetry/status" && req.method === "GET") {
      return Response.json(telemetryStatus(), { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (path === "/api/usp/telemetry/record" && req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      if (body.enabled) startTelemetry(Number(body.intervalSec) || undefined);
      else stopTelemetry();
      return Response.json(telemetryStatus(), { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (path === "/api/usp/telemetry" && req.method === "DELETE") {
      const deviceId = url.searchParams.get("device_id") || undefined;
      await db.clearUspTelemetry(deviceId);
      return Response.json({ ok: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (path === "/api/usp/telemetry" && req.method === "GET") {
      const deviceId = url.searchParams.get("device_id") || "";
      const to = Number(url.searchParams.get("to")) || Date.now();
      const from = Number(url.searchParams.get("from")) || to - 3600_000;
      const limit = Math.min(20000, Number(url.searchParams.get("limit")) || 5000);
      if (!deviceId) return Response.json({ error: "device_id required" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
      const series = await telemetrySamples(deviceId, from, to, limit);
      return Response.json(
        { device_id: deviceId, from, to, metrics: TELEMETRY_METRICS, series },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    if (path.startsWith("/api/usp/") || path === "/api/usp") {
      try {
        const targetUrl = new URL(path + url.search, USP_SERVICE_URL);
        const proxyHeaders: Record<string, string> = {
          "Content-Type": req.headers.get("content-type") || "application/json"
        };
        const fetchOpts: RequestInit = {
          method: req.method,
          headers: proxyHeaders
        };
        if (req.method !== "GET" && req.method !== "HEAD") {
          fetchOpts.body = await req.text();
        }
        const resp = await fetch(targetUrl.toString(), fetchOpts);
        const data = await resp.text();
        return new Response(data, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (err: any) {
        return Response.json({ error: `USP Service unavailable: ${err.message}` }, {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    if (path.startsWith("/api/")) {
      const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      };

      if (req.method === "GET") {
        if (path === "/api/config") return Response.json(await db.getConfig(), { headers: corsHeaders });
        if (path === "/api/services") return Response.json(await db.getServices(), { headers: corsHeaders });
        if (path === "/api/routes") return Response.json(await db.getRoutes(), { headers: corsHeaders });
        if (path === "/api/nginx") return Response.json(await db.getNginxRoutes(), { headers: corsHeaders });
        if (path === "/api/nginx/raw") {
          let raw = "";
          try { raw = readFileSync(NGINX_ROUTES_FILE, "utf-8"); } catch {}
          return Response.json({ raw }, { headers: corsHeaders });
        }
        if (path === "/api/topology") return Response.json([], { headers: corsHeaders });
        if (path === "/api/network") {
          const force = url.searchParams.get("refresh") === "1";
          return Response.json(getNetworkInfo(force), { headers: corsHeaders });
        }
        if (path === "/api/cluster") return Response.json([], { headers: corsHeaders });
        if (path === "/api/status" || path === "/api/peers") {
          const st = await getRealPeers();
          return Response.json(st, { headers: corsHeaders });
        }
        if (path === "/api/state") {
          const st = await getFullState();
          return Response.json(st, { headers: corsHeaders });
        }
        if (path === "/api/devices") {
          return Response.json(await db.listDevices(), { headers: corsHeaders });
        }
        if (path === "/api/users") {
          return Response.json(await db.listUsers(), { headers: corsHeaders });
        }

        // --- DATABASE ADMIN ENDPOINTS ---
        if (path === "/api/database/overview") {
          try {
            const overview = await db.getOverview();
            return Response.json(overview, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path.startsWith("/api/database/tables/")) {
          const tableName = path.replace("/api/database/tables/", "");
          const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100") || 100));
          const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0") || 0);
          try {
            const details = await db.getTableDetails(tableName, limit, offset);
            return Response.json(details, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path === "/api/database/export") {
          try {
            const sqlDump = await db.exportSqlDump();
            return new Response(sqlDump, {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="wafmgmt_backup_${new Date().toISOString().slice(0, 10)}.sql"`,
                "Access-Control-Allow-Origin": "*"
              }
            });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }
      }

      if (req.method === "POST" || req.method === "PUT") {
        const payload = await req.json().catch(() => ({}));

        if (path === "/api/auth/login") {
          const username = (payload.username || "").trim();
          const password = (payload.password || "").trim();
          const user = await db.getUserByUsername(username);

          if (!user) {
            return Response.json({ error: "Invalid username or password" }, { status: 401, headers: corsHeaders });
          }

          // If user hasn't finished initial onboarding, allow login with blank password or initial check
          if (user.onboarded === 0 && !user.password) {
            // First time login for uninitialized user (no password set yet)
            const { password: _, ...safe } = user;
            return Response.json({ success: true, needsOnboarding: true, user: safe }, { headers: corsHeaders });
          }

          if (user.password !== password) {
            return Response.json({ error: "Invalid username or password" }, { status: 401, headers: corsHeaders });
          }

          const { password: _, ...safe } = user;
          return Response.json({
            success: true,
            needsOnboarding: user.onboarded === 0,
            user: safe
          }, { headers: corsHeaders });
        }

        if (path === "/api/users") {
          try {
            if (!payload.username) {
              return Response.json({ error: "Username is required" }, { status: 400, headers: corsHeaders });
            }
            const existing = await db.getUserByUsername(payload.username);
            if (existing) {
              return Response.json({ error: "Username already exists" }, { status: 400, headers: corsHeaders });
            }
            const created = await db.createUser(payload);
            return Response.json(created, { status: 201, headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path.startsWith("/api/users/")) {
          try {
            const id = decodeURIComponent(path.replace("/api/users/", ""));
            const updated = await db.updateUser(id, payload);
            if (!updated) return Response.json({ error: "User not found" }, { status: 404, headers: corsHeaders });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path === "/api/peers" || path.startsWith("/api/peers/")) {
          const isPut = req.method === "PUT";
          const pubkey = isPut ? decodeURIComponent(path.replace("/api/peers/", "")) : payload.pubkey;
          const cfg = await db.getConfig();

          let clientPriv = "";
          let clientPub = pubkey || "";
          if (!clientPub) {
            try {
              const privProc = Bun.spawnSync(["wg", "genkey"]);
              clientPriv = privProc.stdout.toString().trim();
              const pubProc = Bun.spawnSync(["wg", "pubkey"], { stdin: new TextEncoder().encode(clientPriv) });
              clientPub = pubProc.stdout.toString().trim();
            } catch {
              clientPub = `pubkey-${Date.now()}`;
            }
          }

          let ip = payload.ip?.trim() || "";
          if (!ip) {
            const meta = await db.getPeersMeta();
            const usedIps = new Set(Object.values(meta).map(p => p.ip.split("/")[0]));
            let nextIpNum = 2;
            while (usedIps.has(`10.8.0.${nextIpNum}`)) nextIpNum++;
            ip = `10.8.0.${nextIpNum}/32`;
          }

          const dns = payload.dns?.trim() || cfg.dnsDefault || "10.8.0.1";
          const allowedIps = payload.allowedIps?.trim() || cfg.allowedIpsTemplate || "10.8.0.0/24";
          const srvPub = getServerPubkey() || "uKwCdGiNR8Mx3FetK72EOhpnJzgm2XzMtUjU2DRnCFs=";
          const endpoint = cfg.endpointWan || "vpn.example.com:51820";

          let conf = payload.conf || "";
          if (!conf && clientPriv) {
            conf = `[Interface]\nPrivateKey = ${clientPriv}\nAddress = ${ip}\nDNS = ${dns}\n\n[Peer]\nPublicKey = ${srvPub}\nEndpoint = ${endpoint}\nAllowedIPs = ${allowedIps}\nPersistentKeepalive = 15\n`;
          }

          const peerRecord: DBPeerMeta = {
            pubkey: clientPub,
            name: payload.name || `Client-${clientPub.substring(0, 6)}`,
            ip,
            dns,
            allowedIps,
            conf,
            createdAt: payload.createdAt || Math.floor(Date.now() / 1000)
          };

          await db.savePeerMeta(peerRecord);
          wgSet(["peer", clientPub, "allowed-ips", ip]);
          wgQuickSave();

          const st = await getRealPeers();
          broadcastSSE("peers", st.peers);
          return Response.json({ success: true, peer: peerRecord, peers: st.peers }, { headers: corsHeaders });
        }

        if (path === "/api/config") {
          await db.saveConfig(payload);
          const updated = await db.getConfig();
          broadcastSSE("config", updated);
          return Response.json({ success: true, config: updated }, { headers: corsHeaders });
        }

        if (path === "/api/config/logo") {
          try {
            const form = await req.formData();
            const file = form.get("logo");
            if (!(file instanceof File)) {
              return Response.json({ error: "No file provided" }, { status: 400, headers: corsHeaders });
            }
            const extMap: Record<string, string> = {
              "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
              "image/webp": "webp", "image/svg+xml": "svg", "image/x-icon": "ico"
            };
            const ext = extMap[file.type] ?? "png";
            const filename = `logo-${Date.now()}.${ext}`;
            const buf = Buffer.from(await file.arrayBuffer());
            if (buf.length > 2 * 1024 * 1024) {
              return Response.json({ error: "Logo exceeds 2 MB limit" }, { status: 413, headers: corsHeaders });
            }
            mkdirSync(LOGO_DIR, { recursive: true });
            writeFileSync(join(LOGO_DIR, filename), buf);
            const previous = (await db.getConfig()).logoUrl;
            if (previous) {
              const prevName = previous.replace(/^\/(logo|brand)\//, "");
              if (prevName !== filename) {
                try { unlinkSync(join(LOGO_DIR, prevName)); } catch {}
                try { unlinkSync(join(BRAND_DIR, prevName)); } catch {}
              }
            }
            await db.saveConfig({ logoUrl: `/logo/${filename}` });
            const updated = await db.getConfig();
            broadcastSSE("config", updated);
            return Response.json({ success: true, config: updated }, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message ?? "Upload failed" }, { status: 500, headers: corsHeaders });
          }
        }

        if (path === "/api/services") {
          const newItem: DBService = {
            id: payload.id || `srv-${Date.now()}`,
            name: payload.name || "App",
            url: payload.url || "#",
            icon: payload.icon || "",
            category: payload.category || "General",
            desc: payload.desc || "",
            status: "online",
            ssh_port: payload.ssh_port ?? null,
            terminal: payload.terminal === true
          };
          await db.saveService(newItem);
          const services = await db.getServices();
          broadcastSSE("services", services);
          return Response.json({ success: true, services }, { headers: corsHeaders });
        }

        if (path === "/api/routes") {
          const newRoute: DBRoute = {
            id: payload.id || `route-${Date.now()}`,
            name: payload.name || "Subnet",
            subnet: payload.subnet || "",
            desc: payload.desc || "",
            isDefault: payload.isDefault !== false
          };
          await db.saveRoute(newRoute);
          const routes = await db.getRoutes();
          broadcastSSE("routes", routes);
          return Response.json({ success: true, routes }, { headers: corsHeaders });
        }

        if (path === "/api/nginx") {
          const newRoute: DBNginxRoute = {
            id: payload.id || `nginx-${Date.now()}`,
            domain: payload.domain?.trim() || "",
            upstream: payload.upstream?.trim() || "",
            tlsInternal: payload.tlsInternal === true,
            skipTlsVerify: payload.skipTlsVerify !== false,
            desc: payload.desc?.trim() || "",
            enabled: payload.enabled !== false
          };
          await db.saveNginxRoute(newRoute);
          const routes = await db.getNginxRoutes();
          generateAndReloadNginx(routes);
          broadcastSSE("nginx", routes);
          return Response.json({ success: true, routes }, { headers: corsHeaders });
        }

        if (path === "/api/nginx/raw") {
          const raw = typeof payload.raw === "string" ? payload.raw : "";
          try {
            mkdirSync(NGINX_CONF_DIR, { recursive: true });
            writeFileSync(NGINX_ROUTES_FILE, raw, "utf-8");
          } catch (e: any) {
            return Response.json({ error: e?.message || "Failed to write config" }, { status: 500, headers: corsHeaders });
          }
          reloadNginx();
          const routes = await db.getNginxRoutes();
          broadcastSSE("nginx", routes);
          return Response.json({ success: true }, { headers: corsHeaders });
        }

        if (path === "/api/devices") {
          try {
            const created = await db.createDevice(payload);
            broadcastSSE("devices", await db.listDevices());
            return Response.json(created, { status: 201, headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path.startsWith("/api/devices/")) {
          try {
            const id = decodeURIComponent(path.replace("/api/devices/", ""));
            const updated = await db.updateDevice(id, payload);
            if (!updated) return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
            broadcastSSE("devices", await db.listDevices());
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
          }
        }

        if (path === "/api/database/query") {
          const queryText = payload.query?.trim() || "";
          if (!queryText) {
            return Response.json({ success: false, error: "Empty query" }, { status: 400, headers: corsHeaders });
          }
          const res = await db.executeQuery(queryText);
          return Response.json(res, { headers: corsHeaders });
        }

        if (path === "/api/database/import") {
          const sqlScript = payload.sql?.trim() || "";
          if (!sqlScript) {
            return Response.json({ success: false, error: "Empty SQL script" }, { status: 400, headers: corsHeaders });
          }
          const res = await db.executeQuery(sqlScript);
          return Response.json(res, { headers: corsHeaders });
        }
      }

      if (req.method === "DELETE") {
        if (path === "/api/config/logo") {
          const current = (await db.getConfig()).logoUrl;
          if (current) {
            const name = current.replace(/^\/(logo|brand)\//, "");
            try { unlinkSync(join(LOGO_DIR, name)); } catch {}
            try { unlinkSync(join(BRAND_DIR, name)); } catch {}
          }
          await db.saveConfig({ logoUrl: "" });
          const updated = await db.getConfig();
          broadcastSSE("config", updated);
          return Response.json({ success: true, config: updated }, { headers: corsHeaders });
        }
        if (path.startsWith("/api/peers/")) {
          const pubkey = decodeURIComponent(path.replace("/api/peers/", ""));
          await db.deletePeerMeta(pubkey);
          wgSet(["peer", pubkey, "remove"]);
          wgQuickSave();
          const st = await getRealPeers();
          broadcastSSE("peers", st.peers);
          return Response.json({ success: true, peers: st.peers }, { headers: corsHeaders });
        }

        if (path.startsWith("/api/services/")) {
          const id = path.replace("/api/services/", "");
          await db.deleteService(id);
          const services = await db.getServices();
          broadcastSSE("services", services);
          return Response.json({ success: true, services }, { headers: corsHeaders });
        }
        if (path.startsWith("/api/routes/")) {
          const id = path.replace("/api/routes/", "");
          await db.deleteRoute(id);
          const routes = await db.getRoutes();
          broadcastSSE("routes", routes);
          return Response.json({ success: true, routes }, { headers: corsHeaders });
        }
        if (path.startsWith("/api/nginx/")) {
          const id = path.replace("/api/nginx/", "");
          await db.deleteNginxRoute(id);
          const routes = await db.getNginxRoutes();
          generateAndReloadNginx(routes);
          broadcastSSE("nginx", routes);
          return Response.json({ success: true, routes }, { headers: corsHeaders });
        }
        if (path.startsWith("/api/devices/")) {
          const id = path.replace("/api/devices/", "");
          const ok = await db.deleteDevice(id);
          broadcastSSE("devices", await db.listDevices());
          return Response.json({ success: ok }, { headers: corsHeaders });
        }
        if (path.startsWith("/api/users/")) {
          const id = path.replace("/api/users/", "");
          const ok = await db.deleteUser(id);
          return Response.json({ success: ok }, { headers: corsHeaders });
        }
      }
    }

    return new Response("Not Found", { status: 404 });
}

export const coreWebSocket = {
    open(ws: any) {
      const { ip, port } = ws.data || {};
      if (!ip) {
        ws.send(JSON.stringify({ type: "error", message: "Missing destination IP" }));
        ws.close();
        return;
      }

      const cleanPort = parseInt(port) || 22;

      // Spawn ssh subprocess with PTY-like standard I/O
      // We pass -tt to force pseudo-terminal allocation and common options
      const sshArgs = [
        "-tt",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "ConnectTimeout=10",
        "-p", String(cleanPort),
        ip
      ];

      try {
        const proc = spawn("ssh", sshArgs, {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            TERM: "xterm-256color"
          }
        });

        sshSessions.set(ws, proc);

        proc.stdout?.on("data", (chunk: Buffer) => {
          try {
            ws.send(JSON.stringify({ type: "data", data: chunk.toString("utf-8") }));
          } catch {}
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
          try {
            ws.send(JSON.stringify({ type: "data", data: chunk.toString("utf-8") }));
          } catch {}
        });

        proc.on("error", (err: Error) => {
          try {
            ws.send(JSON.stringify({ type: "error", message: `SSH spawn error: ${err.message}` }));
          } catch {}
        });

        proc.on("close", (code: number | null) => {
          try {
            ws.send(JSON.stringify({ type: "status", message: `SSH process exited with code ${code ?? 0}` }));
            ws.close();
          } catch {}
          sshSessions.delete(ws);
        });
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", message: `Failed to initiate SSH: ${err.message}` }));
        ws.close();
      }
    },

    message(ws: any, message: string | Buffer) {
      const proc = sshSessions.get(ws);
      if (!proc || !proc.stdin || proc.stdin.destroyed) return;

      try {
        const raw = typeof message === "string" ? message : message.toString("utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.type === "input" && typeof parsed.data === "string") {
          proc.stdin.write(parsed.data);
        }
      } catch {
        // Raw string fallback
        if (typeof message === "string") {
          proc.stdin.write(message);
        }
      }
    },

    close(ws: any) {
      const proc = sshSessions.get(ws);
      if (proc) {
        try {
          proc.kill();
        } catch {}
        sshSessions.delete(ws);
      }
    }
  };
