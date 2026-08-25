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
    iconPosition = "end",
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
  {/if}
</article>

<style>
  .research-metric-card {
    --metric-accent: var(--color-primary, #2f6fd6);
    --metric-soft: var(--color-primary-soft, #eaf1fd);
    display: flex;
    min-width: 0;
    min-height: 98px;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--border, #d8e2f0);
    border-radius: var(--radius-card, 10px);
    color: var(--text-1, #172033);
    background: color-mix(in srgb, var(--metric-accent) 5%, var(--bg-card, #ffffff));
    box-shadow: var(--shadow-card, 0 2px 8px rgba(23, 32, 51, 0.06));
  }

  .research-metric-card--icon-end {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .research-metric-card--compact {
    min-height: 86px;
    padding: 12px 14px;
  }

  .research-metric-card--blue,
  .research-metric-card--primary {
    --metric-accent: #2f6fed;
    --metric-soft: #eaf1fd;
  }

  .research-metric-card--cyan {
    --metric-accent: #0ba5ec;
    --metric-soft: #f0f9ff;
  }

  .research-metric-card--teal,
  .research-metric-card--green,
  .research-metric-card--good {
    --metric-accent: #16a394;
    --metric-soft: #e8f7f0;
  }

  .research-metric-card--orange {
    --metric-accent: #f79009;
    --metric-soft: #fff2e8;
  }

  .research-metric-card--purple {
    --metric-accent: #6941c6;
    --metric-soft: #f2edff;
  }

  .research-metric-card--red,
  .research-metric-card--bad {
    --metric-accent: #d92d20;
    --metric-soft: #fff0ef;
  }

  .research-metric-card--neutral {
    --metric-accent: #667085;
    --metric-soft: #f2f4f7;
  }

  .research-metric-card__content {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 4px;
    align-content: center;
  }

  .research-metric-card__label {
    color: var(--text-3, #667085);
    font-size: 0.875rem;
    font-weight: bold;
    line-height: 1.3;
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
    font-size: clamp(1.25rem, 2vw, 1.5rem);
    font-weight: bolder;
    letter-spacing: -0.025em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .research-metric-card__value span {
    color: var(--text-3, #667085);
    font-size: 0.875rem;
  }

  .research-metric-card__detail {
    margin: 0;
    color: var(--text-3, #667085);
    font-size: 1rem;
    font-weight: normal;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .research-metric-card__detail b {
    font-weight: bold;
  }

  .research-metric-card__icon {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 42px;
    place-items: center;
    border-radius: var(--radius-control, 8px);
    color: var(--metric-accent);
    background: var(--metric-soft);
  }

  .research-metric-card__icon :global(svg) {
    width: 22px;
    height: 22px;
    padding: 0;
    color: inherit;
    background: transparent;
  }

  @media (max-width: 520px) {
    .research-metric-card {
      min-height: 90px;
      padding: 12px;
    }

    .research-metric-card__icon {
      width: 38px;
      height: 38px;
      flex-basis: 38px;
    }
  }
</style>
