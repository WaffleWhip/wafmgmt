<script lang="ts">
  import { appState } from "$lib/store.svelte";
  import { Save, Check, Upload, X, ImageIcon } from "lucide-svelte";
  import PageHeader from "$lib/components/ui/PageHeader.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import FormField from "$lib/components/ui/FormField.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let brandName = $state(appState.config.brandName || "");
  let brandSubtitle = $state(appState.config.brandSubtitle || "");
  let landingBgUrl = $state(appState.config.landingBgUrl || "");
  let landingDesc = $state(appState.config.landingDesc || "");
  let saving = $state(false);
  let saved = $state(false);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let logoPreview = $state<string | null>(null);

  async function saveSettings(e: Event) {
    e.preventDefault();
    saving = true;
    saved = false;
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandName, brandSubtitle, landingBgUrl, landingDesc })
    });
    saving = false;
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  async function uploadLogo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    uploading = true;
    uploadError = null;
    logoPreview = URL.createObjectURL(file);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/config/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) {
        uploadError = data.error ?? "Upload failed";
        logoPreview = null;
      }
    } catch (e: any) {
      uploadError = e?.message ?? "Upload failed";
      logoPreview = null;
    } finally {
      uploading = false;
    }
  }

  async function clearLogo() {
    uploading = true;
    uploadError = null;
    try {
      await fetch("/api/config/logo", { method: "DELETE" });
      logoPreview = null;
    } finally {
      uploading = false;
    }
  }
</script>

<div class="max-w-2xl space-y-4">
  <PageHeader title="Settings" />

  <form onsubmit={saveSettings} class="space-y-4">
    <Card title="Brand">
      <div class="space-y-4">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-md bg-cream-100 border border-cream-300 flex items-center justify-center overflow-hidden shrink-0">
            {#if logoPreview}
              <img src={logoPreview} alt="Logo preview" class="w-full h-full object-contain" />
            {:else if appState.config.logoUrl}
              <img src={appState.config.logoUrl} alt="Logo" class="w-full h-full object-contain" />
            {:else}
              <ImageIcon class="w-6 h-6 text-stone-400" />
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <label class="btn btn-secondary cursor-pointer">
              <Upload class="w-3.5 h-3.5" />
              <span>Upload</span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" class="hidden" onchange={uploadLogo} disabled={uploading} />
            </label>
            {#if appState.config.logoUrl}
              <button type="button" onclick={clearLogo} disabled={uploading} class="btn btn-secondary">
                <X class="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            {/if}
          </div>
        </div>
        {#if uploadError}
          <p class="text-small text-accent-600">{uploadError}</p>
        {/if}

        <FormField label="Brand Name" id="set-brand">
          <Input id="set-brand" bind:value={brandName} placeholder="[brand]" class="input-bold" />
        </FormField>

        <FormField label="Subtitle" id="set-sub">
          <Input id="set-sub" bind:value={brandSubtitle} placeholder="[subheader]" />
        </FormField>
      </div>
    </Card>

    <Card title="Landing Page">
      <div class="space-y-4">
        <FormField label="Background URL" id="set-landing-bg">
          <Input id="set-landing-bg" bind:value={landingBgUrl} placeholder="https://… or /logo/bg.jpg" class="font-mono" />
        </FormField>

        <FormField label="Description" id="set-landing-desc">
          <textarea id="set-landing-desc" bind:value={landingDesc} rows="3" placeholder="Short public portal description" class="input"></textarea>
        </FormField>
      </div>
    </Card>

    <div class="flex items-center justify-end gap-3">
      {#if saved}
        <span class="flex items-center gap-1 text-std font-bold text-black">
          <Check class="w-3.5 h-3.5" />
          Saved
        </span>
      {/if}
      <Button type="submit" loading={saving}>
        <Save class="w-3.5 h-3.5" />
        <span>Save</span>
      </Button>
    </div>
  </form>
</div>
