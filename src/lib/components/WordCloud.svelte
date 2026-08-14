<script lang="ts">
  import cloud from "d3-cloud";
  import { onDestroy, onMount } from "svelte";

  import type { Hotspot } from "$lib/hotspots";

  interface CloudWord extends Hotspot {
    text: string;
    size: number;
    x?: number;
    y?: number;
    rotate?: number;
  }

  export let items: Hotspot[] = [];
  export let selectedKeyword = "";
  export let onSelect: (hotspot: Hotspot) => void;

  let host: HTMLDivElement;
  let observer: ResizeObserver | null = null;
  let layout: ReturnType<typeof cloud<CloudWord>> | null = null;
  let placedWords: CloudWord[] = [];
  let width = 1;
  let height = 1;
  let mounted = false;
  let lastSignature = "";
  let frame: number | null = null;

  const colors = ["#f6c96b", "#77bdfb", "#8ad9ca", "#c7b6ff", "#f2a49d"];

  onMount(() => {
    mounted = true;
    observer = new ResizeObserver(() => scheduleLayout());
    observer.observe(host);
    scheduleLayout();
  });

  onDestroy(() => {
    observer?.disconnect();
    layout?.stop();
    if (frame !== null) cancelAnimationFrame(frame);
  });

  $: if (mounted) {
    const signature = items.map((item) => `${item.keyword}:${item.heat}`).join("|");
    if (signature !== lastSignature) {
      lastSignature = signature;
      scheduleLayout();
    }
  }

  function scheduleLayout(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      runLayout();
    });
  }

  function runLayout(): void {
    const bounds = host.getBoundingClientRect();
    width = Math.max(280, Math.floor(bounds.width));
    height = Math.max(260, Math.floor(bounds.height));
    if (items.length === 0) {
      placedWords = [];
      return;
    }
    layout?.stop();
    const minimumHeat = Math.min(...items.map((item) => item.heat));
    const maximumHeat = Math.max(...items.map((item) => item.heat));
    const minimumSize = clamp(Math.min(width, height) / 18, 28, 46);
    const maximumSize = clamp(Math.min(width, height) / 6.2, 66, 132);
    const heatRange = Math.max(1, maximumHeat - minimumHeat);
    const words: CloudWord[] = items.map((item) => {
      const desiredSize =
        minimumSize +
        ((item.heat - minimumHeat) / heatRange) * (maximumSize - minimumSize);
      const widthBoundSize = (width * 0.86) / textWidthUnits(item.keyword);
      return {
        ...item,
        text: item.keyword,
        size: Math.max(20, Math.min(desiredSize, widthBoundSize)),
      };
    });

    layout = cloud<CloudWord>()
      .size([width, height])
      .words(words)
      .padding(() => clamp(width / 120, 5, 13))
      .rotate(0)
      .font('"PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui')
      .fontWeight((word) => (word.heat >= 75 ? 720 : 620))
      .fontSize((word) => word.size)
      .spiral("archimedean")
      .random(seededRandom(`${width}:${height}:${lastSignature}`))
      .on("end", (words) => {
        placedWords = words;
      });
    layout.start();
  }

  function selectWord(word: CloudWord): void {
    onSelect(word);
  }

  function handleKeydown(event: KeyboardEvent, word: CloudWord): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectWord(word);
  }

  function wordColor(index: number, word: CloudWord): string {
    if (word.heat >= 85) return colors[0]!;
    return colors[(index % (colors.length - 1)) + 1]!;
  }

  function seededRandom(seedText: string): () => number {
    let seed = 2_166_136_261;
    for (const character of seedText) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 16_777_619);
    }
    return () => {
      seed = Math.imul(seed, 1_664_525) + 1_013_904_223;
      return (seed >>> 0) / 4_294_967_296;
    };
  }

  function textWidthUnits(value: string): number {
    return [...value].reduce(
      (total, character) => total + (/^[\x00-\x7F]$/.test(character) ? 0.62 : 1),
      0,
    );
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }
</script>

<div bind:this={host} class="cloud-host" aria-label="当日市场热点词云">
  {#if placedWords.length === 0}
    <div class="cloud-layout-status" role="status">正在排布热点词云…</div>
  {:else}
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="词语字号表示相对热度；点击词语查看详细解释"
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform={`translate(${width / 2} ${height / 2})`}>
        {#each placedWords as word, index (word.keyword)}
          <g
            class:selected={selectedKeyword === word.keyword}
            class="cloud-word"
            role="button"
            tabindex="0"
            aria-label={`${word.keyword}，热度 ${word.heat}，点击查看解释`}
            transform={`translate(${word.x ?? 0} ${word.y ?? 0}) rotate(${word.rotate ?? 0})`}
            onclick={() => selectWord(word)}
            onkeydown={(event) => handleKeydown(event, word)}
          >
            <title>{word.keyword} · 热度 {word.heat}</title>
            <text
              text-anchor="middle"
              dominant-baseline="central"
              font-size={word.size}
              font-weight={word.heat >= 75 ? 720 : 620}
              fill={wordColor(index, word)}
            >{word.text}</text>
          </g>
        {/each}
      </g>
    </svg>
  {/if}
</div>

<style>
  .cloud-host {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 260px;
    overflow: hidden;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .cloud-word {
    cursor: pointer;
    outline: none;
  }

  .cloud-word text {
    paint-order: stroke;
    stroke: rgba(4, 15, 33, 0.28);
    stroke-width: 1.5px;
    transition:
      filter 160ms ease,
      opacity 160ms ease;
  }

  .cloud-word:hover text,
  .cloud-word.selected text {
    filter: brightness(1.08);
    opacity: 0.92;
  }

  .cloud-word:focus-visible text {
    filter: brightness(1.08);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 6px;
  }

  .cloud-layout-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #91a6c5;
    font-size: 0.875rem;
    letter-spacing: 0.08em;
  }

  @media (prefers-reduced-motion: reduce) {
    .cloud-word text {
      transition: none;
    }
  }
</style>
