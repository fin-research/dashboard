import { z } from "zod";

export type EconomicIndicatorDefinition = {
  key: string;
  name: string;
  code: string;
  unit: string;
  decimals: number;
  factor?: number;
  offset?: number;
};

export type EconomicIndicatorPoint = {
  date: string;
  value: number;
};

export type EconomicIndicatorSeries = EconomicIndicatorDefinition & {
  points: EconomicIndicatorPoint[];
};

export type EconomicIndicatorGroup = {
  type: string;
  accent: string;
  indicators: EconomicIndicatorDefinition[];
};

export type EconomicIndicatorSeriesGroup = Omit<
  EconomicIndicatorGroup,
  "indicators"
> & {
  indicators: EconomicIndicatorSeries[];
};

export const ECONOMIC_INDICATOR_GROUPS: EconomicIndicatorGroup[] = [
  {
    type: "增长与景气",
    accent: "#2f6fed",
    indicators: [
      indicator("gdp-real-yoy", "GDP不变价同比", "EMM00000012", "%", 1),
      indicator("manufacturing-pmi", "制造业PMI", "EMM00121996", "%", 1),
      indicator("industrial-output-yoy", "工业增加值同比", "EMM00008445", "%", 1),
      indicator("industrial-profit-yoy", "工业企业利润总额同比", "EMM00641328", "%", 1),
    ],
  },
  {
    type: "需求",
    accent: "#0e9384",
    indicators: [
      indicator("retail-sales-yoy", "社零同比", "EMI00135328", "%", 1),
      indicator("fixed-asset-investment-yoy", "固定资产投资同比", "EMM00590832", "%", 1),
      indicator("property-investment-yoy", "房地产开发投资同比", "EMI00120220", "%", 1),
      indicator("exports-yoy", "出口金额同比", "EMM00053058", "%", 1),
    ],
  },
  {
    type: "价格",
    accent: "#7f56d9",
    indicators: [
      indicator("china-cpi-yoy", "CPI同比", "EMM00072301", "%", 1),
      indicator("china-core-cpi-yoy", "核心CPI同比", "EMI01737210", "%", 1, 1, -100),
      indicator("china-ppi-yoy", "PPI同比", "EMM00073348", "%", 1),
      indicator("gdp-deflator-yoy", "GDP平减指数同比", "EMM01607812", "%", 1),
    ],
  },
  {
    type: "货币与信用",
    accent: "#dc6803",
    indicators: [
      indicator("m1-yoy", "M1同比", "EMM00087084", "%", 1),
      indicator("m2-yoy", "M2同比", "EMM00087086", "%", 1),
      indicator("tsf-stock-yoy", "社融存量同比", "EMM00634721", "%", 1),
      indicator("rmb-loans-yoy", "人民币贷款同比", "EMM00087129", "%", 1),
    ],
  },
  {
    type: "高频指标",
    accent: "#079455",
    indicators: [
      indicator("home-sales-30-city", "30城商品房成交", "EMI01778636", "万平方米", 1),
      indicator("nanhua-industrials", "南华工业品指数", "EMI00227697", "点", 1),
      indicator("rebar-spot", "螺纹钢现货", "EMI01733174", "元/吨", 0),
      indicator("cement-price-index", "水泥价格指数", "EMI01670402", "点", 1),
    ],
  },
  {
    type: "海外基本面",
    accent: "#1570ef",
    indicators: [
      indicator("us-cpi-yoy", "美国CPI同比", "EMG00000733", "%", 1),
      indicator("us-core-pce-yoy", "核心PCE同比", "EMG00157776", "%", 1),
      indicator("us-nonfarm-payroll", "新增非农就业", "EMG00152118", "千人", 0),
      indicator("us-unemployment", "失业率", "EMG00001039", "%", 1),
    ],
  },
  {
    type: "海外利率",
    accent: "#c4320a",
    indicators: [
      indicator("fed-funds-target", "联邦基金目标利率", "EMG00146415", "%", 2),
      indicator("ust-2y", "美债2Y", "EMG00001306", "%", 2),
      indicator("ust-10y", "美债10Y", "EMG00001310", "%", 2),
      indicator("ust-10y-2y", "10Y-2Y期限利差", "EMG01339436", "bp", 0, 100),
    ],
  },
  {
    type: "汇率与商品",
    accent: "#b54708",
    indicators: [
      indicator("dxy", "美元指数 DXY", "EMG00001435", "点", 2),
      indicator("usd-cnh", "USD/CNH", "EMM00618963", "", 4),
      indicator("wti", "WTI原油", "EMI00531920", "美元/桶", 2),
      indicator("gold", "黄金", "EMI00224675", "美元/盎司", 1),
    ],
  },
  {
    type: "全球风险资产",
    accent: "#6938ef",
    indicators: [
      indicator("sp-500", "标普500", "EMG00002593", "点", 1),
      indicator("nasdaq", "纳斯达克", "EMG00002594", "点", 1),
      indicator("msci-em", "MSCI新兴市场指数", "EMG01582711", "点", 1),
      indicator("vix", "VIX", "EMG00002651", "点", 2),
    ],
  },
];

