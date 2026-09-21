<script lang="ts">
  import { onMount } from "svelte";
  import { Plus, Trash2, Pencil, Users, Search, RefreshCw } from "lucide-svelte";
  import ModalUserForm from "$lib/components/ModalUserForm.svelte";
  import { authState } from "$lib/auth.svelte";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  interface UserItem {
    id: string;
    username: string;
    name: string;
    role: "admin" | "user";
    created_at: string;
    updated_at: string;
  }

  let users = $state<UserItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state("");
  let showModal = $state(false);
  let editingUser = $state<UserItem | null>(null);

  async function loadUsers() {
    loading = true;
    error = null;
    try {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      users = await res.json();
    } catch (e: any) {
      error = e?.message || "Failed to load users";
    } finally {
      loading = false;
    }
  }

  async function deleteUser(u: UserItem) {
    if (u.username === authState.user.username) {
      alert("You cannot delete your own account while logged in.");
      return;
    }
    if (!confirm(`Delete user account "${u.username}"?`)) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete user");
      loadUsers();
    } catch (e: any) {
      alert(e?.message || "Error deleting user");
    }
  }

  const filtered = $derived(
    users.filter(u =>
      `${u.username} ${u.name} ${u.role}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  onMount(loadUsers);
</script>

<div class="space-y-4">
  <PageHeader title="Users" count={users.length}>
    {#snippet actions()}
      <div class="w-[200px]">
        <Input bind:value={search} placeholder="Filter accounts…" icon={Search} />
      </div>
      <button type="button" onclick={loadUsers} title="Refresh" class="btn-icon">
        <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
      </button>
      <Button variant="primary" onclick={() => { editingUser = null; showModal = true; }}>
        <Plus class="w-3.5 h-3.5" />
        <span>Add User</span>
      </Button>
    {/snippet}
  </PageHeader>

  {#if error}
    <div class="surface p-3 text-std text-accent-600">{error}</div>
  {/if}

  <div class="surface overflow-hidden">
    <table class="data-table">
      <thead>
        <tr>
          <th class="w-10">#</th>
          <th>User</th>
          <th>Username</th>
          <th>Role</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="6" class="py-8 text-center text-stone-400">Loading…</td></tr>
        {:else if filtered.length === 0}
          <tr>
            <td colspan="6">
              <EmptyState icon={Users} title="No user accounts" description="Add a user to grant access." />
            </td>
          </tr>
        {:else}
          {#each filtered as u, idx}
            <tr>
              <td class="text-stone-400 font-mono">{idx + 1}</td>
              <td>
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-full bg-cream-200 text-stone-700 font-bold flex items-center justify-center overflow-hidden shrink-0">
                    {#if (u as any).avatar}
                      <img src={(u as any).avatar} alt={u.name} class="w-full h-full object-cover" />
                    {:else}
                      {(u.name || u.username).charAt(0).toUpperCase()}
                    {/if}
                  </div>
                  <span class="font-bold text-black">{u.name}</span>
                  {#if u.username === authState.user.username}
                    <span class="text-small text-stone-400">(you)</span>
                  {/if}
                </div>
              </td>
              <td class="font-mono text-stone-700">@{u.username}</td>
              <td>
                <Badge variant={u.role === "admin" ? "dark" : "muted"}>{u.role}</Badge>
              </td>
              <td class="text-stone-500">{new Date(u.created_at).toLocaleDateString()}</td>
              <td class="text-right">
                <div class="inline-flex items-center gap-1">
                  <button type="button" onclick={() => { editingUser = u; showModal = true; }} class="btn-icon" title="Edit user">
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  {#if u.username !== authState.user.username}
                    <button type="button" onclick={() => deleteUser(u)} class="btn-icon hover:text-red-600" title="Delete user">
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

{#if showModal}
  <ModalUserForm
    edit={editingUser}
    onClose={() => { showModal = false; editingUser = null; }}
    onSaved={() => { showModal = false; editingUser = null; loadUsers(); }}
  />
{/if}
