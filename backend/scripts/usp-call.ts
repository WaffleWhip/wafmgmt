/**
 * Raw USP call helper for troubleshooting (prints real middleware errors).
 *
 * Usage:
 *   bun run usp:call -- get --agent <id> --path Device.Ethernet.Link. [--depth 1] [--raw]
 *   bun run usp:call -- set --agent <id> --path Device.Ethernet.Link.4. --param Enable=1 --param LowerLayers=Device.Optical.Interface.1. [--partial true] [--raw]
 *   bun run usp:call -- add --agent <id> --path Device.Ethernet.VLANTermination. [--partial true]
 *   bun run usp:call -- operate --agent <id> --command Device.Reboot() [--key mykey]
 *
 * Env: USP_API (default http://192.168.1.100:3000)
 */
const API = process.env.USP_API || "http://192.168.1.100:3000";
const args = process.argv.slice(2);
const mode = args[0];
const raw = args.includes("--raw");

function flag(name: string, def = ""): string {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
function flags(name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === name && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
}
const agent = flag("--agent");
if (!agent) {
  console.error("--agent required");
  process.exit(1);
}
const base = `${API}/api/usp/${encodeURIComponent(agent)}`;

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const msg = (j: any) => j?.result?.msg || j?.result || j;

if (mode === "get") {
  const paths = flags("--path");
  const depth = Number(flag("--depth", "0"));
  const { json } = await post("get", { paths, maxDepth: depth, timeout: 60 });
  const m = msg(json);
  if (raw) {
    console.log(JSON.stringify(json, null, 2));
  } else {
    const reqs = m?.body?.response?.get_resp?.req_path_results || [];
    for (const rq of reqs) {
      const list = rq.resolved_path_results || [];
      console.log(`== ${rq.requested_path} => ${list.length} result(s)`);
      for (const rp of list) {
        const params = rp.result_params || {};
        const keys = Object.keys(params);
        console.log(`   ${rp.resolved_path} (${keys.length} params)`);
        for (const k of keys.slice(0, Number(flag("--limit", "0")) || keys.length)) {
          console.log(`      ${k} = ${params[k]}`);
        }
      }
    }
  }
} else if (mode === "set") {
  const path = flag("--path");
  const pairs = flags("--param").map((p) => {
    const eq = p.indexOf("=");
    return { name: p.slice(0, eq), value: p.slice(eq + 1), required: false };
  });
  const allowPartial = flag("--partial", "true") !== "false";
  const { json } = await post("set", { updates: [{ objPath: path, params: pairs }], allowPartial, timeout: 30 });
  const m = msg(json);
  if (raw) console.log(JSON.stringify(json, null, 2));
  const uor = m?.body?.response?.set_resp?.updated_obj_results?.[0];
  if (!uor) {
    console.log(`SET ${path} => no set_resp (see --raw)`);
  } else if (uor.oper_status?.oper_failure) {
    console.log(`SET ${path} => GROUP FAIL ${uor.oper_status.oper_failure.err_code}: ${uor.oper_status.oper_failure.err_msg}`);
  } else {
    const inst = uor.oper_status?.oper_success?.updated_inst_results || [];
    const errs = inst.flatMap((i: any) => i.param_errs || []);
    if (errs.length) {
      console.log(`SET ${path} => ${errs.length} param error(s):`);
      for (const e of errs) console.log(`   [${e.err_code}] ${e.param}: ${e.err_msg}`);
      const ok = inst.flatMap((i: any) => Object.keys(i.updated_params || {}));
      if (ok.length) console.log(`   applied: ${ok.join(", ")}`);
    } else {
      const ok = inst.flatMap((i: any) => Object.keys(i.updated_params || {}));
      console.log(`SET ${path} => OK${ok.length ? ` (applied: ${ok.join(", ")})` : ""}`);
    }
  }
} else if (mode === "add") {
  const path = flag("--path");
  const pairs = flags("--param").map((p) => {
    const eq = p.indexOf("=");
    return { name: p.slice(0, eq), value: p.slice(eq + 1), required: false };
  });
  const allowPartial = flag("--partial", "true") !== "false";
  const { json } = await post("add", { createObjs: [{ objPath: path, params: pairs }], allowPartial, timeout: 30 });
  const m = msg(json);
  if (raw) console.log(JSON.stringify(json, null, 2));
  const cor = m?.body?.response?.add_resp?.created_obj_results?.[0];
  if (!cor) console.log(`ADD ${path} => no add_resp (see --raw)`);
  else if (cor.oper_status?.oper_failure) console.log(`ADD ${path} => FAIL ${cor.oper_status.oper_failure.err_code}: ${cor.oper_status.oper_failure.err_msg}`);
  else {
    const s = cor.oper_status?.oper_success;
    const errs = s?.param_errs || [];
    console.log(`ADD ${path} => OK ${s?.instantiated_path}${errs.length ? ` (${errs.length} param err)` : ""}`);
    for (const e of errs) console.log(`   [${e.err_code}] ${e.param}: ${e.err_msg}`);
  }
} else if (mode === "del") {
  const paths = flags("--path");
  const allowPartial = flag("--partial", "true") !== "false";
  const { json } = await post("delete", { objPaths: paths, allowPartial, timeout: 30 });
  const m = msg(json);
  if (raw) console.log(JSON.stringify(json, null, 2));
  const results = m?.body?.response?.delete_resp?.deleted_obj_results || [];
  for (const r of results) {
    if (r.oper_status?.oper_failure) console.log(`DEL ${r.requested_path} => FAIL ${r.oper_status.oper_failure.err_code}: ${r.oper_status.oper_failure.err_msg}`);
    else console.log(`DEL ${r.requested_path} => OK`);
  }
  if (!results.length) console.log(`DEL ${paths.join(", ")} => no delete_resp (see --raw)`);
} else if (mode === "operate") {
  const command = flag("--command");
  const key = flag("--key", `key-${Date.now()}`);
  const { json } = await post("operate", { command, commandKey: key });
  const m = msg(json);
  if (raw) console.log(JSON.stringify(json, null, 2));
  const err = m?.body?.error;
  const resp = m?.body?.response?.operate_resp;
  if (err) console.log(`OPERATE ${command} => ERR ${err.err_code}: ${err.err_msg}`);
  else console.log(`OPERATE ${command} => OK ${resp?.req_obj_results?.[0]?.oper_status?.oper_success ? "(executed)" : ""}`);
} else {
  console.error("unknown mode. use: get|set|add|operate");
  process.exit(1);
}