const rowSchema = z.object({
  code: z.string(),
  date: z.string(),
  RESULT: z.union([z.number(), z.string()]),
});

const responseSchema = z.object({
  data: z
    .object({
      economics: z.object({
        function: z.literal("EDB"),
        fields: z.array(z.string()),
        rows: z.array(rowSchema),
      }),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const ECONOMIC_INDICATORS_QUERY = `
  query EconomicIndicators(
    $edbIds: String!
    $startDate: Date!
    $endDate: Date!
    $options: String!
  ) {
    economics: choiceEdb(
      edbIds: $edbIds
      startDate: $startDate
      endDate: $endDate
      options: $options
    ) {
      function
      fields
      rows
    }
  }
`;

const MAX_CHART_POINTS = 96;

function indicator(
  key: string,
  name: string,
  code: string,
  unit: string,
  decimals: number,
  factor?: number,
  offset?: number,
): EconomicIndicatorDefinition {
  return { key, name, code, unit, decimals, factor, offset };
}

export function economicIndicatorRange(now = new Date()): {
  startDate: string;
  endDate: string;
} {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 18, 1),
  );
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function emptyEconomicIndicatorGroups(): EconomicIndicatorSeriesGroup[] {
  return ECONOMIC_INDICATOR_GROUPS.map((group) => ({
    ...group,
    indicators: group.indicators.map((definition) => ({
      ...definition,
      points: [],
    })),
  }));
}

export function mapEconomicIndicatorRows(
  rows: Array<z.infer<typeof rowSchema>>,
): EconomicIndicatorSeriesGroup[] {
  const rowsByCode = new Map<string, EconomicIndicatorPoint[]>();

  for (const row of rows) {
    const rawValue = typeof row.RESULT === "number" ? row.RESULT : Number(row.RESULT);
    if (!Number.isFinite(rawValue)) continue;
    const points = rowsByCode.get(row.code) ?? [];
    points.push({ date: row.date, value: rawValue });
    rowsByCode.set(row.code, points);
  }

  return ECONOMIC_INDICATOR_GROUPS.map((group) => ({
    ...group,
    indicators: group.indicators.map((definition) => {
      const points = (rowsByCode.get(definition.code) ?? [])
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((point) => ({
          date: point.date,
          value:
            point.value * (definition.factor ?? 1) + (definition.offset ?? 0),
        }));
      return { ...definition, points: downsample(points) };
    }),
  }));
}

export async function fetchEconomicIndicatorGroups(
  signal?: AbortSignal,
  now = new Date(),
): Promise<EconomicIndicatorSeriesGroup[]> {
  const { startDate, endDate } = economicIndicatorRange(now);
  const edbIds = ECONOMIC_INDICATOR_GROUPS.flatMap((group) =>
    group.indicators.map((item) => item.code),
  ).join(",");
  const response = await fetch("/data/graphql", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: ECONOMIC_INDICATORS_QUERY,
      variables: {
        edbIds,
        startDate,
        endDate,
        options: "IsPublishDate=0,FixDate=0",
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`经济指标请求失败（HTTP ${response.status}）`);
  }
  const payload = responseSchema.parse(await response.json());
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).join("；"));
  }
  if (!payload.data) {
    throw new Error("经济指标响应缺少 data");
  }
  return mapEconomicIndicatorRows(payload.data.economics.rows);
}

function downsample(points: EconomicIndicatorPoint[]): EconomicIndicatorPoint[] {
  if (points.length <= MAX_CHART_POINTS) return points;
  const lastIndex = points.length - 1;
  const selected = Array.from({ length: MAX_CHART_POINTS }, (_, index) =>
    Math.round((index * lastIndex) / (MAX_CHART_POINTS - 1)),
  );
  return [...new Set(selected)].map((index) => points[index]!);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
