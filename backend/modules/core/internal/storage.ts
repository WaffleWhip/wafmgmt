import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const CORE_DIR = join(DATA_DIR, "core");
const DB_FILE = process.env.DB_FILE || "wafmgmt.db";
const DB_PATH = join(CORE_DIR, DB_FILE);
const LEGACY_DB_PATH = join(DATA_DIR, DB_FILE);
const LOGO_DIR = join(CORE_DIR, "logo");

export interface DBConfig {
  brandName?: string;
  brandSubtitle?: string;
  logoUrl?: string;
  title?: string;
  subtitle?: string;
  primaryColor?: string;
  accentColor?: string;
  adminUser?: string;
  adminPass?: string;
  endpointWan?: string;
  interface?: string;
  address?: string;
  listenPort?: number;
  dnsDefault?: string;
  allowedIpsTemplate?: string;
  keepaliveDefault?: number;
  [key: string]: any;
}

export interface DBService {
  id: string;
  name: string;
  url: string;
  icon: string;
  category: string;
  desc: string;
  status: string;
  ssh_port?: number | null;
  terminal?: boolean;
}

export interface DBRoute {
  id: string;
  name: string;
  subnet: string;
  desc: string;
  isDefault: boolean;
}

export interface DBNginxRoute {
  id: string;
  domain: string;
  upstream: string;
  tlsInternal: boolean;
  skipTlsVerify: boolean;
  desc: string;
  enabled: boolean;
}

export interface DBPeerMeta {
  pubkey: string;
  name: string;
  ip: string;
  dns: string;
  allowedIps: string;
  conf: string;
  createdAt: number;
}

export interface Device {
  id: string;
  name: string;
  ip: string | null;
  port: number | null;
  path: string | null;
  ssh_port: number | null;
  terminal: boolean;
  icon: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBUser {
  id: string;
  username: string;
  password: string;
  name: string;
  role: "admin" | "user";
  avatar?: string | null;
  permissions?: string | null; // JSON array of allowed paths, e.g. ["/wireguard", "/nginx"]
  onboarded?: number; // 0 = first-login setup required, 1 = completed
  created_at: string;
  updated_at: string;
}

export function detectLogoUrl(): string {
  try {
    if (!existsSync(LOGO_DIR)) return "";
    const files = readdirSync(LOGO_DIR);
    const imageExtensions = [".svg", ".png", ".webp", ".jpg", ".jpeg", ".ico", ".gif"];
    for (const ext of imageExtensions) {
      const match = files.find(f => f.toLowerCase().endsWith(ext));
      if (match) return "/logo/" + match;
    }
    return "";
  } catch {
    return "";
  }
}

export class WafSqliteDatabase {
  private db: Database | null = null;

