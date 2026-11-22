import type { IntelligenceEfficiencySnapshot } from "../model/types";

// Read the same published projection as Radar's score/cost/time chart. Never execute page markup.
export const readIntelligenceEfficiency = async (): Promise<IntelligenceEfficiencySnapshot> => {
  const response = await fetch("https://codexradar.com/", {cache:"no-cache", credentials:"omit"});
  if (!response.ok) throw new Error('HTTP '+response.status);
  const json = (await response.text()).match(/<script\b[^>]*\bdata-mtr-payload\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) throw new Error("网站未返回模型榜单");
  const payload = JSON.parse(json);
  if (!Array.isArray(payload.rows)) throw new Error("模型榜单格式异常");
  const points = payload.rows.flatMap((row: {model:string;effort:string;chart_metrics?:Record<string,number>;availability?:{cost:boolean;time:boolean}}) => {
    const m=row.chart_metrics;
    if (!row.model || !row.effort || !m || !Number.isFinite(m.score150)) return [];
    return [{model:row.model,effort:row.effort,iq:m.score150,
      average_minutes:row.availability?.time!==false && Number.isFinite(m.end_to_end_minutes_per_task)?m.end_to_end_minutes_per_task:null,
      average_price_usd:row.availability?.cost!==false && Number.isFinite(m.api_equivalent_usd_per_task)?m.api_equivalent_usd_per_task:null}];
  });
  if (!points.length) throw new Error("榜单没有已评分模型");
  return {round:String(payload.round_id||""),points};
};
