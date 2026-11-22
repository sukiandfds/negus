export interface IntelligenceEfficiencyPoint {
  model: string;
  effort: string;
  iq: number;
  average_minutes: number | null;
  average_price_usd: number | null;
  valid_tasks?: number;
}

export interface IntelligenceEfficiencySnapshot {
  round: string;
  points: IntelligenceEfficiencyPoint[];
}
