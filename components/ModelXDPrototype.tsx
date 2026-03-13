"use client";

import React, { useMemo, useState } from "react";

type Page = "home" | "xduel" | "leaderboards" | "model";
type Mode = "text" | "image" | "video";

type Contender = {
  slot: "A" | "B";
  provider: "OpenAI" | "Gemini";
  modelId: string;
  latencyMs: number;
  usage: { inputTokens?: number; outputTokens?: number; images?: number; seconds?: number };
  estCostUsd: number;
  output: string;
};

type XDuel = {
  id: string;
  mode: Mode;
  prompt: string;
  contenders: Contender[];
};

const money = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function pseudoId(prefix = "b") { return `${prefix}_${Math.random().toString(16).slice(2, 10)}`; }

function demoXDuel(mode: Mode, prompt: string): XDuel {
  const flip = Math.random() > 0.5;
  const aProvider: Contender["provider"] = flip ? "OpenAI" : "Gemini";
  const bProvider: Contender["provider"] = flip ? "Gemini" : "OpenAI";
  const baseLatencyA = 700 + Math.round(Math.random() * 900);
  const baseLatencyB = 700 + Math.round(Math.random() * 900);

  if (mode === "text") {
    const inTok = 900 + Math.round(Math.random() * 1200);
    const outTokA = 350 + Math.round(Math.random() * 700);
    const outTokB = 350 + Math.round(Math.random() * 700);

    const aCost = (inTok * 0.0000006 + outTokA * 0.0000018) * (aProvider === "OpenAI" ? 1.0 : 0.8);
    const bCost = (inTok * 0.0000006 + outTokB * 0.0000018) * (bProvider === "OpenAI" ? 1.0 : 0.8);

    const aText = `Response A (blind)\n\n• Summary: ${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}\n• Key points:\n  1) Clear structure\n  2) Concrete examples\n  3) Concise closing\n\nIf you want, I can also produce a shorter version and a punchier tagline.`;
    const bText = `Response B (blind)\n\nHere’s a polished output tailored to your prompt:\n\n- Outcome-driven copy\n- Strong first line\n- Bullets + CTA\n\nWant me to target a specific audience (developers vs PMs vs consumers)?`;

    return {
      id: pseudoId("txt"),
      mode,
      prompt,
      contenders: [
        { slot: "A", provider: aProvider, modelId: aProvider === "OpenAI" ? "gpt-4.1-mini" : "gemini-2.0-flash", latencyMs: baseLatencyA, usage: { inputTokens: inTok, outputTokens: outTokA }, estCostUsd: aCost, output: aText },
        { slot: "B", provider: bProvider, modelId: bProvider === "OpenAI" ? "gpt-4o-mini" : "gemini-2.0-pro", latencyMs: baseLatencyB, usage: { inputTokens: inTok, outputTokens: outTokB }, estCostUsd: bCost, output: bText },
      ],
    };
  }

  if (mode === "image") {
    const images = 1;
    const aCost = 0.02 * (aProvider === "OpenAI" ? 1.0 : 0.8);
    const bCost = 0.02 * (bProvider === "OpenAI" ? 1.0 : 0.8);
    const safeText = prompt.replace(/&/g, "and");

    const svgA = `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='900' height='600'>
        <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='#0ea5e9'/><stop offset='1' stop-color='#a78bfa'/>
        </linearGradient></defs>
        <rect width='100%' height='100%' fill='url(#g)'/>
        <circle cx='690' cy='170' r='120' fill='rgba(255,255,255,0.25)'/>
        <rect x='70' y='70' width='760' height='460' rx='32' fill='rgba(0,0,0,0.25)'/>
        <text x='100' y='160' fill='white' font-size='34' font-family='ui-sans-serif, system-ui'>Image A (blind)</text>
        <text x='100' y='210' fill='white' font-size='18' opacity='0.9' font-family='ui-sans-serif, system-ui'>${safeText.slice(0, 110)}</text>
        <text x='100' y='520' fill='white' font-size='14' opacity='0.7' font-family='ui-sans-serif, system-ui'>Placeholder preview</text>
      </svg>
    `)}`;

    const svgB = `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='900' height='600'>
        <defs><linearGradient id='g' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='#22c55e'/><stop offset='1' stop-color='#f97316'/>
        </linearGradient></defs>
        <rect width='100%' height='100%' fill='url(#g)'/>
        <path d='M90,470 C210,310 320,350 450,250 C560,170 700,160 820,220 L820,530 L90,530 Z' fill='rgba(0,0,0,0.28)'/>
        <text x='100' y='160' fill='white' font-size='34' font-family='ui-sans-serif, system-ui'>Image B (blind)</text>
        <text x='100' y='210' fill='white' font-size='18' opacity='0.9' font-family='ui-sans-serif, system-ui'>${safeText.slice(0, 110)}</text>
        <text x='100' y='520' fill='white' font-size='14' opacity='0.7' font-family='ui-sans-serif, system-ui'>Placeholder preview</text>
      </svg>
    `)}`;

    return {
      id: pseudoId("img"),
      mode,
      prompt,
      contenders: [
        { slot: "A", provider: aProvider, modelId: aProvider === "OpenAI" ? "gpt-image-1" : "imagen-3", latencyMs: baseLatencyA + 600, usage: { images }, estCostUsd: aCost, output: svgA },
        { slot: "B", provider: bProvider, modelId: bProvider === "OpenAI" ? "gpt-image-1" : "imagen-3-fast", latencyMs: baseLatencyB + 600, usage: { images }, estCostUsd: bCost, output: svgB },
      ],
    };
  }

  const seconds = 10;
  const aCost = 0.08 * (aProvider === "OpenAI" ? 1.0 : 0.8);
  const bCost = 0.08 * (bProvider === "OpenAI" ? 1.0 : 0.8);
  const safeText = prompt.replace(/&/g, "and");

  const vidA = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='506'>
      <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='#111827'/><stop offset='1' stop-color='#3b82f6'/>
      </linearGradient></defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <circle cx='450' cy='253' r='130' fill='rgba(255,255,255,0.10)'/>
      <polygon points='420,195 420,311 540,253' fill='rgba(255,255,255,0.85)'/>
      <text x='40' y='70' fill='white' font-size='34' font-family='ui-sans-serif, system-ui'>Video A (blind)</text>
      <text x='40' y='112' fill='white' font-size='16' opacity='0.85' font-family='ui-sans-serif, system-ui'>${safeText.slice(0, 90)}</text>
    </svg>
  `)}`;

  const vidB = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='506'>
      <defs><linearGradient id='g' x1='1' y1='0' x2='0' y2='1'>
        <stop offset='0' stop-color='#0f172a'/><stop offset='1' stop-color='#a855f7'/>
      </linearGradient></defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <rect x='80' y='120' width='740' height='300' rx='26' fill='rgba(0,0,0,0.25)'/>
      <polygon points='430,210 430,330 560,270' fill='rgba(255,255,255,0.85)'/>
      <text x='40' y='70' fill='white' font-size='34' font-family='ui-sans-serif, system-ui'>Video B (blind)</text>
      <text x='40' y='112' fill='white' font-size='16' opacity='0.85' font-family='ui-sans-serif, system-ui'>${safeText.slice(0, 90)}</text>
    </svg>
  `)}`;

  return {
    id: pseudoId("vid"),
    mode,
    prompt,
    contenders: [
      { slot: "A", provider: aProvider, modelId: aProvider === "OpenAI" ? "gpt-video-1" : "veo-2", latencyMs: baseLatencyA + 1200, usage: { seconds }, estCostUsd: aCost, output: vidA },
      { slot: "B", provider: bProvider, modelId: bProvider === "OpenAI" ? "gpt-video-1" : "veo-2-fast", latencyMs: baseLatencyB + 1200, usage: { seconds }, estCostUsd: bCost, output: vidB },
    ],
  };
}

