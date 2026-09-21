import { Database } from "bun:sqlite";
import { join } from "path";

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "../../data");
const DB_NAME = process.env.DB_FILE || "wafmgmt.mock.db";
const MOCK_DB_PATH = join(DATA_DIR, DB_NAME);

console.log("Seeding database at:", MOCK_DB_PATH);
const db = new Database(MOCK_DB_PATH);
db.run("PRAGMA journal_mode = WAL;");

// 1. Create identical schema
db.run(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT DEFAULT '',
    category TEXT DEFAULT 'General',
    desc TEXT DEFAULT '',
    status TEXT DEFAULT 'online'
  );
  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subnet TEXT NOT NULL,
    desc TEXT DEFAULT '',
    is_default INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS nginx_routes (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    upstream TEXT NOT NULL,
    tls_internal INTEGER DEFAULT 0,
    skip_tls_verify INTEGER DEFAULT 1,
    desc TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS peers_meta (
    pubkey TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    dns TEXT DEFAULT '',
    allowed_ips TEXT DEFAULT '',
    conf TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT,
    port INTEGER,
    path TEXT,
    ssh_port INTEGER,
    icon TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Auto-migrate column if devices already existed previously
try {
  const cols = db.query("PRAGMA table_info(devices)").all() as any[];
  if (!cols.some((c) => c.name === "ssh_port")) {
    db.run("ALTER TABLE devices ADD COLUMN ssh_port INTEGER");
  }
} catch {}

// 2. Clean table contents for deterministic seed
db.run("DELETE FROM devices;");
db.run("DELETE FROM config;");
db.run("DELETE FROM nginx_routes;");
db.run("DELETE FROM routes;");
db.run("DELETE FROM peers_meta;");

// 3. Seed Config
const initialConfig = {
  brandName: "Oasis WAF (Mock)",
  brandSubtitle: "Edge Gateway & Zero-Trust Mesh",
  logoUrl: "",
  endpointWan: "vpn.mock.oasislab.id:51820",
  dnsDefault: "10.8.0.1",
  interface: "wg0",
  address: "10.8.0.1/24"
};
for (const [k, v] of Object.entries(initialConfig)) {
  db.run("INSERT INTO config (key, value) VALUES (?, ?)", [k, JSON.stringify(v)]);
}

// 4. Seed Devices
const mockDevices = [
  {
    id: "mock-dev-1",
    name: "Proxmox VE Cluster",
    ip: "192.168.1.10",
    port: 8006,
    path: "/",
    ssh_port: 22,
    icon: "https://api.iconify.design/simple-icons:proxmox.svg?color=%23e57000",
    notes: "Main hypervisor master node",
    created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "mock-dev-2",
    name: "AdGuard Home DNS",
    ip: "192.168.1.100",
    port: 3000,
    path: "/",
    ssh_port: 22,
    icon: "https://api.iconify.design/simple-icons:adguard.svg?color=%2368bc71",
    notes: "Internal recursive resolver & sinkhole",
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "mock-dev-3",
    name: "PostgreSQL DB Primary",
    ip: "192.168.1.25",
    port: 5432,
    path: null,
    ssh_port: 2222,
    icon: "https://api.iconify.design/simple-icons:postgresql.svg?color=%234169e1",
    notes: "Core backend cluster storage",
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "mock-dev-4",
    name: "Nginx Ingress Proxy",
    ip: "192.168.1.1",
    port: 443,
    path: "/",
    ssh_port: 22,
    icon: "https://api.iconify.design/simple-icons:nginx.svg?color=%23009639",
    notes: "Edge SSL termination router",
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "mock-dev-5",
    name: "MikroTik Core BGP",
    ip: "192.168.1.254",
    port: 80,
    path: "/webfig",
    ssh_port: 22,
    icon: "https://api.iconify.design/simple-icons:mikrotik.svg?color=%23000000",
    notes: "Border gateway & fiber uplink",
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString()
  }
];

const insertDev = db.prepare(
  "INSERT INTO devices (id, name, ip, port, path, ssh_port, icon, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
for (const dev of mockDevices) {
  insertDev.run(
    dev.id,
    dev.name,
    dev.ip,
    dev.port,
    dev.path,
    dev.ssh_port,
    dev.icon,
    dev.notes,
    dev.created_at,
    dev.updated_at
  );
}

// 5. Seed Nginx Routes
const mockNginx = [
  { id: "cr-1", domain: "proxmox.mock.lan", upstream: "192.168.1.10:8006", tls_internal: 0, skip_tls_verify: 1, desc: "Proxmox VE", enabled: 1 },
  { id: "cr-2", domain: "dns.mock.lan", upstream: "192.168.1.100:3000", tls_internal: 0, skip_tls_verify: 0, desc: "AdGuard Web", enabled: 1 }
];
const insertNginx = db.prepare("INSERT INTO nginx_routes (id, domain, upstream, tls_internal, skip_tls_verify, desc, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const c of mockNginx) {
  insertNginx.run(c.id, c.domain, c.upstream, c.tls_internal, c.skip_tls_verify, c.desc, c.enabled);
}

// 6. Seed Subnet Routes
db.run("INSERT INTO routes (id, name, subnet, desc, is_default) VALUES (?, ?, ?, ?, ?)", ["r-1", "Internal LAN", "192.168.1.0/24", "Core Subnet", 1]);

// 7. Seed WireGuard Peers
const mockPeers = [
  {
    pubkey: "mockpubkeyadminlaptop1234567890abcdef=",
    name: "MacBook Pro - Admin",
    ip: "10.8.0.2",
    dns: "10.8.0.1",
    allowed_ips: "10.8.0.0/24, 192.168.1.0/24",
    conf: "[Interface]\nPrivateKey = ...\nAddress = 10.8.0.2/24\nDNS = 10.8.0.1\n\n[Peer]\nPublicKey = serverpubkey=\nEndpoint = vpn.mock.oasislab.id:51820\nAllowedIPs = 0.0.0.0/0",
    created_at: Math.floor((Date.now() - 86400000 * 5) / 1000)
  },
  {
    pubkey: "mockpubkeyiphonedevteam9876543210fedcba=",
    name: "iPhone 15 - Field Engineer",
    ip: "10.8.0.3",
    dns: "10.8.0.1",
    allowed_ips: "10.8.0.0/24",
    conf: "[Interface]\nPrivateKey = ...\nAddress = 10.8.0.3/24\nDNS = 10.8.0.1\n\n[Peer]\nPublicKey = serverpubkey=\nEndpoint = vpn.mock.oasislab.id:51820\nAllowedIPs = 10.8.0.0/24",
    created_at: Math.floor((Date.now() - 86400000 * 3) / 1000)
  },
  {
    pubkey: "mockpubkeyhomelabgateway55554443332211aa=",
    name: "Remote Lab Router (BGP)",
    ip: "10.8.0.4",
    dns: "10.8.0.1",
    allowed_ips: "10.8.0.0/24, 192.168.20.0/24",
    conf: "[Interface]\nPrivateKey = ...\nAddress = 10.8.0.4/24\nDNS = 10.8.0.1\n\n[Peer]\nPublicKey = serverpubkey=\nEndpoint = vpn.mock.oasislab.id:51820\nAllowedIPs = 10.8.0.0/24",
    created_at: Math.floor((Date.now() - 86400000 * 1) / 1000)
  }
];

const insertPeer = db.prepare("INSERT INTO peers_meta (pubkey, name, ip, dns, allowed_ips, conf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const p of mockPeers) {
  insertPeer.run(p.pubkey, p.name, p.ip, p.dns, p.allowed_ips, p.conf, p.created_at);
}

console.log("Seed completed successfully. Devices inserted:", mockDevices.length, "Peers inserted:", mockPeers.length);
db.close();

