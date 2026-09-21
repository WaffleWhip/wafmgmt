import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.PORT || 3003);
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASSWORD = process.env.SSH_PASSWORD || "";
const SSH_CONNECT_TIMEOUT = process.env.SSH_CONNECT_TIMEOUT || "10";

const decoder = new TextDecoder();

type WSData = {
  ip: string;
  port: number;
  deviceId: string;
  user: string;
  pass: string;
  proc: Bun.Subprocess | null;
};

export function terminalFetch(req: Request, server: any) {
    const url = new URL(req.url);

    if (url.pathname === "/ssh") {
      const data: WSData = {
        ip: url.searchParams.get("ip") || "",
        port: Number(url.searchParams.get("port") || 22) || 22,
        deviceId: url.searchParams.get("deviceId") || "",
        user: url.searchParams.get("user") || SSH_USER,
        pass: url.searchParams.get("pass") || SSH_PASSWORD,
        proc: null
      };
      if (server.upgrade(req, { data })) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("waf-terminal ok\n", { status: 200 });
}

export const terminalWebSocket = {
    open(ws: ServerWebSocket<WSData>) {
      const { ip, port, user, pass } = ws.data;
      if (!ip) {
        ws.send(JSON.stringify({ type: "error", message: "Missing device IP" }));
        ws.close();
        return;
      }

      ws.send(JSON.stringify({ type: "status", message: `Connecting to ${user}@${ip}:${port}…` }));

      const sshArgs = [
        "-tt",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
        "-o", "LogLevel=ERROR",
        "-p", String(port),
        `${user}@${ip}`
      ];
      const cmd = pass ? ["sshpass", "-p", pass, "ssh", ...sshArgs] : ["ssh", ...sshArgs];

      try {
        const proc = Bun.spawn(cmd, {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, TERM: "xterm-256color" }
        });
        ws.data.proc = proc;

        pump(proc.stdout, ws);
        pump(proc.stderr, ws);

        proc.exited.then((code) => {
          try {
            ws.send(JSON.stringify({ type: "status", message: `Session ended (exit ${code}).` }));
            ws.close();
          } catch {}
        });
      } catch (e: any) {
        ws.send(JSON.stringify({ type: "error", message: e?.message || "Failed to start SSH session" }));
        ws.close();
      }
    },
    message(ws: ServerWebSocket<WSData>, raw) {
      const proc = ws.data.proc;
      if (!proc) return;

      let text = typeof raw === "string" ? raw : decoder.decode(raw);
      try {
        const msg = JSON.parse(text);
        if (msg?.type === "input") text = msg.data ?? "";
        else return;
      } catch {
        /* raw fallback */
      }

      try {
        proc.stdin.write(text);
        proc.stdin.flush();
      } catch {}
    },
    close(ws: ServerWebSocket<WSData>) {
      try { ws.data.proc?.kill(); } catch {}
      ws.data.proc = null;
    }
  };

async function pump(
  stream: ReadableStream<Uint8Array>,
  ws: ServerWebSocket<WSData>
) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) ws.send(JSON.stringify({ type: "data", data: decoder.decode(value) }));
    }
  } catch {
    /* stream closed */
  }
}

console.log("[+] terminal module ready (mounted in wafmgmt-app)");
