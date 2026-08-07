<script lang="ts">
  import type { TableRowView } from "../view-model";

  export let headers: string[];
  export let rows: TableRowView[];
  export let emptyText: string;
</script>

{#if !rows.length}
  <div class="secondary-table__empty">{emptyText}</div>
{:else}
  <table class="table secondary-table">
    <thead>
      <tr>
        {#each headers as label}
          <th>{label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, rowIndex (`${row.values.join("|")}-${rowIndex}`)}
        <tr>
          {#each row.values as value, columnIndex}
            <td>
              {#if columnIndex === 0 && row.tagIndex}
                <span
                  class={`badge primary-badge tenor-badge primary-badge--${row.tagIndex}`}
                  >{value}</span
                >
              {:else}
                {value}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
