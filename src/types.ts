export interface PriceItem {
  item: string;
  price: string;
  note: string;
}

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
}

export interface MarketBriefing {
  prices: PriceItem[];
  news: NewsItem[];
  snapshot: string[];
  priceDrivers: string;
  aluminumOutlook: string;
  copperOutlook: string;
  zincOutlook: string;
  riskSignals: string;
  procurementStrategy: string;
}
