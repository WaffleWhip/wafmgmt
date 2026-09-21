import mqtt from "mqtt";
import protobuf from "protobufjs";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const BROKER_HOST = process.env.BROKER_HOST || "usp-broker";
const BROKER_PORT = process.env.BROKER_PORT || "1883";
const BROKER_URL = `mqtt://${BROKER_HOST}:${BROKER_PORT}`;
const CONTROLLER_ID = process.env.CONTROLLER_ID || "controller";
const CONTROLLER_TOPIC = process.env.CONTROLLER_TOPIC || "usp/controller";
const AGENT_TOPIC = process.env.AGENT_TOPIC || "usp/agent";
const PORT = process.env.PORT || 8000;
const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_FILE = process.env.DB_FILE || "wafmgmt.db";
const DB_PATH = process.env.USP_DB_PATH || join(DATA_DIR, DB_FILE);

// SQLite Database Setup for USP Persistence
let db: Database | null = null;
try {
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode = WAL;");
  db.run(`
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
    CREATE TABLE IF NOT EXISTS usp_devices (
      id TEXT PRIMARY KEY,
      topic TEXT,
      name TEXT,
      ip TEXT,
      webui_port INTEGER,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usp_topic_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prefix TEXT NOT NULL UNIQUE,
      topic_template TEXT NOT NULL
    );
  `);
  db.run(`INSERT OR IGNORE INTO usp_topic_rules (prefix, topic_template) VALUES ('ops::', 'usp/agent');`);
  db.run(`INSERT OR IGNORE INTO usp_topic_rules (prefix, topic_template) VALUES ('proto::', 'hdm/usp/endpoint/agent/{id}');`);
  console.log(`[+] Connected to SQLite database: ${DB_PATH}`);
} catch (err) {
  console.error(`[!] Failed to initialize SQLite database at ${DB_PATH}:`, err);
}

interface DeviceInfo {
  id: string;
  topic: string;
  source: "auto" | "manual";
  firstSeenAt: number;
  lastSeenAt: number;
  status: "online" | "offline";
  name?: string;
  ip?: string;
  webui_port?: number | null;
}

const KNOWN_DEVICES = new Map<string, DeviceInfo>();

// Topic mapping rules: prefix of device id -> topic template ({id} = device id)
let TOPIC_RULES: Array<{ prefix: string; template: string }> = [];
if (db) {
  try {
    TOPIC_RULES = db.query("SELECT prefix, topic_template AS template FROM usp_topic_rules").all() as any[];
  } catch (err) {
    console.error("[!] Failed to load topic rules:", err);
  }
}

function loadDevicesFromDb(): void {
  if (!db) return;
  try {
    const rows = db.query("SELECT id, topic, name, ip, webui_port, first_seen, last_seen FROM usp_devices").all() as any[];
    for (const r of rows) {
      KNOWN_DEVICES.set(r.id, {
        id: r.id,
        topic: r.topic || AGENT_TOPIC,
        source: "auto",
        firstSeenAt: r.first_seen,
        lastSeenAt: r.last_seen,
        status: Date.now() - r.last_seen < 15 * 60 * 1000 ? "online" : "offline",
        name: r.name || undefined,
        ip: r.ip || undefined,
        webui_port: r.webui_port ?? null,
      });
    }
    console.log(`[+] Loaded ${rows.length} device(s) from database`);
  } catch (err) {
    console.error("[!] Failed to load devices from database:", err);
  }
}

function persistDevice(dev: DeviceInfo): void {
  if (!db) return;
  try {
    db.run(
      `INSERT INTO usp_devices (id, topic, name, ip, webui_port, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, name = excluded.name,
         ip = excluded.ip, webui_port = excluded.webui_port, last_seen = excluded.last_seen`,
      [dev.id, dev.topic, dev.name ?? null, dev.ip ?? null, dev.webui_port ?? null, dev.firstSeenAt, dev.lastSeenAt]
    );
  } catch (err) {
    console.error("[!] Failed to persist device:", err);
  }
}

function deriveTopic(deviceId: string): string {
  const known = KNOWN_DEVICES.get(deviceId)?.topic;
  if (known) return known;
  for (const rule of TOPIC_RULES) {
    if (deviceId.startsWith(rule.prefix)) {
      return rule.template.includes("{id}") ? rule.template.replace("{id}", deviceId) : rule.template;
    }
  }
  return AGENT_TOPIC;
}

function candidateTopics(deviceId: string): string[] {
  const list: string[] = [];
  const known = KNOWN_DEVICES.get(deviceId)?.topic;
  if (known) list.push(known);
  if (known) return list; // topic already learned: do not probe other candidates (would cut the timeout to 8s)
  for (const rule of TOPIC_RULES) {
    if (deviceId.startsWith(rule.prefix)) {
      const t = rule.template.includes("{id}") ? rule.template.replace("{id}", deviceId) : rule.template;
      if (!list.includes(t)) list.push(t);
    }
  }
  if (!list.includes(AGENT_TOPIC)) list.push(AGENT_TOPIC);
  return list;
}

function learnDeviceTopic(deviceId: string, topic: string): void {
  const dev = KNOWN_DEVICES.get(deviceId);
  if (!dev) return;
  if (dev.topic !== topic) {
    console.log(`[+] Learned topic for ${deviceId}: ${topic}`);
    dev.topic = topic;
    persistDevice(dev);
  }
}

loadDevicesFromDb();

// Execution logs buffer
interface ExecEntry {
  id: number;
  ts: number;
  operator: string;
  op: string;
  device: string;
  target: string;
  params?: any;
  result: string;
  detail?: any;
  durationMs: number;
}

// Raw MQTT Protocol Messages buffer
interface RawMessage {
  ts: number;
  direction: "tx" | "rx";
  agent: string;
  topic: string;
  msgId: string;
  msg: any;
}

