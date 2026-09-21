<script lang="ts">
  import { createDevice, updateDevice, type Device, type DeviceInput } from "$lib/api/devices";
  import { X, Terminal } from "lucide-svelte";
  import { TERMINAL_ENABLED } from "$lib/registry";

  let { edit, onClose, onSaved } = $props<{
    edit: Device | null;
    onClose: () => void;
    onSaved: () => void;
  }>();

  let name = $state(edit?.name ?? "");
  let ip = $state(edit?.ip ?? "");
  let portStr = $state(edit?.port != null ? String(edit.port) : "");
  let path = $state((edit as any)?.path ?? "");
  let enableSsh = $state(edit?.ssh_port != null);
  let sshPortStr = $state(edit?.ssh_port != null ? String(edit.ssh_port) : "22");
  let icon = $state(edit?.icon ?? "");
  let notes = $state(edit?.notes ?? "");
  let saving = $state(false);
  let error = $state<string | null>(null);

  let query = $state(edit?.icon ? "" : edit?.name ?? "");
  let results = $state<string[]>([]);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let debounceId: ReturnType<typeof setTimeout> | null = null;

  function iconifyUrl(iconId: string): string {
    return `https://api.iconify.design/${iconId}.svg?height=64&width=64`;
  }

  function googleFavicon(domain: string): string {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  }

  function guessDomain(s: string): string {
    const cleaned = s.toLowerCase().replace(/[^a-z0-9.-]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.includes(".") ? cleaned : `${cleaned}.com`;
  }

  async function searchIcons(q: string) {
    if (!q.trim()) { results = []; return; }
    searching = true;
    searchError = null;
    try {
      const params = new URLSearchParams({ query: q.trim(), limit: "32" });
      const r = await fetch(`https://api.iconify.design/search?${params}`);
      if (!r.ok) throw new Error(`iconify ${r.status}`);
      const data = await r.json();
      const all: string[] = data.icons ?? [];
      const brands = all.filter((i) => i.startsWith("logos:") || i.startsWith("simple-icons:"));
      const rest = all.filter((i) => !brands.includes(i));
      results = [...brands, ...rest].slice(0, 24);
    } catch (e: any) {
      searchError = e?.message ?? "search failed";
      results = [];
    } finally {
      searching = false;
    }
  }

  $effect(() => {
    const q = (query || name).trim();
    if (debounceId) clearTimeout(debounceId);
    if (!q) { results = []; return; }
    debounceId = setTimeout(() => searchIcons(q), 300);
  });

  function pick(iconId: string) {
    icon = iconifyUrl(iconId);
  }

  function slugify(s: string): string {
    const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words[0] ?? "";
  }

  interface LogoOption { label: string; kind: string; url: string }
  function logoOptions(q: string): LogoOption[] {
    const slug = slugify(q);
    if (!slug) return [];
    const domain = guessDomain(q);
    return [
      { label: "SimpleIcons", kind: "SVG", url: `https://cdn.simpleicons.org/${slug}` },
      { label: "selfh.st", kind: "SVG", url: `https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/${slug}.svg` },
      { label: "Homarr", kind: "SVG", url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slug}.svg` },
      { label: "Homarr", kind: "PNG", url: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png` },
      { label: "Google", kind: "PNG", url: googleFavicon(domain) },
    ];
  }

  const providerLogos = $derived(logoOptions(query || name));

  function pickGoogle() {
    const d = guessDomain(name || ip);
    if (!d) return;
    icon = googleFavicon(d);
  }

  function blankToNull(v: string): string | null {
    const t = v.trim();
    return t ? t : null;
  }

  function normalizePath(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    return t.startsWith("/") ? t : "/" + t;
  }

  function blankToPort(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }

  function previewUrl(): string {
    const host = ip.trim() || "192.168.1.10";
    if (/^https?:\/\//i.test(host)) return host;
    const p = portStr.trim();
    const scheme = p === "443" ? "https" : "http";
    const base = p ? `${scheme}://${host}:${p}` : `${scheme}://${host}`;
    const suffix = normalizePath(path) ?? "";
    return base + suffix;
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!name.trim()) {
      error = "Name required";
      return;
    }
    saving = true;
    error = null;
    const input: DeviceInput = {
      name: name.trim(),
      ip: blankToNull(ip),
      port: blankToPort(portStr),
      path: normalizePath(path),
      ssh_port: enableSsh ? (blankToPort(sshPortStr) ?? 22) : null,
      icon: blankToNull(icon),
      notes: blankToNull(notes)
    };
    try {
      if (edit) await updateDevice(edit.id, input);
      else await createDevice(input);
      onSaved();
    } catch (e: any) {
      error = e?.message ?? "Save failed";
    } finally {
      saving = false;
    }
  }

  function onImgError(e: Event) {
    (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-md bg-white border border-cream-300 rounded-lg max-h-[90vh] overflow-y-auto">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between sticky top-0 bg-white z-10">
      <h3 class="text-large font-bold text-black">{edit ? 'Edit Device' : 'Add Device & Service'}</h3>
      <button type="button" onclick={onClose} class="btn-icon" aria-label="Close">
        <X class="w-4 h-4" />
      </button>
    </div>

    <form onsubmit={save} class="p-5 space-y-3.5 text-std">
      {#if error}
        <div class="p-2.5 bg-red-50 border border-red-200 rounded text-std text-red-700">
          {error}
        </div>
      {/if}

      <div>
        <label for="d-name" class="block font-semibold text-stone-700 mb-1">Device Name *</label>
        <input id="d-name" type="text" bind:value={name} placeholder="e.g. MySQL" required class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std outline-none focus:border-stone-800" />
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label for="d-ip" class="block font-semibold text-stone-700 mb-1">IP / Host</label>
          <input id="d-ip" type="text" bind:value={ip} placeholder="192.168.41.115" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
        <div>
          <label for="d-port" class="block font-semibold text-stone-700 mb-1">Port</label>
          <input id="d-port" type="number" min="1" max="65535" bind:value={portStr} placeholder="80" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        </div>
      </div>

      <div>
        <label for="d-path" class="block font-semibold text-stone-700 mb-1">Path (optional)</label>
        <input id="d-path" type="text" bind:value={path} placeholder="/myadmin" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800" />
        <p class="mt-1 text-small font-mono text-stone-500 truncate">{previewUrl()}</p>
      </div>

      <!-- SSH Terminal Support -->
      {#if TERMINAL_ENABLED}
      <div class="p-3 rounded-lg border border-cream-200 bg-cream-50/50 space-y-2.5">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            bind:checked={enableSsh}
            class="w-4 h-4 rounded border-cream-300 text-black focus:ring-0 cursor-pointer"
          />
          <span class="text-std font-semibold text-black inline-flex items-center gap-1.5">
            <Terminal class="w-3.5 h-3.5 text-stone-600" />
            <span>Enable SSH Terminal Access</span>
          </span>
        </label>

        {#if enableSsh}
          <div class="pl-6 pt-1 flex items-center gap-3">
            <div class="w-28">
              <label for="d-ssh-port" class="block text-small font-mono text-stone-500 mb-1">SSH Port</label>
              <input
                id="d-ssh-port"
                type="number"
                min="1"
                max="65535"
                bind:value={sshPortStr}
                placeholder="22"
                class="w-full h-7 px-2 bg-white border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800"
              />
            </div>
            <p class="text-small text-stone-400 mt-4 leading-tight">
              Allows opening direct web SSH session to {ip || 'device IP'}:{sshPortStr || 22}
            </p>
          </div>
        {/if}
      </div>
      {/if}

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="d-icon-q" class="block font-semibold text-stone-700 mb-0">Logo — type to search</label>
          <span class="text-small text-stone-400 font-mono">
            {searching ? 'searching…' : `${results.length} iconify`}
          </span>
        </div>
        <input id="d-icon-q" type="text" bind:value={query} placeholder="e.g. proxmox, mysql…" class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std outline-none focus:border-stone-800" />

        {#if providerLogos.length > 0}
          <div class="grid grid-cols-5 gap-1.5">
            {#each providerLogos as opt (opt.url)}
              <button type="button" onclick={() => { icon = opt.url; }}
                class="rounded border bg-white px-1 py-1.5 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer
                  {icon === opt.url ? 'border-black ring-2 ring-black/20' : 'border-cream-200 hover:border-black'}"
                title="{opt.label} {opt.kind} — {opt.url}"
              >
                <img src={opt.url} alt={opt.label} class="w-6 h-6 object-contain" loading="lazy" onerror={onImgError} />
                <span class="text-small font-mono text-stone-500 leading-none">{opt.label}</span>
                <span class="text-small font-mono text-stone-400 leading-none">{opt.kind}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if searchError}
          <div class="text-small text-red-600 font-mono">iconify: {searchError}</div>
        {/if}

        <div class="border border-cream-200 rounded-md p-2 bg-cream-50/40 max-h-32 overflow-y-auto">
          {#if results.length === 0 && !searching}
            <p class="text-small text-stone-400 text-center py-2 italic">
              {query ? 'no iconify results' : 'type to search iconify'}
            </p>
          {:else}
            <div class="grid grid-cols-8 gap-1.5">
              {#each results as iconId (iconId)}
                {@const url = iconifyUrl(iconId)}
                {@const provider = iconId.split(":")[0]}
                <button type="button" onclick={() => pick(iconId)}
                  class="aspect-square rounded border bg-white flex flex-col items-center justify-center transition-all cursor-pointer p-0.5
                    {icon === url ? 'border-black ring-2 ring-black/20' : 'border-cream-200 hover:border-black'}"
                  title={iconId}
                >
                  <img src={url} alt={iconId} class="w-5 h-5 object-contain" loading="lazy" onerror={onImgError} />
                  <span class="text-small font-mono text-stone-400 leading-none truncate max-w-full">{provider}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <input type="text" bind:value={icon} placeholder="or paste custom URL" class="w-full h-7 px-2 bg-cream-50 border border-cream-300 rounded text-small font-mono outline-none focus:border-stone-800" />
        </div>

        {#if icon}
          <div class="mt-1 flex items-center gap-2 px-2 py-1.5 rounded border border-cream-200 bg-white">
            <img src={icon} alt="preview" class="w-6 h-6 object-contain" onerror={onImgError} />
            <span class="text-small font-mono text-stone-500 truncate flex-1">{icon}</span>
          </div>
        {/if}
      </div>

      <div>
        <label for="d-notes" class="block font-semibold text-stone-700 mb-1">Notes</label>
        <textarea id="d-notes" bind:value={notes} rows="2" placeholder="Optional" class="w-full p-2 bg-cream-50 border border-cream-300 rounded text-std outline-none focus:border-stone-800 resize-none"></textarea>
      </div>

      <div class="pt-3 flex justify-end gap-2 border-t border-cream-200">
        <button type="button" onclick={onClose} class="px-3 py-1.5 text-std text-stone-600 hover:text-black cursor-pointer rounded">Cancel</button>
        <button type="submit" disabled={saving} class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer disabled:opacity-50">
          {saving ? 'Saving...' : edit ? 'Save Changes' : 'Add Device'}
        </button>
      </div>
    </form>
  </div>
</div>