function getTextCostParts(c: Contender) {
  const inTok = c.usage.inputTokens ?? 0;
  const outTok = c.usage.outputTokens ?? 0;
  const baseIn = inTok * 0.0000006;
  const baseOut = outTok * 0.0000018;
  const mult = c.provider === "OpenAI" ? 1.0 : 0.8;
  return { input: baseIn * mult, output: baseOut * mult, total: (baseIn + baseOut) * mult };
}

function CostBreakdownBar({ contender, mode }: { contender: Contender; mode: Mode }) {
  const total = contender.estCostUsd;
  if (total <= 0) return null;

  if (mode === "text") {
    const parts = getTextCostParts(contender);
    const inputPct = parts.total > 0 ? (parts.input / parts.total) * 100 : 50;
    const outputPct = 100 - inputPct;
    return (
      <div style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="small">Cost breakdown</span>
          <span className="mono small">{money(total)}</span>
        </div>
        <div className="bar">
          <div>
            <div className="a" style={{ width: `${clamp(inputPct, 0, 100)}%` }} />
            <div className="b" style={{ width: `${clamp(outputPct, 0, 100)}%` }} />
          </div>
        </div>
        <div className="row small" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span>input</span><span>output</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="small">Estimated cost</span>
        <span className="mono small">{money(total)}</span>
      </div>
      <div className="bar"><div><div className="b" style={{ width: "100%" }} /></div></div>
    </div>
  );
}

function MiniScatter({ points, height = 140 }: { points: { label: string; x: number; y: number; provider: string }[]; height?: number }) {
  const pad = 14, w = 520, h = height;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs, 0.0001), maxX = Math.max(...xs, 0.001);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);
  const sx = (x:number)=> pad + ((x-minX)/(maxX-minX||1))*(w-pad*2);
  const sy = (y:number)=> (h-pad) - ((y-minY)/(maxY-minY||1))*(h-pad*2);

  return (
    <div className="mutebox">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Quality vs Cost</div>
        <div className="small">higher is better · left is cheaper</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 140 }}>
        <line x1={pad} y1={h-pad} x2={w-pad} y2={h-pad} stroke="currentColor" opacity="0.25" />
        <line x1={pad} y1={pad} x2={pad} y2={h-pad} stroke="currentColor" opacity="0.25" />
        {points.map(p => (
          <g key={p.label}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={6} fill="currentColor" opacity={p.provider === "OpenAI" ? 0.55 : 0.25} />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill="currentColor" opacity={0.9} />
          </g>
        ))}
      </svg>
      <div className="row small" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span>cheap</span><span>expensive</span>
      </div>
    </div>
  );
}