function persistExecLog(entry: Omit<ExecEntry, "id">): ExecEntry {
  let id = Date.now();
  if (db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO usp_exec_logs (ts, operator, op, device, target, params, result, detail, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        entry.ts,
        entry.operator,
        entry.op,
        entry.device,
        entry.target,
        entry.params ? JSON.stringify(entry.params) : null,
        entry.result,
        entry.detail ? JSON.stringify(entry.detail) : null,
        entry.durationMs
      );
      id = Number(info.lastInsertRowid);
    } catch (err) {
      console.error("[!] Failed to persist exec log to DB:", err);
    }
  }
  return { id, ...entry };
}

function persistRawMessage(entry: RawMessage) {
  if (db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO usp_raw_messages (ts, direction, agent, topic, msg_id, msg)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        entry.ts,
        entry.direction,
        entry.agent,
        entry.topic,
        entry.msgId,
        typeof entry.msg === "string" ? entry.msg : JSON.stringify(entry.msg)
      );
    } catch (err) {
      console.error("[!] Failed to persist raw message to DB:", err);
    }
  }
}

function queryExecLogs(limit = 200): ExecEntry[] {
  if (db) {
    try {
      const rows = db.query(`
        SELECT id, ts, operator, op, device, target, params, result, detail, duration_ms as durationMs
        FROM usp_exec_logs
        ORDER BY id DESC
        LIMIT ?
      `).all(limit) as any[];
      return rows.map((r) => ({
        ...r,
        params: r.params ? JSON.parse(r.params) : null,
        detail: r.detail ? JSON.parse(r.detail) : null,
      }));
    } catch (err) {
      console.error("[!] Error querying exec logs from DB:", err);
    }
  }
  return [];
}

function queryRawMessages(limit = 100): RawMessage[] {
  if (db) {
    try {
      const rows = db.query(`
        SELECT ts, direction, agent, topic, msg_id as msgId, msg
        FROM usp_raw_messages
        ORDER BY id DESC
        LIMIT ?
      `).all(limit) as any[];
      return rows.map((r) => ({
        ...r,
        msg: (() => {
          try {
            return JSON.parse(r.msg);
          } catch {
            return r.msg;
          }
        })(),
      }));
    } catch (err) {
      console.error("[!] Error querying raw messages from DB:", err);
    }
  }
  return [];
}

// Load Proto types
const protoRoot = new protobuf.Root();
await protoRoot.load([join(import.meta.dir, "usp_record.proto"), join(import.meta.dir, "usp_msg.proto")], { keepCase: true });

const RecordType = protoRoot.lookupType("usp_record.Record");
const MsgType = protoRoot.lookupType("usp.Msg");

// Pending requests map: msg_id -> { resolve, reject, timer }
const pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: Timer; sentTopic?: string }>();

// MQTT Setup
console.log(`[*] Connecting to MQTT Broker at ${BROKER_URL}...`);
const mqttClient = mqtt.connect(BROKER_URL, {
  clientId: `usp-controller-service`,
  clean: true,
  protocolVersion: 4,
  reconnectPeriod: 2000,
});

mqttClient.on("connect", () => {
  console.log(`[+] Connected to MQTT broker ${BROKER_URL}`);
  mqttClient.subscribe(["usp/#", "hdm/#", CONTROLLER_TOPIC, AGENT_TOPIC], { qos: 0 }, (err) => {
    if (err) console.error(`[!] Failed to subscribe:`, err);
    else console.log(`[+] Subscribed to topics: usp/#, hdm/#, ${CONTROLLER_TOPIC}, ${AGENT_TOPIC}`);
  });
});

mqttClient.on("message", (topic, payload) => {
  try {
    const record = RecordType.decode(payload) as any;
    const fromId = record.from_id;

    // Ignore our own messages echoed back by the broker: we subscribe to usp/#
    // so every request we publish to usp/agent is delivered to ourselves. Without
    // this guard the pending request resolves with the echoed request (no response
    // payload), which is why GET returned 0 parameters.
    if (fromId === CONTROLLER_ID) return;

    if (fromId) {
      const existing = KNOWN_DEVICES.get(fromId);
      if (existing) {
        existing.lastSeenAt = Date.now();
        existing.status = "online";
        persistDevice(existing);
      } else {
        const dev: DeviceInfo = {
          id: fromId,
          topic: deriveTopic(fromId),
          source: "auto",
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          status: "online",
          name: fromId.split("-")[1] || fromId,
          ip: "Unknown",
          webui_port: null,
        };
        KNOWN_DEVICES.set(fromId, dev);
        persistDevice(dev);
        console.log(`[+] Auto-discovered device: ${fromId} (topic: ${dev.topic})`);
      }
    }

    let payloadBytes: Uint8Array | null = null;
    if (record.no_session_context && record.no_session_context.payload) {
      payloadBytes = record.no_session_context.payload;
    } else if (record.session_context && record.session_context.payload) {
      payloadBytes = record.session_context.payload;
    }

    if (payloadBytes) {
      const decodedMsg = MsgType.decode(payloadBytes);
      const msgObj = MsgType.toObject(decodedMsg, {
        enums: String,
        longs: String,
        bytes: String,
        defaults: false,
        arrays: true,
        objects: true,
        oneofs: true,
      }) as any;

      const msgId = msgObj.header?.msg_id;

      // Push to raw protocol message log & persist to SQLite
      persistRawMessage({
        ts: Date.now(),
        direction: "rx",
        agent: fromId,
        topic,
        msgId,
        msg: msgObj,
      });

      if (msgId && pendingRequests.has(msgId)) {
        const pending = pendingRequests.get(msgId)!;
        clearTimeout(pending.timer);
        pendingRequests.delete(msgId);
        if (pending.sentTopic) learnDeviceTopic(fromId, pending.sentTopic);
        pending.resolve(msgObj);
      }
    }
  } catch (err) {
    console.error("[!] Error parsing incoming USP message:", err);
  }
});

