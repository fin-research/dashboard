export type MarketBriefingParams = { reportDate: string };

export type MarketBriefingNewsBatchParams = {
  reportDate: string;
  items: Array<{ sentimentId: string; title: string; time: string; tags: string[]; important?: boolean }>;
};
