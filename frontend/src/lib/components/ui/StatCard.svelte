<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
    suffix?: string;
    icon?: any;
  }

  let { label, value, suffix = "", icon: Icon = null }: Props = $props();
</script>

<div class="stat-card">
  <div class="min-w-0 flex-1">
    <div class="flex items-center justify-between stat-card-label mb-1">
      <span>{label}</span>
      {#if Icon}<Icon class="w-3.5 h-3.5 text-black" />{/if}
    </div>
    <div class="text-2xl font-bold text-black font-mono">
      {value}{#if suffix}<span class="text-large font-normal text-stone-500"> {suffix}</span>{/if}
    </div>
  </div>
</div>