function sendUspRequest(deviceId: string, msgPayload: any, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const msgId = msgPayload.header.msg_id;
    const errMsg = MsgType.verify(msgPayload);
    if (errMsg) return reject(new Error(`Protobuf Msg verification error: ${errMsg}`));

    const msgBuffer = MsgType.encode(MsgType.create(msgPayload)).finish();

    const recordPayload = {
      version: "1.0",
      to_id: deviceId,
      from_id: CONTROLLER_ID,
      payload_security: 0, // PLAINTEXT
      no_session_context: {
        payload: msgBuffer,
      },
    };

    const errRec = RecordType.verify(recordPayload);
    if (errRec) return reject(new Error(`Protobuf Record verification error: ${errRec}`));

    const recordBuffer = RecordType.encode(RecordType.create(recordPayload)).finish();
    const candidates = candidateTopics(deviceId);
    const startedAt = Date.now();
    let attempt = 0;

    const tryNext = () => {
      if (attempt >= candidates.length || Date.now() - startedAt >= timeoutMs) {
        pendingRequests.delete(msgId);
        reject(new Error(`USP request timed out after ${Math.round((Date.now() - startedAt) / 1000)}s`));
        return;
      }

      const topic = candidates[attempt++];
      const remaining = timeoutMs - (Date.now() - startedAt);
      // Single candidate: wait for the full budget (large queries like "Device." can exceed 8s).
      // Multiple candidates (new device probe): cap each candidate at 8s.
      const attemptMs = candidates.length > 1 ? Math.max(3000, Math.min(8000, remaining)) : remaining;

      // Push TX raw protocol message & persist to SQLite
      persistRawMessage({
        ts: Date.now(),
        direction: "tx",
        agent: deviceId,
        topic,
        msgId,
        msg: msgPayload,
      });

      const timer = setTimeout(() => {
        const pending = pendingRequests.get(msgId);
        if (pending && pending.timer === timer) tryNext();
      }, attemptMs);

      pendingRequests.set(msgId, { resolve, reject, timer, sentTopic: topic });

      mqttClient.publish(topic, Buffer.from(recordBuffer), { qos: 0 }, (err) => {
        if (err) {
          clearTimeout(timer);
          pendingRequests.delete(msgId);
          reject(err);
        }
      });
    };

    tryNext();
  });
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

interface TemplateField {
  name: string;
  label: string;
  type: "text" | "password" | "number";
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
}

interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: string;
  destructive: boolean;
  fields: TemplateField[];
}

const TEMPLATES_DIR = join(DATA_DIR, "usp-templates");

const STARTER_TEMPLATES: Record<string, any> = {
  "wan-internet-pppoe": {
    name: "WAN PPPoE",
    description: "Create a WAN PPPoE stack: VLAN, PPP, IP, NAT, route.",
    category: "WAN",
    destructive: false,
    variables: { vlan_id: "200", username: "", password: "" },
    fields: [
      { name: "vlan_id", label: "VLAN ID", type: "number", required: true, defaultValue: "200" },
      { name: "username", label: "PPPoE Username", type: "text", required: true, defaultValue: "" },
      { name: "password", label: "PPPoE Password", type: "password", required: true, defaultValue: "" }
    ],
    steps: [
      { action: "check_or_add", object: "Device.X_TP_GPON.Link.", save_as: "gpon_link", default_path: "Device.X_TP_GPON.Link.1." },
      { action: "set", path: "${gpon_link}", parameters: { Enable: "1", LowerLayers: "Device.Optical.Interface.1." } },
      { action: "add", object: "Device.Ethernet.Link.", save_as: "eth_link" },
      { action: "set", path: "${eth_link}", parameters: { Enable: "1", LowerLayers: "${gpon_link}" } },
      { action: "add", object: "Device.Ethernet.VLANTermination.", save_as: "vlan_term" },
      { action: "set", path: "${vlan_term}", parameters: { Enable: "1", LowerLayers: "${eth_link}", VLANID: "${vlan_id}", X_TP_VLANEnable: "1", X_TP_VLANMode: "2", X_TP_MulticastStatus: "1" } },
      { action: "add", object: "Device.PPP.Interface.", save_as: "ppp_if" },
      { action: "set", path: "${ppp_if}", parameters: { AuthenticationProtocol: "AUTO_AUTH", Enable: "1", IPv6CPEnable: "0", LowerLayers: "${vlan_term}", Username: "${username}", Password: "${password}", X_TP_UsernameDomainEnable: "1" } },
      { action: "add", object: "Device.IP.Interface.", save_as: "ip_if" },
      { action: "set", path: "${ip_if}", parameters: { Enable: "1", IPv4Enable: "1", MaxMTUSize: "1480", LowerLayers: "${ppp_if}", X_TP_DisableDHCP: "1", X_TP_ServiceType: "Internet" } },
      { action: "add", object: "Device.NAT.InterfaceSetting.", save_as: "nat_setting" },
      { action: "set", path: "${nat_setting}", parameters: { Enable: "1", Interface: "${ip_if}" } },
      { action: "add", object: "Device.Routing.RIP.InterfaceSetting.", save_as: "rip_setting" },
      { action: "set", path: "${rip_setting}", parameters: { AcceptRA: "1", Interface: "${ip_if}" } },
      { action: "add", object: "Device.Routing.Router.1.IPv4Forwarding.", save_as: "fwd_setting" },
      { action: "set", path: "${fwd_setting}", parameters: { Enable: "1", Interface: "${ip_if}", Origin: "IPCP" } },
      { action: "set", path: "${ip_if}", parameters: { X_TP_ConnOperation: "Connect" } },
      { action: "set", path: "${ppp_if}", parameters: { Reset: "1" } }
    ]
  },
  "wan-cleanup": {
    name: "WAN Cleanup",
    description: "Delete all WAN objects. The LAN bridge is left untouched.",
    category: "WAN",
    destructive: true,
    fields: [],
    targets: [
      { base_path: "Device.IP.Interface.", min_index_to_delete: 4 },
      { base_path: "Device.PPP.Interface.", min_index_to_delete: 0 },
      { base_path: "Device.Ethernet.VLANTermination.", min_index_to_delete: 1 },
      { base_path: "Device.Ethernet.Link.", min_index_to_delete: 3 },
      { base_path: "Device.NAT.InterfaceSetting.", min_index_to_delete: 3 },
      { base_path: "Device.Routing.RIP.InterfaceSetting.", min_index_to_delete: 3 },
      { base_path: "Device.Routing.Router.1.IPv4Forwarding.", min_index_to_delete: 7 }
    ]
  }
};