  private getDb(): Database {
    if (!this.db) {
      mkdirSync(DATA_DIR, { recursive: true });
      mkdirSync(CORE_DIR, { recursive: true });
      for (const ext of ["", "-wal", "-shm"]) {
        const legacy = `${LEGACY_DB_PATH}${ext}`;
        if (!existsSync(`${DB_PATH}${ext}`) && existsSync(legacy)) {
          try { renameSync(legacy, `${DB_PATH}${ext}`); } catch {}
        }
      }
      mkdirSync(LOGO_DIR, { recursive: true });
      mkdirSync(join(DATA_DIR, "wireguard"), { recursive: true });
      mkdirSync(join(DATA_DIR, "nginx"), { recursive: true });
      mkdirSync(join(DATA_DIR, "adguard", "conf"), { recursive: true });
      mkdirSync(join(DATA_DIR, "adguard", "work"), { recursive: true });

      this.db = new Database(DB_PATH);
      this.db.run("PRAGMA journal_mode = WAL;");
      this.initSchema();
    }
    return this.db;
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.run(`
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
        status TEXT DEFAULT 'online',
        ssh_port INTEGER,
        terminal INTEGER DEFAULT 0
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
        terminal INTEGER DEFAULT 0,
        icon TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usp_exec_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        operator TEXT NOT NULL,
        op TEXT NOT NULL,
        device TEXT NOT NULL,
        target TEXT NOT NULL,
        params TEXT,
        result TEXT NOT NULL,
        detail TEXT,
        duration_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usp_raw_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        direction TEXT NOT NULL,
        agent TEXT NOT NULL,
        topic TEXT NOT NULL,
        msg_id TEXT NOT NULL,
        msg TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usp_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL
      );
      CREATE INDEX IF NOT EXISTS idx_usp_telemetry_lookup
        ON usp_telemetry(device_id, metric, ts);
    `);

    // Auto-migration: caddy_routes -> nginx_routes
    try {
      const legacy = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='caddy_routes'").get() as any;
      if (legacy) {
        this.db.run("INSERT OR IGNORE INTO nginx_routes SELECT * FROM caddy_routes");
        this.db.run("DROP TABLE caddy_routes");
      }
    } catch {}

    // Auto-migration: add path, ssh_port, terminal if missing
    try {
      const cols = this.db.query("PRAGMA table_info(devices)").all() as any[];
      if (!cols.some((c) => c.name === "path")) {
        this.db.run("ALTER TABLE devices ADD COLUMN path TEXT");
      }
      if (!cols.some((c) => c.name === "ssh_port")) {
        this.db.run("ALTER TABLE devices ADD COLUMN ssh_port INTEGER");
      }
      if (!cols.some((c) => c.name === "terminal")) {
        this.db.run("ALTER TABLE devices ADD COLUMN terminal INTEGER DEFAULT 0");
      }
    } catch {}

    // Auto-migration: add ssh_port, terminal to services
    try {
      const sCols = this.db.query("PRAGMA table_info(services)").all() as any[];
      if (!sCols.some((c) => c.name === "ssh_port")) {
        this.db.run("ALTER TABLE services ADD COLUMN ssh_port INTEGER");
      }
      if (!sCols.some((c) => c.name === "terminal")) {
        this.db.run("ALTER TABLE services ADD COLUMN terminal INTEGER DEFAULT 0");
      }
    } catch {}

    // Auto-migration: add avatar, permissions, onboarded to users
    try {
      const uCols = this.db.query("PRAGMA table_info(users)").all() as any[];
      if (!uCols.some((c) => c.name === "avatar")) {
        this.db.run("ALTER TABLE users ADD COLUMN avatar TEXT");
      }
      if (!uCols.some((c) => c.name === "permissions")) {
        this.db.run("ALTER TABLE users ADD COLUMN permissions TEXT");
      }
      if (!uCols.some((c) => c.name === "onboarded")) {
        this.db.run("ALTER TABLE users ADD COLUMN onboarded INTEGER DEFAULT 1");
      }
    } catch {}

    // Seed default users if empty
    try {
      const userCount = this.db.query("SELECT count(*) as cnt FROM users").get() as any;
      if (!userCount || userCount.cnt === 0) {
        const now = new Date().toISOString();
        const insertUser = this.db.prepare("INSERT INTO users (id, username, password, name, role, permissions, onboarded, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        insertUser.run("user-admin", "admin", "", "Administrator", "admin", JSON.stringify(["/dashboard", "/wireguard", "/nginx", "/users", "/settings"]), 0, now, now);
        insertUser.run("user-operator", "operator", "", "Standard Operator", "user", JSON.stringify(["/dashboard"]), 0, now, now);
      }
    } catch {}

    const countRes = this.db.query("SELECT count(*) as cnt FROM config").get() as any;
    if (!countRes || countRes.cnt === 0) {
      this.seedData();
    }
  }

  private seedData(): void {
    if (!this.db) return;

    // Seed Config from existing JSON or default
    const configPath = join(CORE_DIR, "config.json");
    let cfg: any = {
      brandName: "BAN",
      brandSubtitle: "Lab Oasis",
      logoUrl: detectLogoUrl(),
      title: "WAFMGMT Gateway",
      subtitle: "Network & Services",
      primaryColor: "#000000",
      accentColor: "#1e3a8a",
      adminUser: "admin",
      adminPass: "",
      endpointWan: process.env.DEFAULT_WAN_ENDPOINT || "",
      interface: process.env.WG_INTERFACE || "wg0",
      address: process.env.DEFAULT_WG_ADDRESS || "10.8.0.1/24",
      listenPort: parseInt(process.env.DEFAULT_WG_PORT || "51820"),
      dnsDefault: process.env.DEFAULT_DNS || "10.8.0.1",
      allowedIpsTemplate: process.env.DEFAULT_ALLOWED_IPS || "10.8.0.0/24",
      keepaliveDefault: 15
    };
    if (existsSync(configPath)) {
      try { cfg = { ...cfg, ...JSON.parse(readFileSync(configPath, "utf-8")) }; } catch {}
    }
    const insertCfg = this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(cfg)) {
      insertCfg.run(k, JSON.stringify(v));
    }

    // Seed Services
    const srvPath = join(CORE_DIR, "services.json");
    let srvList: DBService[] = [];
    if (existsSync(srvPath)) {
      try { srvList = JSON.parse(readFileSync(srvPath, "utf-8")); } catch {}
    }
    const insertSrv = this.db.prepare("INSERT OR REPLACE INTO services (id, name, url, icon, category, desc, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const s of srvList) {
      insertSrv.run(s.id, s.name, s.url, s.icon || "", s.category || "General", s.desc || "", s.status || "online");
    }

    // Seed Routes
    const routesPath = join(CORE_DIR, "routes.json");
    let routeList: DBRoute[] = [];
    if (existsSync(routesPath)) {
      try { routeList = JSON.parse(readFileSync(routesPath, "utf-8")); } catch {}
    }
    const insertRoute = this.db.prepare("INSERT OR REPLACE INTO routes (id, name, subnet, desc, is_default) VALUES (?, ?, ?, ?, ?)");
    for (const r of routeList) {
      insertRoute.run(r.id, r.name, r.subnet, r.desc || "", r.isDefault !== false ? 1 : 0);
    }

    // Seed Nginx Routes
    const nginxRoutesPath = join(DATA_DIR, "nginx", "routes.json");
    let nginxList: DBNginxRoute[] = [];
    if (existsSync(nginxRoutesPath)) {
      try { nginxList = JSON.parse(readFileSync(nginxRoutesPath, "utf-8")); } catch {}
    }
    const insertNginx = this.db.prepare("INSERT OR REPLACE INTO nginx_routes (id, domain, upstream, tls_internal, skip_tls_verify, desc, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const c of nginxList) {
      insertNginx.run(c.id, c.domain, c.upstream, c.tlsInternal ? 1 : 0, c.skipTlsVerify !== false ? 1 : 0, c.desc || "", c.enabled !== false ? 1 : 0);
    }

    // Seed Devices
    const devPath = join(CORE_DIR, "devices.json");
    let devList: Device[] = [];
    if (existsSync(devPath)) {
      try { devList = JSON.parse(readFileSync(devPath, "utf-8")); } catch {}
    }
    const insertDev = this.db.prepare("INSERT OR REPLACE INTO devices (id, name, ip, port, path, icon, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const d of devList) {
      insertDev.run(d.id, d.name, d.ip, d.port, (d as any).path ?? null, d.icon, d.notes, d.created_at, d.updated_at);
    }

    // Seed Peers Meta
    const peersPath = join(DATA_DIR, "wireguard", "peers_meta.json");
    let peersMap: Record<string, DBPeerMeta> = {};
    if (existsSync(peersPath)) {
      try { peersMap = JSON.parse(readFileSync(peersPath, "utf-8")); } catch {}
    }
    const insertPeer = this.db.prepare("INSERT OR REPLACE INTO peers_meta (pubkey, name, ip, dns, allowed_ips, conf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const p of Object.values(peersMap)) {
      insertPeer.run(p.pubkey, p.name, p.ip, p.dns || "", p.allowedIps || "", p.conf || "", p.createdAt || Math.floor(Date.now() / 1000));
    }
  }

