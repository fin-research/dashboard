<script lang="ts">
  import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
  import type { FlowEdge } from './graph';
  import { workflowEdgePath } from './edge-path';
  let { id, sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps<FlowEdge> = $props();
  const path = $derived(workflowEdgePath(sourceX, sourceY, targetX, targetY, data?.joinY ?? (sourceY + targetY) / 2));
</script>

<BaseEdge {id} {path} {markerEnd} {style} />