function ensureTemplateFiles() {
  try {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
    for (const [id, tpl] of Object.entries(STARTER_TEMPLATES)) {
      const file = join(TEMPLATES_DIR, `${id}.json`);
      if (!existsSync(file)) {
        writeFileSync(file, JSON.stringify({ id, ...tpl }, null, 2), "utf-8");
      }
    }
  } catch (err) {
    console.error("[!] Failed to prepare template files:", err);
  }
}

function templateFilePath(id: string): string {
  return join(TEMPLATES_DIR, `${id}.json`);
}

function isValidTemplateId(id: string): boolean {
  return typeof id === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(id) && id.length <= 64;
}

function deriveFields(variables: Record<string, any>): TemplateField[] {
  return Object.entries(variables || {}).map(([name, value]) => ({
    name,
    label: name.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: /pass|secret|pwd/i.test(name) ? "password" : "text",
    required: true,
    defaultValue: String(value ?? ""),
  }));
}

function loadTemplate(id: string): any | null {
  if (!isValidTemplateId(id)) return null;
  const file = templateFilePath(id);
  if (!existsSync(file)) return null;
  try {
    return { ...JSON.parse(readFileSync(file, "utf-8")), id };
  } catch (err: any) {
    console.error(`[!] Failed to read template ${id}:`, err.message);
    return null;
  }
}

