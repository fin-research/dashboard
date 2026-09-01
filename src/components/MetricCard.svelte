<script lang="ts">
  import type { Component } from "svelte";

  type MetricTone =
    | "primary"
    | "blue"
    | "cyan"
    | "teal"
    | "green"
    | "orange"
    | "purple"
    | "red"
    | "good"
    | "bad"
    | "neutral";

  let {
    label,
    value,
    unit = "",
    detail,
    detailPrefix = "",
    detailSuffix = "",
    detailTone = "",
    tone = "primary",
    iconComponent: IconComponent,
    iconProps = {},
    iconPosition = "start",
    compact = false,
  }: {
    label: string;
    value: string;
    unit?: string;
    detail?: string;
    detailPrefix?: string;
    detailSuffix?: string;
    detailTone?: string;
    tone?: MetricTone;
    iconComponent?: Component<any>;
    iconProps?: Record<string, unknown>;
    iconPosition?: "start" | "end";
    compact?: boolean;
  } = $props();
</script>

<article
  class:research-metric-card--compact={compact}
  class:research-metric-card--icon-end={Boolean(IconComponent) && iconPosition === "end"}
  class={`research-metric-card research-metric-card--${tone}`}
>
  {#if IconComponent && iconPosition === "start"}
    <span class="research-metric-card__icon" aria-hidden="true">
      <IconComponent {...iconProps} />
    </span>
  {:else if IconComponent}
    <span class="research-metric-card__balance" aria-hidden="true"></span>
  {/if}

  <div class="research-metric-card__content">
    <span class="research-metric-card__label">{label}</span>
    <div class="research-metric-card__value">
      <strong>{value}</strong>
      {#if unit}<span>{unit}</span>{/if}
    </div>
    {#if detail !== undefined && detail !== ""}
      <p class="research-metric-card__detail">
        {detailPrefix}{#if detailTone}<b class={detailTone}>{detail}</b>{:else}<span
            >{detail}</span
          >{/if}{detailSuffix}
      </p>
    {/if}
  </div>

  {#if IconComponent && iconPosition === "end"}
    <span class="research-metric-card__icon" aria-hidden="true">
      <IconComponent {...iconProps} />
    </span>
  {:else if IconComponent}
    <span class="research-metric-card__balance" aria-hidden="true"></span>
  {/if}
</article>

<style>
  .research-metric-card {
    --metric-accent: var(--color-primary, #2f6fd6);
    --metric-soft: var(--color-primary-soft, #eaf1fd);
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    align-items: center;
    justify-content: space-evenly;
    gap: 8px;
    padding: 8px clamp(8px, 0.8vw, 14px);
    border: 1px solid var(--border, #d8e2f0);
    border-radius: var(--radius-card, 10px);
    color: var(--text-1, #172033);
    background: color-mix(in srgb, var(--metric-accent) 5%, var(--bg-card, #ffffff));
    box-shadow: var(--shadow-card, 0 2px 8px rgba(23, 32, 51, 0.06));
  }

  .research-metric-card--icon-end {
    flex-direction: row;
  }

  .research-metric-card--compact {
    justify-content: flex-start;
    padding-block: 6px;
  }

  .research-metric-card--compact .research-metric-card__balance {
    display: none;
  }

  .research-metric-card--blue,
  .research-metric-card--primary {
    --metric-accent: #2f6fd6;
    --metric-soft: #eaf1fd;
  }

  .research-metric-card--cyan {
    --metric-accent: #277b91;
    --metric-soft: #e9f5f8;
  }

  .research-metric-card--teal,
  .research-metric-card--green,
  .research-metric-card--good {
    --metric-accent: #12a873;
    --metric-soft: #e7f6f0;
  }

  .research-metric-card--orange {
    --metric-accent: #c66a23;
    --metric-soft: #fff1e7;
  }

  .research-metric-card--purple {
    --metric-accent: #6f63c6;
    --metric-soft: #efedfb;
  }

  .research-metric-card--red,
  .research-metric-card--bad {
    --metric-accent: #d92d20;
    --metric-soft: #fceceb;
  }

  .research-metric-card--neutral {
    --metric-accent: #667085;
    --metric-soft: #f2f4f7;
  }

  .research-metric-card__content {
    display: flex;
    min-width: 0;
    flex: 1;
    justify-content: center;
    flex-direction: column;
  }

  .research-metric-card__label {
    color: var(--text-3, #667085);
    font-size: 1rem;
    font-weight: bold;
    line-height: 1.2;
  }

  .research-metric-card__value {
    display: flex;
    min-width: 0;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-variant-numeric: tabular-nums;
  }

  .research-metric-card__value strong {
    min-width: 0;
    color: var(--text-1, #172033);
    font-size: 1.5rem;
    font-weight: bolder;
    letter-spacing: -0.025em;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .research-metric-card__value span {
    color: var(--text-3, #667085);
    font-size: 1rem;
  }

  .research-metric-card__detail {
    margin: 0;
    color: var(--metric-accent);
    font-size: 1rem;
    font-weight: normal;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .research-metric-card__detail b {
    font-weight: bold;
  }

  .research-metric-card__detail :global(.tone-inject) {
    color: #12805c;
  }

  .research-metric-card__detail :global(.tone-withdraw) {
    color: #d92d20;
  }

  .research-metric-card__icon {
    display: grid;
    width: 3rem;
    height: 3rem;
    flex: 0 0 3rem;
    place-items: center;
    border-radius: 50%;
    color: var(--metric-accent);
    background: var(--metric-soft);
  }

  .research-metric-card__balance {
    width: 3rem;
    height: 3rem;
    flex: 0 0 3rem;
  }

  .research-metric-card__icon :global(svg) {
    width: 3rem;
    height: 3rem;
    padding: 0;
    color: inherit;
    background: transparent;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.5;
  }

  @media (max-width: 900px) {
    .research-metric-card {
      min-height: 82px;
      justify-content: flex-start;
      padding: 8px;
    }

    .research-metric-card__icon,
    .research-metric-card__icon :global(svg) {
      width: 2.5rem;
      height: 2.5rem;
    }

    .research-metric-card__icon {
      flex-basis: 2.5rem;
    }

    .research-metric-card__balance {
      display: none;
    }

    .research-metric-card__label,
    .research-metric-card__detail,
    .research-metric-card__value span {
      font-size: 0.875rem;
    }

    .research-metric-card__value strong {
      font-size: 1.25rem;
    }
  }

  @media (max-width: 420px) {
    .research-metric-card {
      min-height: 78px;
      gap: 6px;
      padding: 7px 6px;
    }

    .research-metric-card__icon,
    .research-metric-card__icon :global(svg) {
      width: 2.25rem;
      height: 2.25rem;
    }

    .research-metric-card__icon {
      flex-basis: 2.25rem;
    }

    .research-metric-card__label,
    .research-metric-card__detail,
    .research-metric-card__value span {
      font-size: 0.8125rem;
    }

    .research-metric-card__value strong {
      font-size: 1.125rem;
    }
  }
</style>
