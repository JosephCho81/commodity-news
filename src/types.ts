export interface LMEPrice {
  price: string | null;
  change: string | null;
  source: string | null;
}

export interface KeyNews {
  id: number;
  title: string;
  summary: string;
  relevance: string | null;
  url: string;
  source: string;
}

export interface SupplyChainRisk {
  level: '원활' | '주의' | '경고' | null;
  reason: string | null;
}

export interface SubMaterials {
  carburizer: string | null;
  ferro_silicon: string | null;
  al_scrap: string | null;
}

export interface Logistics {
  freight: string | null;
  customs: string | null;
}

export interface ExpertComment {
  text: string;
  updatedAt: string;
}

export interface MarketBriefing {
  date: string;
  updatedAt: string;
  lme_summary: {
    aluminum: LMEPrice;
    copper: LMEPrice;
    zinc: LMEPrice;
  };
  key_news: KeyNews[];
  allNews?: KeyNews[];
  supply_chain_risk: SupplyChainRisk;
  sub_materials: SubMaterials;
  logistics: Logistics;
  expert_comment?: ExpertComment;
  disclaimer: string;
}
