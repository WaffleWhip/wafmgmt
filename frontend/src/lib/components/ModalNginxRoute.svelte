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

  let domain = $state(edit?.domain || "");
  let upstream = $state(edit?.upstream || "");
  let desc = $state(edit?.desc || "");
  let tlsInternal = $state(edit?.tlsInternal ?? false);
  let skipTlsVerify = $state(edit?.skipTlsVerify ?? true);
  let enabled = $state(edit?.enabled ?? true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!domain.trim() || !upstream.trim()) return;

    saving = true;
    error = null;

    try {
      const res = await fetch("/api/nginx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edit?.id,
          domain: domain.trim(),
          upstream: upstream.trim(),
          desc: desc.trim(),
          tlsInternal,
          skipTlsVerify,
          enabled
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to save route (${res.status})`);
      }

      onSaved();
      onClose();
    } catch (e: any) {
      error = e?.message || "Failed to save route";
    } finally {
      saving = false;
    }
  }
  import Modal from "./ui/Modal.svelte";
  import FormField from "./ui/FormField.svelte";
  import Input from "./ui/Input.svelte";
  import Button from "./ui/Button.svelte";
</script>

<Modal
  title={edit ? "Edit Proxy Route" : "New Proxy Route"}
  {onClose}
>
  {#if error}
    <div class="p-2.5 bg-red-50 border border-red-200 rounded text-std text-red-700 font-medium">
      {error}
    </div>
  {/if}

  <form id="nginx-route-form" onsubmit={handleSubmit} class="space-y-3.5 text-std">
    <FormField label="Domain Name" id="nginx-domain" required>
      <Input
        id="nginx-domain"
        bind:value={domain}
        placeholder="e.g. app.local or router.ban.net"
        required
        class="font-mono"
      />
    </FormField>

    <FormField label="Upstream Destination" id="nginx-upstream" required>
      <Input
        id="nginx-upstream"
        bind:value={upstream}
        placeholder="e.g. 192.168.1.50:8080 or http://localhost:3000"
        required
        class="font-mono"
      />
    </FormField>

    <FormField label="Description" id="nginx-desc">
      <Input
        id="nginx-desc"
        bind:value={desc}
        placeholder="e.g. Internal dashboard proxy"
      />
    </FormField>

    <div class="pt-2 space-y-2 border-t border-cream-200">
      <label class="flex items-center gap-2 cursor-pointer pt-1">
        <input type="checkbox" bind:checked={tlsInternal} class="rounded border-stone-300" />
        <span class="text-stone-700">Use Internal Self-Signed TLS (listen 443 ssl)</span>
      </label>

      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={skipTlsVerify} class="rounded border-stone-300" />
        <span class="text-stone-700">Skip Upstream TLS Verification</span>
      </label>

      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={enabled} class="rounded border-stone-300" />
        <span class="text-stone-700 font-semibold">Enable Route</span>
      </label>
    </div>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={onClose}>Cancel</Button>
    <Button type="submit" form="nginx-route-form" loading={saving}>
      {saving ? "Saving…" : edit ? "Save Changes" : "Create Route"}
    </Button>
  {/snippet}
</Modal>
