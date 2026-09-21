import { coreFetch } from "../modules/core/api";
import { terminalFetch, terminalWebSocket } from "../modules/terminal/api";
import { uspFetch } from "../modules/usp/api";

const PORT = Number(process.env.PORT || 3000);

console.log(`[+] wafmgmt-app starting (single process) on port ${PORT}...`);

Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ssh") {
      return terminalFetch(req, server);
    }

    if (path === "/health") {
      return uspFetch(req);
    }

    // Telemetry endpoints live in the core module (historically split that way);
    // every other /api/usp/* route belongs to the USP module.
    if (path.startsWith("/api/usp/telemetry")) {
      return coreFetch(req, server);
    }
    if (path.startsWith("/api/usp")) {
      return uspFetch(req);
    }

    return coreFetch(req, server);
  },
  websocket: terminalWebSocket,
});

console.log(`[+] wafmgmt-app ready: http://0.0.0.0:${PORT}`);
