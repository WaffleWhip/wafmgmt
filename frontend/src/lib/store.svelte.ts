import type { AppEntry } from "$lib/registry";

export interface GlobalState {
  config: {
    brandName?: string;
    brandSubtitle?: string;
    logoUrl?: string;
    endpointWan?: string;
    dnsDefault?: string;
    interface?: string;
    address?: string;
  };
  peers: any[];
  totalRx: string;
  totalTx: string;
  serverPubkey: string;
  endpointWan: string;
  services: any[];
  routes: any[];
  nginxRoutes: any[];
  devices: any[];
  topology: any[];
  cluster: any[];
  sseConnected: boolean;
  apps: AppEntry[];
}

export const appState = $state<GlobalState>({
  config: {
    brandName: "[brand]",
    brandSubtitle: "[subheader]",
    logoUrl: ""
  },
  peers: [],
  totalRx: "0 B",
  totalTx: "0 B",
  serverPubkey: "",
  endpointWan: "[endpoint:port]",
  services: [],
  routes: [],
  nginxRoutes: [],
  devices: [],
  topology: [],
  cluster: [],
  sseConnected: false,
  apps: []
});

import { fetchRegistry as _fetchRegistry, addApp as _addApp, removeApp as _removeApp } from "$lib/registry";

export async function loadRegistry() {
  appState.apps = await _fetchRegistry();
}

export async function registerApp(entry: Omit<AppEntry, "id">) {
  const created = await _addApp(entry);
  appState.apps = [...appState.apps, created];
  return created;
}

export async function unregisterApp(id: string) {
  await _removeApp(id);
  appState.apps = appState.apps.filter((a) => a.id !== id);
}

let evtSource: EventSource | null = null;

export function initSSE() {
  if (evtSource) return;
  evtSource = new EventSource("/api/stream");

  evtSource.onopen = () => {
    appState.sseConnected = true;
  };

  evtSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "full_sync") {
        Object.assign(appState, msg.data);
        appState.sseConnected = true;
      } else if (msg.type === "metrics") {
        appState.peers = msg.data.peers || [];
        appState.totalRx = msg.data.totalRx || appState.totalRx;
        appState.totalTx = msg.data.totalTx || appState.totalTx;
      } else if (msg.type === "peers") {
        appState.peers = msg.data;
      } else if (msg.type === "config") {
        appState.config = msg.data;
      } else if (msg.type === "services") {
        appState.services = msg.data;
      } else if (msg.type === "routes") {
        appState.routes = msg.data;
      } else if (msg.type === "nginx") {
        appState.nginxRoutes = msg.data;
      } else if (msg.type === "devices") {
        appState.devices = msg.data;
      }
    } catch {}
  };

  evtSource.onerror = () => {
    appState.sseConnected = false;
  };
}