function listTemplates(): TemplateDef[] {
  ensureTemplateFiles();
  try {
    return readdirSync(TEMPLATES_DIR)
      .filter((file) => file.endsWith(".json"))
      .map((file) => loadTemplate(file.replace(/\.json$/i, "")))
      .filter((tpl): tpl is any => !!tpl)
      .map((tpl) => ({
        id: tpl.id,
        name: tpl.name || tpl.id,
        description: tpl.description || "",
        category: tpl.category || "General",
        destructive: !!tpl.destructive,
        fields:
          Array.isArray(tpl.fields) && tpl.fields.length > 0
            ? tpl.fields
            : deriveFields(tpl.variables || {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    console.error("[!] Failed to list templates:", err);
    return [];
  }
}

function saveTemplate(id: string, data: any): void {
  writeFileSync(templateFilePath(id), JSON.stringify({ id, ...data }, null, 2), "utf-8");
}

function removeTemplate(id: string): boolean {
  const file = templateFilePath(id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

async function runTemplate(deviceId: string, template: any, inputs: Record<string, any>) {
  const steps: TemplateStep[] = [];
  const push = (step: Omit<TemplateStep, "at">) => steps.push({ ...step, at: Date.now() });
  const saved: Record<string, string> = {};
  const vars: Record<string, string> = { ...(template.variables || {}), ...inputs };
  const subst = (value: any): string =>
    String(value).replace(/\$\{(\w+)\}/g, (_, key) => saved[key] ?? vars[key] ?? "");
  let stepNo = 1;

  if (Array.isArray(template.targets) && template.targets.length > 0) {
    for (const target of template.targets) {
      const base = String(target.base_path || target.basePath || "");
      if (!base) continue;
      const minIndex = Number(target.min_index_to_delete ?? target.minIndex ?? 0);
      const res = await uspGet(deviceId, base, 0);
      const instances = extractInstances(res, base).filter(
        (p) => parseInt(p.slice(base.length, -1), 10) > minIndex
      );
      if (instances.length === 0) {
        push({ step: stepNo++, action: "scan", target: base, status: "clean" });
        continue;
      }
      try {
        const delRes = await uspDelete(deviceId, instances);
        const results = delRes?.body?.response?.delete_resp?.deleted_obj_results || [];
        for (const item of instances) {
          const matched = results.find((r: any) => (r.requested_path || r.requestedPath) === item);
          const operStatus = matched?.oper_status;
          const ok = !!operStatus?.oper_success;
          push({
            step: stepNo++,
            action: "delete",
            target: item,
            status: ok ? "deleted" : "failed",
            detail: ok ? undefined : `${operStatus?.oper_failure?.err_code} ${operStatus?.oper_failure?.err_msg}`,
          });
        }
      } catch (err: any) {
        for (const item of instances) {
          push({ step: stepNo++, action: "delete", target: item, status: "failed", detail: err.message });
        }
      }
    }
    return { steps, summary: { status: "SUCCESS", deleted: steps.filter((s) => s.status === "deleted").length } };
  }

  const stepList = Array.isArray(template.steps) ? template.steps : [];
  for (const step of stepList) {
    const action = String(step.action || "");
    if (action === "check_or_add") {
      const object = subst(step.object);
      const instances = extractInstances(await uspGet(deviceId, object, 1), object);
      if (instances.length > 0) {
        if (step.save_as) saved[step.save_as] = instances[0];
        push({ step: stepNo++, action: "check_or_add", target: instances[0], status: "already exists" });
      } else {
        const created = await uspAdd(deviceId, object);
        if (step.save_as) saved[step.save_as] = created;
        push({ step: stepNo++, action: "check_or_add", target: created, status: "created" });
      }
      continue;
    }
    if (action === "add") {
      const created = await uspAdd(deviceId, subst(step.object));
      if (step.save_as) saved[step.save_as] = created;
      push({ step: stepNo++, action: "add", target: created, status: "created" });
      continue;
    }
    if (action === "set") {
      const target = subst(step.path);
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.parameters || {})) params[key] = normalizeRef(subst(value));
      const res = await uspSet(deviceId, target, params);
      const errs = extractSetErrors(res);
      push({
        step: stepNo++,
        action: "set",
        target,
        status: errs.length ? "failed" : "ok",
        detail: errs.length ? errs.map((e) => `${e.param}(${e.errCode})`).join(", ") : Object.keys(params).join(", "),
      });
      continue;
    }
    if (action === "delete") {
      const target = subst(step.path);
      const delRes = await uspDelete(deviceId, [target]);
      const operStatus = delRes?.body?.response?.delete_resp?.deleted_obj_results?.[0]?.oper_status;
      const ok = !!operStatus?.oper_success;
      push({
        step: stepNo++,
        action: "delete",
        target,
        status: ok ? "deleted" : "failed",
        detail: ok ? undefined : `${operStatus?.oper_failure?.err_code} ${operStatus?.oper_failure?.err_msg}`,
      });
      continue;
    }
    push({ step: stepNo++, action: action || "unknown", target: "-", status: "skipped", detail: "unknown action" });
  }

  return { steps, summary: { status: "SUCCESS", steps: steps.length } };
}

interface TemplateStep {
  step: number;
  action: string;
  target: string;
  status: string;
  detail?: string;
  at?: number;
}

function templateMsgId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).substring(2, 10)}`;
}

// Some agents (e.g. FiberHome) reject object references written with a trailing
// dot for parameters like LowerLayers/Interface ("Device.Optical.Interface.1."),
// while the canonical TR-181 form has no trailing dot. Normalize those values.
function normalizeRef(value: string): string {
  return /^Device(\.[A-Za-z0-9_]+)+\.$/.test(value) ? value.slice(0, -1) : value;
}

interface SetParamError {
  path: string;
  param: string;
  errCode: number;
  errMsg: string;
}

/** Extract per-parameter failures from a SET_RESP (middleware may reject some params). */
function extractSetErrors(result: any): SetParamError[] {
  const updatedResults = result?.body?.response?.set_resp?.updated_obj_results || [];
  const errors: SetParamError[] = [];
  for (const ur of updatedResults) {
    const os = ur?.oper_status;
    for (const ir of os?.oper_success?.updated_inst_results || []) {
      for (const pe of ir.param_errs || []) {
        errors.push({
          path: ir.affected_path || ur.requested_path,
          param: pe.param,
          errCode: pe.err_code,
          errMsg: pe.err_msg,
        });
      }
    }
    if (os?.oper_failure) {
      errors.push({
        path: ur.requested_path,
        param: "*",
        errCode: os.oper_failure.err_code,
        errMsg: os.oper_failure.err_msg,
      });
    }
  }
  return errors;
}

function buildParamSettings(params: Record<string, any>) {
  return Object.entries(params).map(([param, value]) => ({
    param,
    value: String(value),
    required: false,
  }));
}

async function uspGet(deviceId: string, path: string, depth = 0, timeoutMs = 10000): Promise<any> {
  return sendUspRequest(
    deviceId,
    {
      header: { msg_id: templateMsgId("tpl-get"), msg_type: 1 },
      body: { request: { get: { param_paths: [path], max_depth: depth } } },
    },
    timeoutMs
  );
}

async function uspAdd(deviceId: string, objPath: string, timeoutMs = 15000): Promise<string> {
  const res = await sendUspRequest(
    deviceId,
    {
      header: { msg_id: templateMsgId("tpl-add"), msg_type: 8 },
      body: { request: { add: { allow_partial: true, create_objs: [{ obj_path: objPath, param_settings: [] }] } } },
    },
    timeoutMs
  );
  if (res?.body?.error) {
    throw new Error(`ADD ${objPath} failed: ${res.body.error.err_code} ${res.body.error.err_msg}`);
  }
  const operStatus = res?.body?.response?.add_resp?.created_obj_results?.[0]?.oper_status;
  const instantiated = operStatus?.oper_success?.instantiated_path;
  if (instantiated) return instantiated;
  if (operStatus?.oper_failure) {
    throw new Error(`ADD ${objPath} failed: ${operStatus.oper_failure.err_code} ${operStatus.oper_failure.err_msg}`);
  }
  throw new Error(`ADD ${objPath} returned no instantiated path`);
}

async function uspSet(deviceId: string, objPath: string, params: Record<string, any>, timeoutMs = 15000): Promise<any> {
  const res = await sendUspRequest(
    deviceId,
    {
      header: { msg_id: templateMsgId("tpl-set"), msg_type: 4 },
      body: {
        request: {
          set: {
            allow_partial: true,
            update_objs: [{ obj_path: objPath, param_settings: buildParamSettings(params) }],
          },
        },
      },
    },
    timeoutMs
  );
  if (res?.body?.error) {
    throw new Error(`SET ${objPath} failed: ${res.body.error.err_code} ${res.body.error.err_msg}`);
  }
  const operStatus = res?.body?.response?.set_resp?.updated_obj_results?.[0]?.oper_status;
  if (operStatus?.oper_failure) {
    throw new Error(`SET ${objPath} failed: ${operStatus.oper_failure.err_code} ${operStatus.oper_failure.err_msg}`);
  }
  return res;
}

async function uspDelete(deviceId: string, objPaths: string[], timeoutMs = 25000): Promise<any> {
  return sendUspRequest(
    deviceId,
    {
      header: { msg_id: templateMsgId("tpl-del"), msg_type: 10 },
      body: { request: { delete: { allow_partial: true, obj_paths: objPaths } } },
    },
    timeoutMs
  );
}

function extractParams(res: any, fallbackPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const response = res?.body?.response || {};
  const getResp = response.get_resp || response.getResp || {};
  const reqResults = getResp.req_path_results || getResp.reqPathResults || [];
  for (const reqResult of reqResults) {
    const requestedPath = reqResult.requested_path || reqResult.requestedPath || fallbackPath;
    const resolvedList = reqResult.resolved_path_results || reqResult.resolvedPathResults || [];
    for (const resolved of resolvedList) {
      const basePath = resolved.resolved_path || resolved.resolvedPath || requestedPath;
      const params = resolved.result_params || resolved.resultParams || {};
      for (const [key, value] of Object.entries(params)) {
        out[`${basePath}${key}`] = String(value);
      }
    }
  }
  return out;
}

function extractInstances(res: any, basePath: string): string[] {
  const instances = new Set<string>();
  for (const fullPath of Object.keys(extractParams(res, basePath))) {
    const remainder = fullPath.slice(basePath.length);
    const first = remainder.split(".")[0];
    if (first && /^\d+$/.test(first)) instances.add(`${basePath}${first}.`);
  }
  return Array.from(instances).sort((a, b) => {
    const ai = parseInt(a.slice(basePath.length, -1), 10);
    const bi = parseInt(b.slice(basePath.length, -1), 10);
    return ai - bi;
  });
}


// HTTP handler mounted by the composition root (apps/server)
export async function uspFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/api/usp/health") {
      return jsonResponse({
        status: "ok",
        broker: mqttClient.connected ? "connected" : "disconnected",
        time: Date.now(),
      });
    }

    // GET /api/devices or /api/usp/devices
    if ((url.pathname === "/api/devices" || url.pathname === "/api/usp/devices") && req.method === "GET") {
      const now = Date.now();
      // An ONT is online if it has been seen within the last 15 minutes or if known active
      const list = Array.from(KNOWN_DEVICES.values()).map((d) => {
        const isRecent = d.lastSeenAt ? (now - d.lastSeenAt <= 900000) : false;
        return {
          ...d,
          status: isRecent ? "online" : "offline",
        };
      });
      return jsonResponse({ devices: list });
    }

    // GET /api/usp/exec
    if (url.pathname === "/api/usp/exec" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "200", 10);
      return jsonResponse({ entries: queryExecLogs(limit) });
    }

    // GET /api/usp/messages
    if (url.pathname === "/api/usp/messages" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      return jsonResponse({ messages: queryRawMessages(limit) });
    }

    // GET /api/usp/broker-logs (Live Mosquitto Broker Logs)
    if (url.pathname === "/api/usp/broker-logs" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      const logPath = join(DATA_DIR, "mosquitto", "log", "mosquitto.log");
      if (!existsSync(logPath)) {
        return jsonResponse({ logs: [] });
      }
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const sliced = lines.slice(-limit);
        return jsonResponse({ logs: sliced });
      } catch (err: any) {
        return jsonResponse({ error: err.message, logs: [] }, 500);
      }
    }

    // GET /api/usp/templates — list template files from DATA_DIR/usp-templates
    if (url.pathname === "/api/usp/templates" && req.method === "GET") {
      return jsonResponse({ templates: listTemplates() });
    }

    // GET /api/usp/templates/:id — raw template file
    if (req.method === "GET" && url.pathname.startsWith("/api/usp/templates/")) {
      const id = decodeURIComponent(url.pathname.split("/")[4] || "");
      const template = loadTemplate(id);
      if (!template) return jsonResponse({ error: `Template not found: ${id}` }, 404);
      return jsonResponse({ template });
    }

    // POST /api/usp/templates — create or update a template file
    if (url.pathname === "/api/usp/templates" && req.method === "POST") {
      const body = (await req.json()) as any;
      const id = String(body.id || "").trim().toLowerCase();
      if (!isValidTemplateId(id)) {
        return jsonResponse({ error: "Invalid template id (use a-z, 0-9, dot, underscore, dash)" }, 400);
      }
      if (!Array.isArray(body.steps) && !Array.isArray(body.targets)) {
        return jsonResponse({ error: "Template needs a steps[] or targets[] array" }, 400);
      }
      saveTemplate(id, {
        name: String(body.name || id),
        description: String(body.description || ""),
        category: String(body.category || "General"),
        destructive: !!body.destructive,
        variables: body.variables || {},
        fields: Array.isArray(body.fields) ? body.fields : undefined,
        steps: body.steps,
        targets: body.targets,
      });
      persistExecLog({
        ts: Date.now(),
        operator: "admin",
        op: "TEMPLATE_SAVE",
        device: "-",
        target: id,
        params: { name: body.name, category: body.category, destructive: !!body.destructive },
        result: "SUCCESS",
        detail: { file: templateFilePath(id) },
        durationMs: 0,
      });
      return jsonResponse({ ok: true, template: loadTemplate(id) });
    }

    // DELETE /api/usp/templates/:id — remove template file
    if (req.method === "DELETE" && url.pathname.startsWith("/api/usp/templates/")) {
      const id = decodeURIComponent(url.pathname.split("/")[4] || "");
      const removed = removeTemplate(id);
      if (!removed) return jsonResponse({ error: `Template not found: ${id}` }, 404);
      persistExecLog({
        ts: Date.now(),
        operator: "admin",
        op: "TEMPLATE_DELETE",
        device: "-",
        target: id,
        result: "SUCCESS",
        durationMs: 0,
      });
      return jsonResponse({ ok: true, id });
    }

    // POST /api/usp/templates/run
    if (url.pathname === "/api/usp/templates/run" && req.method === "POST") {
      const startTime = Date.now();
      const body = (await req.json()) as any;
      const template = loadTemplate(body.template);
      if (!template) {
        return jsonResponse({ error: `Unknown template: ${body.template}` }, 404);
      }
      const deviceId = body.device_id;
      if (!deviceId) {
        return jsonResponse({ error: "device_id required" }, 400);
      }
      const inputs = body.inputs || {};
      const fields =
        Array.isArray(template.fields) && template.fields.length > 0
          ? template.fields
          : deriveFields(template.variables || {});
      for (const field of fields) {
        if (field.required && !String(inputs[field.name] ?? "").trim()) {
          return jsonResponse({ error: `Missing required input: ${field.label}` }, 400);
        }
      }

      try {
        const runResult = await runTemplate(deviceId, template, inputs);

        const log = [
          { ts: startTime, level: "info", text: `run ${template.id} on ${deviceId}` },
          ...runResult.steps.map((step) => ({
            ts: step.at || Date.now(),
            level: step.status === "failed" ? "error" : step.status === "already exists" ? "info" : "ok",
            text: `[${step.status}] ${step.action} ${step.target}${step.detail ? ` — ${step.detail}` : ""}`,
          })),
          {
            ts: Date.now(),
            level: "info",
            text: `done in ${Date.now() - startTime}ms · ${runResult.steps.length} step`,
          },
        ];

        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "TEMPLATE",
          device: deviceId,
          target: `${template.id} (${runResult.steps.length} step)`,
          params: { template: template.id, inputs: { ...inputs, password: inputs.password ? "***" : undefined } },
          result: "SUCCESS",
          detail: { summary: runResult.summary, log },
          durationMs: Date.now() - startTime,
        });

        return jsonResponse({
          ok: true,
          template: template.id,
          device_id: deviceId,
          steps: runResult.steps,
          summary: runResult.summary,
          log,
        });
      } catch (err: any) {
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "TEMPLATE",
          device: deviceId,
          target: template.id,
          params: { template: template.id },
          result: "FAILED",
          detail: err.message,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ error: err.message }, 504);
      }
    }

    // Match /api/usp/:deviceId/get or /api/usp/get
    if (req.method === "POST" && (url.pathname === "/api/usp/get" || url.pathname.endsWith("/get"))) {
      const startTime = Date.now();
      try {
        let deviceId = "";
        let paths: string[] = [];
        let timeout = 10;

        const body = (await req.json()) as any;
        if (url.pathname === "/api/usp/get") {
          deviceId = body.device_id;
          paths = body.paths;
          timeout = body.timeout || 10;
        } else {
          // /api/usp/:deviceId/get
          const parts = url.pathname.split("/");
          deviceId = decodeURIComponent(parts[3] || "");
          paths = body.paths || [];
          timeout = body.timeout || 10;
        }

        if (!deviceId || !paths || !Array.isArray(paths)) {
          return jsonResponse({ error: "Invalid parameters. Require device_id and paths array." }, 400);
        }

        const msgId = Math.random().toString(16).substring(2, 10);
        const uspMsg = {
          header: {
            msg_id: msgId,
            msg_type: 1, // GET
          },
          body: {
            request: {
              get: {
                param_paths: paths,
                max_depth: Number(body.maxDepth) || 0,
              },
            },
          },
        };

        const result = await sendUspRequest(deviceId, uspMsg, timeout * 1000);
        const duration = Date.now() - startTime;

        const dev = KNOWN_DEVICES.get(deviceId);
        if (dev) {
          dev.lastSeenAt = Date.now();
          dev.status = "online";
        }

        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "GET",
          device: deviceId,
          target: paths.join(", "),
          result: "SUCCESS",
          detail: result,
          durationMs: duration,
        });

        // Support both direct result and result.msg format for frontend
        return jsonResponse({
          ok: true,
          result: { msg: result },
          ...result,
        });
      } catch (err: any) {
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "GET",
          device: "unknown",
          target: "error",
          result: "FAILED",
          detail: err.message,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ error: err.message }, 504);
      }
    }

    // Match /api/usp/:deviceId/set or /api/usp/set
    if (req.method === "POST" && (url.pathname === "/api/usp/set" || url.pathname.endsWith("/set"))) {
      const startTime = Date.now();
      try {
        let deviceId = "";
        const body = (await req.json()) as any;

        if (url.pathname === "/api/usp/set") {
          deviceId = body.device_id;
        } else {
          const parts = url.pathname.split("/");
          deviceId = decodeURIComponent(parts[3] || "");
        }

        const msgId = Math.random().toString(16).substring(2, 10);
        let updateObjs: any[] = [];

        if (body.updates && Array.isArray(body.updates)) {
          // ViewUspController format: { updates: [{ objPath, params: [{ name, value }] }] }
          updateObjs = body.updates.map((u: any) => ({
            obj_path: u.objPath,
            param_settings: (u.params || []).map((p: any) => ({
              param: p.name || p.param,
              value: String(p.value),
              required: !!p.required,
            })),
          }));
        } else if (body.params && Array.isArray(body.params)) {
          // Flat params format: { params: [{ path, value }] }
          const grouped = new Map<string, Array<{ param: string; value: string }>>();
          for (const item of body.params) {
            const lastDot = item.path.lastIndexOf(".");
            let objPath = item.path;
            let paramName = "";
            if (lastDot !== -1) {
              objPath = item.path.substring(0, lastDot + 1);
              paramName = item.path.substring(lastDot + 1);
            }
            if (!grouped.has(objPath)) grouped.set(objPath, []);
            grouped.get(objPath)!.push({ param: paramName, value: String(item.value) });
          }

          updateObjs = Array.from(grouped.entries()).map(([objPath, paramList]) => ({
            obj_path: objPath,
            param_settings: paramList.map((p) => ({
              param: p.param,
              value: p.value,
              required: true,
            })),
          }));
        }

        const uspMsg = {
          header: {
            msg_id: msgId,
            msg_type: 4, // SET
          },
          body: {
            request: {
              set: {
                allow_partial: body.allowPartial !== false,
                update_objs: updateObjs,
              },
            },
          },
        };

        const timeoutMs = (body.timeout || 10) * 1000;
        const result = await sendUspRequest(deviceId, uspMsg, timeoutMs);
        const duration = Date.now() - startTime;

        // Surface the middleware's real per-parameter errors instead of assuming success.
        const paramErrors = extractSetErrors(result);
        const failedObjects = new Set(paramErrors.map((e) => e.path)).size;

        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "SET",
          device: deviceId,
          target: `${updateObjs.length} object(s)`,
          result: paramErrors.length ? "PARTIAL" : "SUCCESS",
          detail: result,
          durationMs: duration,
        });

        return jsonResponse({
          ok: true,
          summary: {
            status: paramErrors.length ? "PARTIAL" : "SUCCESS",
            successCount: Math.max(0, updateObjs.length - failedObjects),
            failCount: paramErrors.length,
            paramErrors,
          },
          result,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 504);
      }
    }

    // Match /api/usp/:deviceId/add
    if (req.method === "POST" && url.pathname.endsWith("/add")) {
      const parts = url.pathname.split("/");
      const deviceId = decodeURIComponent(parts[3] || "");
      const body = (await req.json()) as any;
      const msgId = Math.random().toString(16).substring(2, 10);

      const createObjs = (body.createObjs || []).map((o: any) => ({
        obj_path: o.objPath,
        param_settings: (o.params || []).map((p: any) => ({
          param: p.name || p.param,
          value: String(p.value),
          required: !!p.required,
        })),
      }));
      const addObjPath = createObjs[0]?.obj_path || "";

      const uspMsg = {
        header: {
          msg_id: msgId,
          msg_type: 8, // ADD
        },
        body: {
          request: {
            add: {
              allow_partial: body.allowPartial !== false,
              create_objs: createObjs,
            },
          },
        },
      };

      const startTime = Date.now();
      try {
        const result = await sendUspRequest(deviceId, uspMsg, (body.timeout || 10) * 1000);
        const addResp = result?.body?.response?.add_resp;
        const createdResult = addResp?.created_obj_results?.[0];
        const operStatus = createdResult?.oper_status;
        const instantiatedPath = operStatus?.oper_success?.instantiated_path;
        const instNum = operStatus?.oper_success?.inst_num;
        const createdInstance =
          instantiatedPath ||
          (instNum !== undefined && instNum !== null ? `${addObjPath}${instNum}.` : addObjPath);

        const paramErrors = (operStatus?.oper_success?.param_errs || []).map((pe: any) => ({
          path: createdInstance,
          param: pe.param,
          errCode: pe.err_code,
          errMsg: pe.err_msg,
        }));
        const failed = !!operStatus?.oper_failure;
        if (failed) {
          paramErrors.push({
            path: addObjPath,
            param: "*",
            errCode: operStatus.oper_failure.err_code,
            errMsg: operStatus.oper_failure.err_msg,
          });
        }

        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "ADD",
          device: deviceId,
          target: addObjPath,
          params: createObjs,
          result: failed ? "FAILED" : paramErrors.length ? "PARTIAL" : "SUCCESS",
          detail: result,
          durationMs: Date.now() - startTime,
        });

        return jsonResponse({
          ok: true,
          summary: {
            status: failed ? "REJECTED" : "SUCCESS",
            createdInstances: failed ? [] : [createdInstance],
            errorCode: operStatus?.oper_failure?.err_code,
            errorMsg: operStatus?.oper_failure?.err_msg,
            paramErrors,
          },
          result,
        });
      } catch (err: any) {
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "ADD",
          device: deviceId,
          target: addObjPath,
          params: createObjs,
          result: "FAILED",
          detail: err.message,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ error: err.message }, 504);
      }
    }

    // Match /api/usp/:deviceId/delete
    if (req.method === "POST" && url.pathname.endsWith("/delete")) {
      const parts = url.pathname.split("/");
      const deviceId = decodeURIComponent(parts[3] || "");
      const body = (await req.json()) as any;
      const msgId = Math.random().toString(16).substring(2, 10);

      const uspMsg = {
        header: {
          msg_id: msgId,
          msg_type: 10, // DELETE
        },
        body: {
          request: {
            delete: {
              allow_partial: body.allowPartial !== false,
              obj_paths: body.objPaths || [],
            },
          },
        },
      };

      const startTime = Date.now();
      try {
        const result = await sendUspRequest(deviceId, uspMsg, (body.timeout || 10) * 1000);
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "DELETE",
          device: deviceId,
          target: (body.objPaths || []).join(", "),
          result: "SUCCESS",
          detail: result,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({
          ok: true,
          summary: {
            status: "SUCCESS",
            deletedPaths: body.objPaths || [],
          },
          result,
        });
      } catch (err: any) {
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "DELETE",
          device: deviceId,
          target: (body.objPaths || []).join(", "),
          result: "FAILED",
          detail: err.message,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ error: err.message }, 504);
      }
    }

    // Match /api/usp/:deviceId/operate or /api/usp/operate
    if (req.method === "POST" && (url.pathname === "/api/usp/operate" || url.pathname.endsWith("/operate"))) {
      let deviceId = "";
      const body = (await req.json()) as any;

      if (url.pathname === "/api/usp/operate") {
        deviceId = body.device_id;
      } else {
        const parts = url.pathname.split("/");
        deviceId = decodeURIComponent(parts[3] || "");
      }

      const msgId = Math.random().toString(16).substring(2, 10);
      const uspMsg = {
        header: {
          msg_id: msgId,
          msg_type: 6, // OPERATE
        },
        body: {
          request: {
            operate: {
              command: body.command,
              command_key: body.commandKey || body.command_key || Math.random().toString(16).substring(2, 10),
              send_resp: true,
              input_args: body.inputArgs || body.input_args || {},
            },
          },
        },
      };

      const startTime = Date.now();
      try {
        const result = await sendUspRequest(deviceId, uspMsg, (body.timeout || 10) * 1000);
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "OPERATE",
          device: deviceId,
          target: body.command || "",
          params: body.inputArgs || body.input_args || {},
          result: "SUCCESS",
          detail: result,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ ok: true, result });
      } catch (err: any) {
        persistExecLog({
          ts: Date.now(),
          operator: "admin",
          op: "OPERATE",
          device: deviceId,
          target: body.command || "",
          params: body.inputArgs || body.input_args || {},
          result: "FAILED",
          detail: err.message,
          durationMs: Date.now() - startTime,
        });
        return jsonResponse({ error: err.message }, 504);
      }
    }

    return new Response("Not Found", { status: 404 });
}

console.log("[+] USP module ready (mounted in wafmgmt-app)");
