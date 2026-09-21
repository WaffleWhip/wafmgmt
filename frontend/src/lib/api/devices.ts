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

export type DeviceInput = Omit<Device, "id" | "created_at" | "updated_at">;
export type DevicePatch = Partial<DeviceInput>;

const BASE = "/api/devices";

export async function listDevices(): Promise<Device[]> {
  const r = await fetch(BASE);
  if (!r.ok) throw new Error(`listDevices failed: ${r.status}`);
  return r.json();
}

export async function createDevice(input: DeviceInput): Promise<Device> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw new Error(`createDevice failed: ${r.status}`);
  return r.json();
}

export async function updateDevice(id: string, patch: DevicePatch): Promise<Device> {
  const r = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!r.ok) throw new Error(`updateDevice failed: ${r.status}`);
  return r.json();
}

export async function deleteDevice(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`deleteDevice failed: ${r.status}`);
}
