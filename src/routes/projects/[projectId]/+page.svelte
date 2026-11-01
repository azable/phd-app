<script lang="ts">
  import { page } from '$app/state';

  import ProjectWorkspace from '$lib/client/projects/ProjectWorkspace.svelte';

  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const at = $derived.by(() => {
    const value = page.url.searchParams.get('at');
    if (value === null) return undefined;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  });
  const devMode = $derived.by(() => {
    if (!data.isAdmin || data.study?.context === 'admin-preview') return false;
    const value = page.url.searchParams.get('dev');
    if (value === '1') return true;
    if (value === '0') return false;
    return page.url.searchParams.get('inspect') === '1';
  });
</script>

{#key `${page.params.projectId}-${devMode}-${data.study?.deadlineAt ?? ''}`}
  <ProjectWorkspace
    projectId={page.params.projectId!}
    templates={data.templates}
    authEnabled={data.authEnabled}
    isAdmin={data.isAdmin}
    readOnly={data.readOnly}
    {at}
    {devMode}
    configuredChooser={data.chooser}
    study={data.study}
    trial={data.trial}
  />
{/key}
