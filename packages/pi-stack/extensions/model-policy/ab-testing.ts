/**
 * model-policy — ab-testing.ts
 * A/B testing de modelos por role com split por colony run.
 */
import type { ABStats, ABTestResult, ExperimentConfig, ResolvedPolicy, BenchmarkRecord, ByRoleEntry } from "./types.js";
import { loadBenchmarks } from "./benchmark-recorder.js";
import { getResolvedPolicy } from "./config.js";

function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((s,v)=>s+v,0)/arr.length; }
function stdDev(arr: number[], avg: number): number { return arr.length===0 ? 0 : Math.sqrt(arr.reduce((s,v)=>s+(v-avg)**2,0)/arr.length); }

function computeABStats(entries: ByRoleEntry[], group: "control"|"variant", model: string): ABStats {
  if (entries.length===0) return {group,model,samples:0,costPerTaskMean:0,costPerTaskStd:0,durationMsMean:0,durationMsStd:0,failureRate:0,tokensPerTask:0,contextPctMean:0};
  const costs=entries.map(e=>e.costPerTask), durs=entries.map(e=>e.durationMsAvg);
  const cm=mean(costs), dm=mean(durs);
  return {group,model,samples:entries.length,costPerTaskMean:cm,costPerTaskStd:stdDev(costs,cm),durationMsMean:dm,durationMsStd:stdDev(durs,dm),failureRate:mean(entries.map(e=>e.failureRate)),tokensPerTask:mean(entries.map(e=>e.inputTokens+e.outputTokens)),contextPctMean:mean(entries.map(e=>e.contextPctAvg))};
}

function recommend(c: ABStats, v: ABStats): {recommendation:"control"|"variant"|"inconclusive"; reasoning:string} {
  if (v.failureRate > c.failureRate+0.03) return {recommendation:"control",reasoning:`Variant tem failure rate ${(v.failureRate*100).toFixed(1)}% vs control ${(c.failureRate*100).toFixed(1)}% (+${((v.failureRate-c.failureRate)*100).toFixed(1)}pp)`};
  const costBetter=v.costPerTaskMean<c.costPerTaskMean*0.85;
  const latWorse=v.durationMsMean>c.durationMsMean*1.30;
  if (costBetter && !latWorse) return {recommendation:"variant",reasoning:`Variant ${((1-v.costPerTaskMean/Math.max(c.costPerTaskMean,1e-9))*100).toFixed(0)}% mais barato sem degradação de latência`};
  if (!costBetter && latWorse) return {recommendation:"control",reasoning:`Variant ${((v.durationMsMean/Math.max(c.durationMsMean,1)-1)*100).toFixed(0)}% mais lento sem ganho em custo`};
  return {recommendation:"inconclusive",reasoning:"Diferenças insuficientes para recomendação clara"};
}

function collectGroupData(records: BenchmarkRecord[], role: string, exp: ExperimentConfig) {
  const short=role.replace(/^swarm:|^subagent:/,"");
  const ctrl={entries:[] as ByRoleEntry[],model:exp.control};
  const vari={entries:[] as ByRoleEntry[],model:exp.variant};
  for (const r of records) {
    if (!r.experiment||r.experiment.role!==role) continue;
    const t=r.experiment.group==="control"?ctrl:vari;
    for (const e of r.byRole) { if (e.role.split(":")[0]===short||e.role===short) t.entries.push(e); }
  }
  return {control:ctrl,variant:vari};
}

export function checkExperimentResult(role: string): ABTestResult|null {
  let policy: ResolvedPolicy;
  try { policy=getResolvedPolicy(); } catch { return null; }
  const exp=policy.experiments[role];
  if (!exp?.enabled) return null;
  const records=loadBenchmarks({runType:"colony",maxRecords:500});
  const {control:cd,variant:vd}=collectGroupData(records,role,exp);
  if (cd.entries.length<exp.minSamples||vd.entries.length<exp.minSamples) return null;
  const cs=computeABStats(cd.entries,"control",exp.control);
  const vs=computeABStats(vd.entries,"variant",exp.variant);
  const {recommendation,reasoning}=recommend(cs,vs);
  return {role,experimentId:`${role}-${exp.startedAt.slice(0,10)}`,control:cs,variant:vs,recommendation,reasoning,completedAt:new Date().toISOString()};
}

export function getExperimentStatus(): Array<{role:string;exp:ExperimentConfig;controlSamples:number;variantSamples:number;ready:boolean}> {
  let policy: ResolvedPolicy;
  try { policy=getResolvedPolicy(); } catch { return []; }
  const exps=policy.experiments;
  if (!exps||Object.keys(exps).length===0) return [];
  const records=loadBenchmarks({runType:"colony",maxRecords:500});
  return Object.entries(exps).filter(([,e])=>e.enabled).map(([role,exp])=>{
    const {control:cd,variant:vd}=collectGroupData(records,role,exp);
    return {role,exp,controlSamples:cd.entries.length,variantSamples:vd.entries.length,ready:cd.entries.length>=exp.minSamples&&vd.entries.length>=exp.minSamples};
  });
}

export function formatABTestResult(result: ABTestResult): string {
  const {control:c,variant:v}=result;
  const pct=(a:number,b:number)=>((a/Math.max(b,1e-9)-1)*100).toFixed(1);
  const icon=result.recommendation==="variant"?"✅":result.recommendation==="control"?"🔵":"⚪";
  return [`📊 A/B Test — ${result.role}`,"─".repeat(60),`  Control: ${c.model.split("/")[1]} (n=${c.samples})  $${c.costPerTaskMean.toFixed(3)}/task  ${(c.durationMsMean/1000).toFixed(1)}s  ${(c.failureRate*100).toFixed(1)}% fail`,`  Variant: ${v.model.split("/")[1]} (n=${v.samples})  $${v.costPerTaskMean.toFixed(3)}/task  ${(v.durationMsMean/1000).toFixed(1)}s  ${(v.failureRate*100).toFixed(1)}% fail`,"─".repeat(60),`  Δ Custo: ${pct(v.costPerTaskMean,c.costPerTaskMean)}%  Δ Latência: ${pct(v.durationMsMean,c.durationMsMean)}%  Δ Falhas: ${((v.failureRate-c.failureRate)*100).toFixed(1)}pp`,`  ${icon} Recomendação: ${result.recommendation.toUpperCase()}`,`  Motivo: ${result.reasoning}`].join("\n");
}

export function formatExperimentStatus(statuses: ReturnType<typeof getExperimentStatus>): string {
  if (statuses.length===0) return "Nenhum experimento A/B ativo.";
  return ["📊 Experimentos A/B ativos:","", ...statuses.map(s=>`  ${s.role}  ${s.exp.control.split("/")[1]} vs ${s.exp.variant.split("/")[1]} (${s.exp.splitPct}%)  ${s.ready?"✅ pronto":`⏳ ctrl:${s.controlSamples}/${s.exp.minSamples} var:${s.variantSamples}/${s.exp.minSamples}`}`)].join("\n");
}