function ModePills({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="seg">
      {([{ k: "text", label: "Text" }, { k: "image", label: "Image" }, { k: "video", label: "Video" }] as const).map(x => (
        <button key={x.k} onClick={() => setMode(x.k)} className={mode === x.k ? "active" : ""}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

function BudgetSlider({ budget, setBudget }: { budget: number; setBudget: (v: number) => void }) {
  const marks = [10, 50, 200, 1000];
  const idx = useMemo(() => marks.reduce((best, m, j) => Math.abs(m-budget) < Math.abs(marks[best]-budget) ? j : best, 0), [budget]);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="row"><span style={{ fontWeight: 700 }}>Monthly budget</span></div>
        <span className="chip mono">{money(budget)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={1}
        value={idx}
        onChange={(e) => setBudget(marks[Number(e.target.value)] ?? 50)}
        style={{ width: "100%" }}
      />
      <div className="row small" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span>$10</span><span>$50</span><span>$200</span><span>$1k</span>
      </div>
    </div>
  );
}

function OutputCard({ title, mode, contender, reveal }: { title: string; mode: Mode; contender: Contender; reveal: boolean }) {
  return (
    <div className="card">
      <div className="card-h">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <span className="chip">{reveal ? <strong>Revealed</strong> : <strong>Blind</strong>}</span>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          Latency: {(contender.latencyMs/1000).toFixed(1)}s · {reveal ? `Est cost: ${money(contender.estCostUsd)}` : "Cost hidden"}
        </div>
      </div>
      <div className="card-b">
        {mode === "text" ? (
          <div className="mutebox" style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>
            {contender.output}
          </div>
        ) : (
          <div className="mutebox" style={{ padding: 0, overflow: "hidden" }}>
            <img src={contender.output} alt={title} className="img" />
          </div>
        )}

        {reveal && (
          <div className="mutebox" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>
                {contender.provider} · <span className="mono">{contender.modelId}</span>
              </div>
              <span className="chip mono">{money(contender.estCostUsd)}</span>
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {mode === "text" && <>Usage: in {contender.usage.inputTokens} tok · out {contender.usage.outputTokens} tok</>}
              {mode === "image" && <>Usage: {contender.usage.images} image</>}
              {mode === "video" && <>Usage: {contender.usage.seconds}s video</>}
            </div>
            <CostBreakdownBar contender={contender} mode={mode} />
          </div>
        )}
      </div>
    </div>
  );
}

function HomePage({ onStart, budget, setBudget }: { onStart: (m: Mode)=>void; budget:number; setBudget:(v:number)=>void }) {
  return (
    <div className="container">
      <div className="grid grid-2">
        <div className="card">
          <div className="card-b">
            <h1 className="h1">Stop overpaying. <span className="mono">XD</span></h1>
            <p className="sub" style={{ marginTop: 10 }}>
              Blind model <b>XDuels</b> + price reveal. Compare <b>OpenAI</b> vs <b>Gemini</b> across <b>Text</b>, <b>Image</b>, and <b>Video</b>.
            </p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => onStart("text")}>Text XDuel</button>
              <button className="btn" onClick={() => onStart("image")}>Image XDuel</button>
              <button className="btn ghost" onClick={() => onStart("video")}>Video XDuel</button>
            </div>
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <BudgetSlider budget={budget} setBudget={setBudget} />
              <div className="mutebox" style={{ marginTop: 12 }}>
                <div className="small">This project is a standalone UI zip (no backend). Hook to Supabase later.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="card-h">
              <div style={{ fontWeight: 800 }}>Live highlights</div>
              <div className="small">What people pick when price is revealed.</div>
            </div>
            <div className="card-b">
              <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {[
                  { title: "Text top value", model: "gemini-2.0-flash", score: "7.2×" },
                  { title: "Image top value", model: "imagen-3-fast", score: "1.6×" },
                  { title: "Video top value", model: "veo-2-fast", score: "1.3×" },
                ].map(x => (
                  <div key={x.title} className="kpi">
                    <div className="small">{x.title}</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{x.model}</div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <span className="chip"><strong>{x.score}</strong></span>
                      <span className="small">quality/$</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <div style={{ fontWeight: 800 }}>Recent XDuels</div>
              <div className="small">Anonymized. Vote → reveal.</div>
            </div>
            <div className="card-b">
              {[
                { p: "Write an investor update with 3 bullets and a CTA", w: "A", diff: "$0.0031 vs $0.0010" },
                { p: "Generate a logo prompt: mountain A + triangle spaceship", w: "B", diff: "$0.0200 vs $0.0160" },
                { p: "Storyboard a 10s dragon summon scene", w: "B", diff: "$0.0800 vs $0.0640" },
              ].map((x, i) => (
                <div key={i} className="mutebox" style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: i ? 10 : 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.p}</div>
                    <div className="small" style={{ marginTop: 6 }}>Cost diff: {x.diff}</div>
                  </div>
                  <span className="chip">Winner <strong>{x.w}</strong></span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function XDuelPage({ initialMode, onGoLeaderboards }: { initialMode: Mode; onGoLeaderboards: ()=>void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [prompt, setPrompt] = useState<string>(
    initialMode === "text"
      ? "Write a crisp landing page headline + subheadline for a tool that ranks AI models by quality per dollar."
      : initialMode === "image"
        ? "Minimal logo: mountain-shaped 'A' + tiny triangle spaceship, premium tech, white background."
        : "10-second cinematic dragon summon: 7 glowing orbs merge into lightning dragon, dark sky, epic."
  );

  const [includeSystem, setIncludeSystem] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [xduel, setXDuel] = useState<XDuel | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [vote, setVote] = useState<"A" | "B" | "TIE" | null>(null);

  const contenderA = xduel?.contenders.find((c) => c.slot === "A");
  const contenderB = xduel?.contenders.find((c) => c.slot === "B");

  const valueWinner = useMemo(() => {
    if (!xduel) return null;
    const a = xduel.contenders[0];
    const b = xduel.contenders[1];
    if (a.estCostUsd === b.estCostUsd) return a.latencyMs <= b.latencyMs ? a.slot : b.slot;
    return a.estCostUsd <= b.estCostUsd ? a.slot : b.slot;
  }, [xduel]);

  function run() {
    setIsRunning(true);
    setReveal(false);
    setVote(null);
    setTimeout(() => {
      const fullPrompt = includeSystem ? `[system] ${systemPrompt}\n\n[user] ${prompt}` : prompt;
      setXDuel(demoXDuel(mode, fullPrompt));
      setIsRunning(false);
    }, 500);
  }

  function castVote(v: "A" | "B" | "TIE") {
    setVote(v);
    setReveal(true);
  }

  function resetXDuel() {
    setXDuel(null);
    setReveal(false);
    setVote(null);
  }

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="small">ModelXD / XDuel</div>
          <div className="row" style={{ marginTop: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{mode.toUpperCase()} XDuel</div>
            <ModePills mode={mode} setMode={(m) => { setMode(m); resetXDuel(); }} />
          </div>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={resetXDuel}>New</button>
          <button className="btn" onClick={onGoLeaderboards}>Leaderboards</button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <div style={{ fontWeight: 800 }}>Create an XDuel</div>
          <div className="small">Two anonymous contenders. Vote first. Model + price reveal after.</div>
        </div>
        <div className="card-b">
          <div className="grid" style={{ gridTemplateColumns: "1.25fr .75fr" }}>
            <div>
              <div className="small" style={{ marginBottom: 6 }}>Prompt</div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </div>
            <div className="grid">
              <div className="mutebox">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700 }}>System prompt</div>
                  <input type="checkbox" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <input value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} disabled={!includeSystem} />
                </div>
                <div className="small" style={{ marginTop: 10 }}>Optional. Kept hidden until vote.</div>
              </div>
              <button className="btn primary" onClick={run} disabled={isRunning || !prompt.trim()}>
                {isRunning ? "Running…" : "Run XDuel"}
              </button>
              <div className="mutebox">
                <div className="small">In production: Next.js calls Supabase Edge Functions → stores outputs + usage + estimated cost → returns xduelId.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {xduel && contenderA && contenderB && (
        <div style={{ marginTop: 14 }}>
          <div className="split">
            <OutputCard title="Response A" mode={mode} contender={contenderA} reveal={reveal} />
            <OutputCard title="Response B" mode={mode} contender={contenderB} reveal={reveal} />
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h">
              <div style={{ fontWeight: 800 }}>Vote</div>
              <div className="small">Vote first. Then we reveal model ID + price.</div>
            </div>
            <div className="card-b">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <button className="btn" onClick={() => castVote("A")}>Vote A</button>
                  <button className="btn" onClick={() => castVote("TIE")}>Tie</button>
                  <button className="btn" onClick={() => castVote("B")}>Vote B</button>
                </div>
                <span className="chip mono">XDuel: {xduel.id}</span>
              </div>

              {reveal && (
                <div className="mutebox" style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 800 }}>
                    {vote === "TIE" ? "You called it a tie." : `You picked ${vote}.`}
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Value winner (cheapest) is <b>{valueWinner}</b>.{" "}
                    {vote && vote !== "TIE" && valueWinner && vote !== valueWinner ? "You may be overpaying. XD" : "Nice pick."}
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn" onClick={run}>Rematch</button>
                    <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(`ModelXD XDuel ${xduel.id}: I voted ${vote}.`)}>
                      Copy Share Text
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function LeaderboardsPage() {
  const [tab, setTab] = useState<Mode>("text");
  const [view, setView] = useState<"value" | "quality">("value");
  const [budget, setBudget] = useState<number>(50);
  const [minVotes, setMinVotes] = useState<number>(20);

  const rows = useMemo(() => {
    const base = {
      text: [
        { model: "gemini-2.0-flash", provider: "Gemini", quality: 0.58, cost: 0.001, votes: 412 },
        { model: "gpt-4o-mini", provider: "OpenAI", quality: 0.62, cost: 0.0031, votes: 501 },
        { model: "gemini-2.0-pro", provider: "Gemini", quality: 0.65, cost: 0.0042, votes: 210 },
        { model: "gpt-4.1-mini", provider: "OpenAI", quality: 0.6, cost: 0.0024, votes: 189 },
      ],
      image: [
        { model: "imagen-3-fast", provider: "Gemini", quality: 0.54, cost: 0.016, votes: 233 },
        { model: "gpt-image-1", provider: "OpenAI", quality: 0.58, cost: 0.02, votes: 301 },
        { model: "imagen-3", provider: "Gemini", quality: 0.61, cost: 0.028, votes: 120 },
      ],
      video: [
        { model: "veo-2-fast", provider: "Gemini", quality: 0.52, cost: 0.064, votes: 98 },
        { model: "gpt-video-1", provider: "OpenAI", quality: 0.57, cost: 0.08, votes: 114 },
        { model: "veo-2", provider: "Gemini", quality: 0.6, cost: 0.11, votes: 44 },
      ],
    }[tab];

    const filtered = base.filter((r) => r.votes >= minVotes);
    const withValue = filtered.map((r) => ({ ...r, value: (r.quality / r.cost) * 0.001 }));
    const sorted = [...withValue].sort((a, b) => (view === "quality" ? b.quality - a.quality : b.value - a.value));
    void budget;
    return sorted;
  }, [tab, view, minVotes, budget]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="small">ModelXD / Leaderboards</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>Price-adjusted rankings</div>
          <div className="small" style={{ marginTop: 6 }}>Toggle between <b>Value</b> (quality per $) and <b>Quality</b>.</div>
        </div>
        <div className="row">
          <ModePills mode={tab} setMode={setTab} />
          <button className={view === "value" ? "btn primary" : "btn"} onClick={() => setView("value")}>Value</button>
          <button className={view === "quality" ? "btn primary" : "btn"} onClick={() => setView("quality")}>Quality</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="card">
          <div className="card-b">
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="mutebox">
                <div style={{ fontWeight: 800 }}>Filters</div>
                <div style={{ marginTop: 12 }}><BudgetSlider budget={budget} setBudget={setBudget} /></div>
                <div style={{ marginTop: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700 }}>Min votes</span>
                    <span className="chip mono">{minVotes}</span>
                  </div>
                  <input type="range" min={0} max={500} step={10} value={minVotes} onChange={(e) => setMinVotes(Number(e.target.value))} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>

              <MiniScatter points={rows.map((r) => ({ label: r.model, x: r.cost, y: r.quality, provider: r.provider }))} />
            </div>

            <div className="table" style={{ marginTop: 14 }}>
              <div className="trh">
                <div>#</div><div>Model</div><div>Provider</div><div>Quality</div><div>Avg cost</div><div>Value</div>
              </div>
              {rows.map((r, i) => (
                <div className="tr" key={r.model}>
                  <div style={{ fontWeight: 800 }}>{i+1}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.model}</div>
                    <div className="small">{r.votes} votes</div>
                  </div>
                  <div><span className="chip"><strong>{r.provider}</strong></span></div>
                  <div>{r.quality.toFixed(2)}</div>
                  <div className="mono">{money(r.cost)}</div>
                  <div><span className="chip"><strong>{clamp(Math.round(r.value*1000), 0, 9999)}</strong></span></div>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function ModelsPage() {
  const models = [
    { id: "gpt-4o-mini", provider: "OpenAI", type: "text" },
    { id: "gpt-4.1-mini", provider: "OpenAI", type: "text" },
    { id: "gpt-image-1", provider: "OpenAI", type: "image" },
    { id: "gpt-video-1", provider: "OpenAI", type: "video" },
    { id: "gemini-2.0-flash", provider: "Gemini", type: "text" },
    { id: "gemini-2.0-pro", provider: "Gemini", type: "text" },
    { id: "imagen-3-fast", provider: "Gemini", type: "image" },
    { id: "veo-2-fast", provider: "Gemini", type: "video" },
  ] as const;

  return (
    <div className="container">
      <div className="small">ModelXD / Models</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>Models (starter set)</div>
      <div className="small" style={{ marginTop: 6 }}>MVP starts with OpenAI + Gemini, across Text / Image / Video.</div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginTop: 14 }}>
        {models.map((m) => (
          <div className="card" key={m.id}>
            <div className="card-b">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono" style={{ fontWeight: 800 }}>{m.id}</span>
                <span className="chip"><strong>{m.provider}</strong></span>
              </div>
              <div className="small" style={{ marginTop: 8 }}>Type: {m.type}</div>
              <div className="small" style={{ marginTop: 10 }}>Pricing + win-rate charts live on this page in production.</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopNav({ page, onNav }: { page: Page; onNav: (p: Page) => void }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <div className="logo" onClick={() => onNav("home")} role="button" aria-label="Go home">
          <div className="logo-badge"><b>XD</b></div>
          <div>
            <div style={{ fontWeight: 900 }}>ModelXD</div>
            <div className="small">stop overpaying</div>
          </div>
        </div>

        <div className="row">
          <button className={page === "leaderboards" ? "btn primary" : "btn ghost"} onClick={() => onNav("leaderboards")}>
            Leaderboards
          </button>
          <button className={page === "xduel" ? "btn primary" : "btn ghost"} onClick={() => onNav("xduel")}>
            XDuel
          </button>
          <button className={page === "model" ? "btn primary" : "btn ghost"} onClick={() => onNav("model")}>
            Models
          </button>
          <button className="btn">Sign in</button>
        </div>
      </div>
    </div>
  );
}

export default function ModelXDPrototype() {
  const [page, setPage] = useState<Page>("home");
  const [xduelMode, setXDuelMode] = useState<Mode>("text");
  const [budget, setBudget] = useState<number>(50);

  return (
    <div>
      <TopNav page={page} onNav={setPage} />
      {page === "home" && (
        <HomePage
          budget={budget}
          setBudget={setBudget}
          onStart={(m) => {
            setXDuelMode(m);
            setPage("xduel");
          }}
        />
      )}

      {page === "xduel" && <XDuelPage initialMode={xduelMode} onGoLeaderboards={() => setPage("leaderboards")} />}
      {page === "leaderboards" && <LeaderboardsPage />}
      {page === "model" && <ModelsPage />}

      <div className="footer">
        <div className="container" style={{ paddingTop: 14, paddingBottom: 14 }}>
          ModelXD UI zip · Next.js (Vercel) + Supabase backend recommended · Plug in Supabase later.
        </div>
      </div>
    </div>
  );
}
