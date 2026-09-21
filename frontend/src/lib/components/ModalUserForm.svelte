<script lang="ts">
  import { X } from "lucide-svelte";

  let {
    onClose,
    onSaved,
    edit = null
  }: {
    onClose: () => void;
    onSaved: () => void;
    edit?: any;
  } = $props();

  let username = $state(edit?.username || "");
  let role = $state<"admin" | "user">(edit?.role || "user");

  // Available pages that can be checked for user role
  const availablePages = [
    { path: "/terminal", label: "Terminal" },
    { path: "/wireguard", label: "WireGuard" },
    { path: "/nginx", label: "Nginx" },
    { path: "/users", label: "Users" },
    { path: "/settings", label: "Settings" }
  ];

  let selectedPermissions = $state<string[]>([]);

  $effect(() => {
    if (edit) {
      if (Array.isArray(edit.permissions)) {
        selectedPermissions = [...edit.permissions];
      } else if (typeof edit.permissions === "string") {
        try {
          selectedPermissions = JSON.parse(edit.permissions);
        } catch {
          selectedPermissions = [];
        }
      }
    }
  });

  let saving = $state(false);
  let error = $state<string | null>(null);

  function togglePermission(path: string) {
    if (selectedPermissions.includes(path)) {
      selectedPermissions = selectedPermissions.filter(p => p !== path);
    } else {
      selectedPermissions = [...selectedPermissions, path];
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!username.trim()) return;

    saving = true;
    error = null;

    try {
      const url = edit ? `/api/users/${encodeURIComponent(edit.id)}` : "/api/users";
      const payload: any = {
        username: username.trim(),
        role,
        permissions: role === "admin" ? availablePages.map(p => p.path) : selectedPermissions
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save user (${res.status})`);
      }

      onSaved();
      onClose();
    } catch (e: any) {
      error = e?.message || "Failed to save user";
    } finally {
      saving = false;
    }
  }
</script>

<div class="modal-overlay" onclick={onClose}>
  <div class="modal-card max-w-md w-full" onclick={(e) => e.stopPropagation()}>
    <div class="px-5 py-3 border-b border-cream-200 flex items-center justify-between">
      <h3 class="text-std font-normal text-black">{edit ? "Edit User" : "Add User"}</h3>
      <button onclick={onClose} class="btn-icon">
        <X class="w-4 h-4" />
      </button>
    </div>

    {#if error}
      <div class="mx-5 mt-4 p-2.5 bg-red-50 border border-red-200 rounded text-std text-red-700">
        {error}
      </div>
    {/if}

    <form onsubmit={handleSubmit} class="p-5 space-y-4 text-std">
      <div>
        <label for="user-username" class="block font-semibold text-stone-700 mb-1">Username *</label>
        <input
          id="user-username"
          bind:value={username}
          placeholder="e.g. jdoe"
          required
          disabled={!!edit}
          class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800 disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      <div>
        <span class="block font-semibold text-stone-700 mb-1.5">Role *</span>
        <div class="grid grid-cols-2 gap-2">
          <label class="border p-2.5 rounded flex items-center gap-2 cursor-pointer transition-colors {role === 'admin' ? 'border-black bg-cream-50 font-bold' : 'border-cream-300 hover:border-cream-400'}">
            <input type="radio" name="role" value="admin" bind:group={role} />
            <span>Admin</span>
          </label>

          <label class="border p-2.5 rounded flex items-center gap-2 cursor-pointer transition-colors {role === 'user' ? 'border-black bg-cream-50 font-bold' : 'border-cream-300 hover:border-cream-400'}">
            <input type="radio" name="role" value="user" bind:group={role} />
            <span>User</span>
          </label>
        </div>
      </div>

      {#if role === "user"}
        <div>
          <span class="block font-semibold text-stone-700 mb-1.5">Page Permissions</span>
          <div class="border border-cream-300 rounded-md p-3 space-y-2 bg-cream-50/50">
            {#each availablePages as page}
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(page.path)}
                  onchange={() => togglePermission(page.path)}
                  class="rounded border-cream-300 text-black focus:ring-0"
                />
                <span class="text-stone-800 font-medium">{page.label}</span>
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <div class="pt-3 flex justify-end gap-2 border-t border-cream-200">
        <button
          type="button"
          onclick={onClose}
          class="px-3 py-1.5 text-std text-stone-600 hover:text-black cursor-pointer rounded"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer disabled:opacity-50"
        >
          {saving ? "Saving…" : edit ? "Save Changes" : "Create Account"}
        </button>
      </div>
    </form>
  </div>
</div>
