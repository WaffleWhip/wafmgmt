<script lang="ts">
  import { authState, updateUserState } from "$lib/auth.svelte";
  import { X, Upload, Check, AlertCircle } from "lucide-svelte";

  let { onClose }: { onClose: () => void } = $props();

  const isAdmin = $derived(authState.user.role === "admin");

  let name = $state(authState.user.name || "");
  let password = $state("");
  let confirmPassword = $state("");
  let avatar = $state(authState.user.avatar || "");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state(false);

  function handleFileChange(e: Event) {
    if (isAdmin) return;
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
      error = "Image size must be at most 2MB";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      avatar = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    if (isAdmin) return;
    if (password && password !== confirmPassword) {
      error = "Password confirmation does not match";
      return;
    }

    saving = true;
    error = null;
    success = false;

    try {
      const payload: any = {
        name: name.trim(),
        avatar,
        onboarded: 1
      };
      if (password.trim()) {
        payload.password = password.trim();
      }

      const res = await fetch(`/api/users/${encodeURIComponent(authState.user.id || authState.user.username)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update profile");
      }

      updateUserState({
        name: name.trim(),
        avatar,
        onboarded: 1
      });

      success = true;
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      error = err?.message || "An error occurred while saving the profile";
    } finally {
      saving = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
  <div class="w-full max-w-sm bg-white border border-cream-300 rounded-lg">
    <div class="px-5 py-3 border-b border-cream-300 flex items-center justify-between">
      <h3 class="text-large font-bold text-black">Profile</h3>
      <button onclick={onClose} class="btn-icon">
        <X class="w-4 h-4" />
      </button>
    </div>

    {#if error}
      <div class="mx-5 mt-4 p-2.5 bg-red-50 border border-red-200 rounded text-std text-red-700 flex items-center gap-1.5">
        <AlertCircle class="w-3.5 h-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    {/if}

    {#if success}
      <div class="mx-5 mt-4 p-2.5 bg-emerald-50 border border-emerald-200 rounded text-std text-emerald-700 flex items-center gap-1.5">
        <Check class="w-3.5 h-3.5 shrink-0" />
        <span>Profile updated</span>
      </div>
    {/if}

    <form onsubmit={handleSave} class="p-5 space-y-3.5 text-std">
      <!-- Avatar section -->
      <div class="flex items-center gap-3">
        <div class="relative w-12 h-12 rounded-full bg-cream-200 text-stone-600 flex items-center justify-center border border-cream-300 overflow-hidden shrink-0">
          {#if avatar}
            <img src={avatar} alt="Avatar" class="w-full h-full object-cover" />
          {:else}
            <span class="text-large font-bold text-stone-500">
              {(name || authState.user.username || 'U').charAt(0)}
            </span>
          {/if}
        </div>

        {#if !isAdmin}
          <div>
            <label class="h-7 px-2.5 rounded border border-cream-300 bg-white hover:bg-cream-100 text-stone-700 text-std font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors">
              <Upload class="w-3 h-3" />
              <span>Upload</span>
              <input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
            </label>
          </div>
        {:else}
          <div class="text-std text-stone-700 font-semibold">
            Administrator
          </div>
        {/if}
      </div>

      <!-- Username (Readonly) -->
      <div>
        <label for="profile-username" class="block font-semibold text-stone-700 mb-1">Username</label>
        <input
          id="profile-username"
          value={authState.user.username}
          disabled
          class="w-full h-8 px-2.5 bg-cream-100 border border-cream-200 rounded text-std font-mono text-stone-500 cursor-not-allowed"
        />
      </div>

      <!-- Display Name -->
      <div>
        <label for="profile-name" class="block font-semibold text-stone-700 mb-1">Display Name</label>
        <input
          id="profile-name"
          bind:value={name}
          disabled={isAdmin}
          placeholder="Display name"
          class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std outline-none focus:border-stone-800 disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      <!-- New Password -->
      {#if !isAdmin}
        <div>
          <label for="profile-password" class="block font-semibold text-stone-700 mb-1">New Password</label>
          <input
            id="profile-password"
            type="password"
            bind:value={password}
            placeholder="Leave blank to keep unchanged"
            class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800"
          />
        </div>

        {#if password}
          <div>
            <label for="profile-password-confirm" class="block font-semibold text-stone-700 mb-1">Confirm Password</label>
            <input
              id="profile-password-confirm"
              type="password"
              bind:value={confirmPassword}
              placeholder="Repeat password"
              class="w-full h-8 px-2.5 bg-cream-50 border border-cream-300 rounded text-std font-mono outline-none focus:border-stone-800"
            />
          </div>
        {/if}
      {/if}

      <div class="pt-3 flex justify-end gap-2 border-t border-cream-200">
        <button
          type="button"
          onclick={onClose}
          class="px-3 py-1.5 text-std text-stone-600 hover:text-black cursor-pointer rounded"
        >
          {isAdmin ? 'Close' : 'Cancel'}
        </button>
        {#if !isAdmin}
          <button
            type="submit"
            disabled={saving}
            class="px-3.5 py-1.5 text-std bg-black hover:bg-stone-800 text-white font-semibold rounded cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        {/if}
      </div>
    </form>
  </div>
</div>