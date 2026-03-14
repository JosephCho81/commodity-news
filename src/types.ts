export interface PriceData {
  commodity: string;
  price: string;
  changePercent: string;
}

export interface NewsArticleInput {
  title: string;
  source: string;
  url: string;
  published_at: string;
  content_snippet: string;
}

export interface MarketBriefing {
  snapshot: string[];
  priceDrivers: string;
  aluminumOutlook: string;
  scrapOutlook: string;
  ironOreMining: string;
  riskSignals: string;
  procurementStrategy: string;
}
