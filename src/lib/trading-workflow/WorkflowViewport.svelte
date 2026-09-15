<script lang="ts">
  import { onMount } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  const flow = useSvelteFlow();
  onMount(() => {
    function locate(event: Event) {
      const node = flow.getNode((event as CustomEvent<string>).detail);
      if (node) {
        void flow.setCenter(node.position.x + 150, node.position.y + (node.measured?.height ?? 80) / 2, { zoom: 1, duration: 0 });
        document.querySelector<HTMLButtonElement>(`[data-workflow-node="${node.id}"] .node-surface`)?.focus({ preventScroll: true });
      }
    }
    window.addEventListener('workflow-locate', locate);
    return () => window.removeEventListener('workflow-locate', locate);
  });
</script>
