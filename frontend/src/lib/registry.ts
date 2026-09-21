export type AppGroup = 'core' | 'app' | 'system';

// Feature flag: hide the Terminal feature from the UI. Code is kept intact so it
// can be re-enabled by flipping this back to `true`.
export const TERMINAL_ENABLED = false;

export interface AppEntry {
  id: string;
  label: string;
  icon: string;
  path: string;
  group: AppGroup;
  hidden?: boolean;
  color?: string;
  description?: string;
}

const DEFAULT_APPS: AppEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutGrid', path: '/dashboard', group: 'core' },
  { id: 'usp',       label: 'USP',       icon: 'Radio',      path: '/usp',       group: 'core',   description: 'USP / TR-369 Controller' },
  { id: 'terminal',  label: 'Terminal',  icon: 'Terminal',   path: '/terminal',  group: 'core', hidden: !TERMINAL_ENABLED },
  { id: 'wireguard', label: 'WireGuard', icon: 'Shield',     path: '/wireguard', group: 'system' },
  { id: 'nginx',     label: 'Nginx',     icon: 'Globe',      path: '/nginx',     group: 'system', description: 'Nginx reverse proxy routes' },
  { id: 'users',     label: 'Users',     icon: 'Users',      path: '/users',     group: 'system', description: 'User accounts and access roles' },
  { id: 'database',  label: 'Database',  icon: 'Database',   path: '/database',  group: 'system', hidden: true, description: 'Storage & Configuration Files' },
  { id: 'settings',  label: 'Settings',  icon: 'Settings',   path: '/settings',  group: 'system' }
];

const STORAGE_KEY = "wafmgmt:custom_apps";

export async function fetchRegistry(): Promise<AppEntry[]> {
  let list = [...DEFAULT_APPS];
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const custom: AppEntry[] = JSON.parse(stored);
        list = [...list, ...custom];
      }
    } catch {}
  }
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  return list.filter((item) => {
    if (seenIds.has(item.id) || seenPaths.has(item.path)) return false;
    seenIds.add(item.id);
    seenPaths.add(item.path);
    return true;
  });
}

export async function addApp(entry: Omit<AppEntry, 'id'>): Promise<AppEntry> {
  const created: AppEntry = { ...entry, id: crypto.randomUUID() };
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const custom: AppEntry[] = stored ? JSON.parse(stored) : [];
      custom.push(created);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch {}
  }
  return created;
}

export async function removeApp(id: string): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        let custom: AppEntry[] = JSON.parse(stored);
        custom = custom.filter((a) => a.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
      }
    } catch {}
  }
}
