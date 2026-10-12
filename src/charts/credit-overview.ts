import { setChart } from './charting';
import { workbenchBarChartOption } from './trading-research';
import { financingCompositionOption } from './financing-dashboard';
import { tooltip } from './common';
import type { CreditChartDatum } from '../lib/credit/overview.ts';

export function renderCreditOverviewBarChart(host: HTMLElement, data: readonly CreditChartDatum[], description: string, unit: string): void {
  setChart(host, workbenchBarChartOption(data, description, unit, undefined, [], true));
}

export function renderCreditOverviewDonutChart(host: HTMLElement, data: readonly CreditChartDatum[], description: string): void {
  const option = financingCompositionOption(data.map(row => ({ type: row.label, amountYi: row.value ?? 0 })), host.clientWidth < 420);
  setChart(host, { ...option, aria: { enabled: true, description },
    tooltip: { ...tooltip, trigger: 'item', valueFormatter: (value: unknown) => `${value}家` } });
}
