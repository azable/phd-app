<script lang="ts">
  import { onMount } from 'svelte';

  import { invalidateAll } from '$app/navigation';
  import ProjectWorkspace from '$lib/client/projects/ProjectWorkspace.svelte';

  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Examples dropped into .demo/inbox are saved as the page asks; a flush brings a new project.
  onMount(() => {
    const timer = setInterval(async () => {
      const response = await fetch('/dev/demo/state').catch(() => undefined);
      if (!response?.ok) return;
      const { projectId } = (await response.json()) as { projectId: string };
      if (projectId !== data.projectId) await invalidateAll();
    }, 2_000);
    return () => clearInterval(timer);
  });
</script>

{#key data.projectId}
  <ProjectWorkspace
    projectId={data.projectId}
    templates={data.templates}
    authEnabled={true}
    isAdmin={true}
    readOnly={false}
  />
{/key}
