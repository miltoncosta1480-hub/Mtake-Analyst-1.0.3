
export enum MarketTrend {
  UP = 'UP',
  DOWN = 'DOWN',
  FLAT = 'FLAT'
}

export type AssetCategory = 
  | 'Commodities' 
  | 'Índices Globais' 
  | 'Moedas' 
  | 'Treasuries & Juros' 
  | 'Brasil Blue-Chips' 
  | 'Risk-On'
  | 'Risk-Off';

export interface Asset {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  category: AssetCategory;
  lastUpdate?: string;
}

export interface MarketSnapshot {
  timestamp: string;
  assets: Asset[];
}

export enum SignalType {
  COMPRA = 'COMPRA',
  VENDA = 'VENDA',
  NEUTRO = 'NEUTRO'
}

export interface NewsSource {
  title: string;
  uri: string;
}

export interface AnalysisResult {
  signal: SignalType;
  confidence: number;
  reasoning: string;
  technicalOutlook: string; 
  entryZone: string;
  takeProfit: string; 
  stopLoss: string;   
  positiveFactors: string[];
  negativeFactors: string[];
  newsSummary: string;
  newsSources: NewsSource[];
  timestamp: string;
  provider: string;
}

// Nova interface para o Relatório de Pré-Mercado (Playbook Institucional)
export interface VolatilityEvent {
  time: string;
  event: string;
  impact: 'ALTO' | 'MÉDIO' | 'BAIXO';
  action: string; // Ex: "Ficar fora"
}

export interface PreMarketAnalysis {
  globalSentiment: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL';
  openingBias: string; // Viés de abertura
  
  // 1. Agenda & Volatilidade
  volatilitySchedule: VolatilityEvent[];
  
  // 2. Fluxo Estrangeiro
  foreignFlow: string; // Saldo gringo e interpretação
  
  // 3. Correlacionados (Snapshot Rápido)
  correlations: {
    sp500: string; // Viés SPY/ES
    dxy: string;   // Viés Dólar Global
    ewz: string;   // Viés Brasil
    treasuries: string; // Viés Juros
  };

  // 4. Contexto do Dia Anterior
  yesterdayContext: string; // Onde o WIN trabalhou, liquidez, suportes defendidos
  
  strategyPlan: string; // Resumo do plano
  timestamp: string;
}

export interface AssetGroup {
  title: string;
  assets: Asset[];
  color: string;
}