  async init(): Promise<void> {
    this.getDb();
  }

  // --- CONFIG ---
  async getConfig(): Promise<DBConfig> {
    const db = this.getDb();
    const rows = db.query("SELECT key, value FROM config").all() as any[];
    const result: Record<string, any> = {};
    for (const r of rows) {
      try { result[r.key] = JSON.parse(r.value); } catch { result[r.key] = r.value; }
    }
    if (!result.logoUrl || typeof result.logoUrl !== "string" || result.logoUrl === "/logo.png") {
      const autoLogo = detectLogoUrl();
      if (autoLogo) result.logoUrl = autoLogo;
    }
    return result as DBConfig;
  }

  async saveConfig(cfg: Partial<DBConfig>): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(cfg)) {
      stmt.run(k, JSON.stringify(v));
    }
  }

  // --- SERVICES ---
  async getServices(): Promise<DBService[]> {
    const db = this.getDb();
    const rows = db.query("SELECT id, name, url, icon, category, desc, status, ssh_port, terminal FROM services ORDER BY name ASC").all() as any[];
    return rows.map((r) => ({ ...r, terminal: r.terminal === 1 }));
  }

  async saveService(srv: DBService): Promise<void> {
    const db = this.getDb();
    db.prepare("INSERT OR REPLACE INTO services (id, name, url, icon, category, desc, status, ssh_port, terminal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(srv.id, srv.name, srv.url, srv.icon || "", srv.category || "General", srv.desc || "", srv.status || "online", srv.ssh_port ?? null, srv.terminal ? 1 : 0);
  }

  async deleteService(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM services WHERE id = ?").run(id);
  }

  // --- ROUTES ---
  async getRoutes(): Promise<DBRoute[]> {
    const db = this.getDb();
    const rows = db.query("SELECT id, name, subnet, desc, is_default FROM routes ORDER BY name ASC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      subnet: r.subnet,
      desc: r.desc || "",
      isDefault: r.is_default === 1
    }));
  }

  async saveRoute(r: DBRoute): Promise<void> {
    const db = this.getDb();
    db.prepare("INSERT OR REPLACE INTO routes (id, name, subnet, desc, is_default) VALUES (?, ?, ?, ?, ?)").run(r.id, r.name, r.subnet, r.desc || "", r.isDefault !== false ? 1 : 0);
  }

  async deleteRoute(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM routes WHERE id = ?").run(id);
  }

  // --- NGINX ROUTES ---
  async getNginxRoutes(): Promise<DBNginxRoute[]> {
    const db = this.getDb();
    const rows = db.query("SELECT id, domain, upstream, tls_internal, skip_tls_verify, desc, enabled FROM nginx_routes ORDER BY domain ASC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      domain: r.domain,
      upstream: r.upstream,
      tlsInternal: r.tls_internal === 1,
      skipTlsVerify: r.skip_tls_verify === 1,
      desc: r.desc || "",
      enabled: r.enabled === 1
    }));
  }

  async saveNginxRoute(r: DBNginxRoute): Promise<void> {
    const db = this.getDb();
    db.prepare("INSERT OR REPLACE INTO nginx_routes (id, domain, upstream, tls_internal, skip_tls_verify, desc, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.id, r.domain, r.upstream, r.tlsInternal ? 1 : 0, r.skipTlsVerify !== false ? 1 : 0, r.desc || "", r.enabled !== false ? 1 : 0);
  }

  async deleteNginxRoute(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM nginx_routes WHERE id = ?").run(id);
  }

  // --- PEERS META ---
  async getPeersMeta(): Promise<Record<string, DBPeerMeta>> {
    const db = this.getDb();
    const rows = db.query("SELECT pubkey, name, ip, dns, allowed_ips, conf, created_at FROM peers_meta").all() as any[];
    const result: Record<string, DBPeerMeta> = {};
    for (const r of rows) {
      result[r.pubkey] = {
        pubkey: r.pubkey,
        name: r.name,
        ip: r.ip,
        dns: r.dns || "",
        allowedIps: r.allowed_ips || "",
        conf: r.conf || "",
        createdAt: r.created_at
      };
    }
    return result;
  }

  async savePeerMeta(p: DBPeerMeta): Promise<void> {
    const db = this.getDb();
    db.prepare("INSERT OR REPLACE INTO peers_meta (pubkey, name, ip, dns, allowed_ips, conf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(p.pubkey, p.name, p.ip, p.dns || "", p.allowedIps || "", p.conf || "", p.createdAt || Math.floor(Date.now() / 1000));
  }

  async deletePeerMeta(pubkey: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM peers_meta WHERE pubkey = ?").run(pubkey);
  }

  // --- DEVICES ---
  async listDevices(): Promise<Device[]> {
    const db = this.getDb();
    const rows = db.query("SELECT id, name, ip, port, path, ssh_port, terminal, icon, notes, created_at, updated_at FROM devices ORDER BY created_at DESC").all() as any[];
    return rows.map((r) => ({ ...r, terminal: r.terminal === 1 }));
  }

  async getDevice(id: string): Promise<Device | null> {
    const db = this.getDb();
    const row = db.query("SELECT * FROM devices WHERE id = ?").get(id) as any;
    return row ? { ...row, terminal: row.terminal === 1 } : null;
  }

  private normalizePath(v: unknown): string | null {
    if (typeof v !== "string") return v == null ? null : null;
    let t = v.trim();
    if (!t) return null;
    if (!t.startsWith("/")) t = "/" + t;
    return t;
  }

  async createDevice(input: Omit<Device, "id" | "created_at" | "updated_at">): Promise<Device> {
    const db = this.getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO devices (id, name, ip, port, path, ssh_port, terminal, icon, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      input.name,
      input.ip ?? null,
      input.port ?? null,
      this.normalizePath((input as any).path),
      input.ssh_port ?? null,
      (input as any).terminal ? 1 : 0,
      input.icon ?? null,
      input.notes ?? null,
      now,
      now
    );
    return (await this.getDevice(id))!;
  }

  async updateDevice(id: string, patch: Partial<Omit<Device, "id" | "created_at" | "updated_at">>): Promise<Device | null> {
    const db = this.getDb();
    const current = await this.getDevice(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const updated = {
      name: patch.name !== undefined ? patch.name : current.name,
      ip: patch.ip !== undefined ? patch.ip : current.ip,
      port: patch.port !== undefined ? patch.port : current.port,
      path: patch.path !== undefined ? this.normalizePath(patch.path) : (current as any).path ?? null,
      ssh_port: patch.ssh_port !== undefined ? patch.ssh_port : current.ssh_port,
      terminal: (patch as any).terminal !== undefined ? (patch as any).terminal : (current as any).terminal,
      icon: patch.icon !== undefined ? patch.icon : current.icon,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
      updated_at: now
    };
    db.prepare("UPDATE devices SET name = ?, ip = ?, port = ?, path = ?, ssh_port = ?, terminal = ?, icon = ?, notes = ?, updated_at = ? WHERE id = ?").run(
      updated.name,
      updated.ip,
      updated.port,
      updated.path,
      updated.ssh_port,
      updated.terminal ? 1 : 0,
      updated.icon,
      updated.notes,
      updated.updated_at,
      id
    );
    return (await this.getDevice(id))!;
  }

  async deleteDevice(id: string): Promise<boolean> {
    const db = this.getDb();
    const info = db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    return info.changes > 0;
  }

  // --- USERS CRUD ---
  async listUsers(): Promise<Omit<DBUser, "password">[]> {
    const db = this.getDb();
    return db.query("SELECT id, username, name, role, avatar, permissions, onboarded, created_at, updated_at FROM users ORDER BY created_at ASC").all() as any[];
  }

  async getUser(id: string): Promise<DBUser | null> {
    const db = this.getDb();
    return db.query("SELECT * FROM users WHERE id = ?").get(id) as DBUser | null;
  }

  async getUserByUsername(username: string): Promise<DBUser | null> {
    const db = this.getDb();
    return db.query("SELECT * FROM users WHERE username = ?").get(username) as DBUser | null;
  }

  async createUser(input: {
    username: string;
    password?: string;
    name?: string;
    role?: "admin" | "user";
    avatar?: string | null;
    permissions?: string[] | string | null;
    onboarded?: number;
  }): Promise<Omit<DBUser, "password">> {
    const db = this.getDb();
    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const role = input.role === "admin" ? "admin" : "user";
    const password = input.password?.trim() || "";
    const name = input.name?.trim() || input.username.trim();
    const avatar = input.avatar || null;
    const permissions = Array.isArray(input.permissions)
      ? JSON.stringify(input.permissions)
      : (typeof input.permissions === "string" ? input.permissions : null);
    const onboarded = input.onboarded !== undefined ? input.onboarded : (password ? 1 : 0);

    db.prepare("INSERT INTO users (id, username, password, name, role, avatar, permissions, onboarded, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      input.username.trim(),
      password,
      name,
      role,
      avatar,
      permissions,
      onboarded,
      now,
      now
    );
    const created = await this.getUser(id);
    const { password: _, ...safe } = created!;
    return safe;
  }

  async updateUser(id: string, patch: {
    username?: string;
    password?: string;
    name?: string;
    role?: "admin" | "user";
    avatar?: string | null;
    permissions?: string[] | string | null;
    onboarded?: number;
  }): Promise<Omit<DBUser, "password"> | null> {
    const db = this.getDb();
    const current = await this.getUser(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const username = patch.username !== undefined ? patch.username.trim() : current.username;
    const password = patch.password !== undefined && patch.password.trim() ? patch.password.trim() : current.password;
    const name = patch.name !== undefined ? patch.name.trim() : current.name;
    const role = patch.role !== undefined ? (patch.role === "admin" ? "admin" : "user") : current.role;
    const avatar = patch.avatar !== undefined ? patch.avatar : current.avatar;
    const permissions = patch.permissions !== undefined
      ? (Array.isArray(patch.permissions) ? JSON.stringify(patch.permissions) : patch.permissions)
      : current.permissions;
    const onboarded = patch.onboarded !== undefined ? patch.onboarded : current.onboarded;

    db.prepare("UPDATE users SET username = ?, password = ?, name = ?, role = ?, avatar = ?, permissions = ?, onboarded = ?, updated_at = ? WHERE id = ?").run(
      username,
      password,
      name,
      role,
      avatar,
      permissions,
      onboarded,
      now,
      id
    );
    const updated = await this.getUser(id);
    const { password: _, ...safe } = updated!;
    return safe;
  }

  async deleteUser(id: string): Promise<boolean> {
    const db = this.getDb();
    const info = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return info.changes > 0;
  }

  // --- TELEMETRY ---
  async getOverview(): Promise<any> {
    const db = this.getDb();
    const tableNames = ["config", "services", "routes", "nginx_routes", "peers_meta", "devices", "users", "usp_exec_logs", "usp_raw_messages"];
    const tables = tableNames.map(name => {
      const res = db.query("SELECT count(*) as cnt FROM " + name).get() as any;
      return {
        table_name: name,
        total_size: "< 100 KB",
        column_count: 7,
        estimated_rows: res?.cnt || 0
      };
    });

    return {
      database: "data/wafmgmt.db",
      version: "SQLite (Native Bun)",
      size: this.getDbSize(),
      sizeBytes: existsSync(DB_PATH) ? statSync(DB_PATH).size : 0,
      activeConnections: 1,
      tables
    };
  }

  private getDbSize(): string {
    try {
      if (!existsSync(DB_PATH)) return "0 B";
      const bytes = statSync(DB_PATH).size;
      return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    } catch {
      return "0 B";
    }
  }

  async getTableDetails(tableName: string, limit = 100, offset = 0): Promise<any> {
    const db = this.getDb();
    const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "");
    const countRes = db.query("SELECT count(*) as total FROM " + safeTable).get() as any;
    const rows = db.query("SELECT * FROM " + safeTable + " LIMIT ? OFFSET ?").all(limit, offset) as any[];

    const columns = rows.length > 0 ? Object.keys(rows[0]).map(c => ({
      column_name: c,
      data_type: typeof rows[0][c] === "number" ? "integer" : "text",
      is_nullable: "YES",
      column_default: null
    })) : [];

    return {
      tableName: safeTable,
      columns,
      totalRows: countRes?.total || 0,
      limit,
      offset,
      rows
    };
  }

  async executeQuery(queryText: string): Promise<any> {
    const db = this.getDb();
    const start = performance.now();
    try {
      const rows = db.query(queryText).all() as any[];
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        success: true,
        durationMs,
        rowCount: rows.length,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows: rows.slice(0, 500)
      };
    } catch (e: any) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        success: false,
        durationMs,
        error: e?.message || String(e)
      };
    }
  }

  async exportSqlDump(): Promise<string> {
    return JSON.stringify({
      config: await this.getConfig(),
      services: await this.getServices(),
      routes: await this.getRoutes(),
      nginxRoutes: await this.getNginxRoutes(),
      peersMeta: await this.getPeersMeta(),
      devices: await this.listDevices()
    }, null, 2);
  }

  // --- USP TELEMETRY (time-series) ---
  async insertUspTelemetry(deviceId: string, metric: string, value: number | null, ts: number = Date.now()): Promise<void> {
    if (value == null || !Number.isFinite(value)) return;
    const db = this.getDb();
    db.prepare("INSERT INTO usp_telemetry (ts, device_id, metric, value) VALUES (?, ?, ?, ?)").run(
      ts, deviceId, metric, value
    );
  }

  async queryUspTelemetry(deviceId: string, from: number, to: number, limit = 5000): Promise<{ ts: number; metric: string; value: number }[]> {
    const db = this.getDb();
    return db.query(
      "SELECT ts, metric, value FROM usp_telemetry WHERE device_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC LIMIT ?"
    ).all(deviceId, from, to, limit) as any[];
  }

  async pruneUspTelemetry(beforeTs: number): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM usp_telemetry WHERE ts < ?").run(beforeTs);
  }

  async clearUspTelemetry(deviceId?: string): Promise<void> {
    const db = this.getDb();
    if (deviceId) db.prepare("DELETE FROM usp_telemetry WHERE device_id = ?").run(deviceId);
    else db.run("DELETE FROM usp_telemetry");
  }

  async countUspTelemetry(): Promise<number> {
    const db = this.getDb();
    const r = db.query("SELECT count(*) as cnt FROM usp_telemetry").get() as any;
    return r?.cnt || 0;
  }
}

export const db = new WafSqliteDatabase();
