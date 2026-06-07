"use client";

// Animated tactical radar — burgundy identity.
// Pure SVG + CSS animations. 10 player dots (5 CT, 5 T) + rotating
// radar sweep. Static — no real demo data.

export function TacticalRadar() {
  return (
    <div className="relative aspect-[3/2] w-full">
      <svg
        viewBox="0 0 600 400"
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Sweep gradient — burgundy */}
          <radialGradient id="sweep-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(350 70% 33%)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="hsl(350 70% 33%)" stopOpacity="0" />
          </radialGradient>

          {/* Dot glow */}
          <radialGradient id="dot-glow-ct" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(213 100% 65%)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(213 100% 65%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dot-glow-tt" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(33 100% 64%)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(33 100% 64%)" stopOpacity="0" />
          </radialGradient>

          {/* Grid pattern */}
          <pattern
            id="radar-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0.5" cy="0.5" r="0.5" fill="hsl(350 70% 33% / 0.12)" />
          </pattern>
        </defs>

        {/* Grid background */}
        <rect width="600" height="400" fill="url(#radar-grid)" />

        {/* Range rings */}
        {[80, 140, 200, 260].map((r, i) => (
          <circle
            key={r}
            cx="300"
            cy="200"
            r={r}
            fill="none"
            stroke="hsl(350 70% 33%)"
            strokeOpacity={0.05 + i * 0.02}
            strokeWidth="1"
          />
        ))}

        {/* Cross hairs */}
        <line x1="40" y1="200" x2="560" y2="200" stroke="hsl(350 70% 33% / 0.08)" />
        <line x1="300" y1="40" x2="300" y2="360" stroke="hsl(350 70% 33% / 0.08)" />

        {/* Kill traces */}
        <g stroke="hsl(350 70% 33% / 0.25)" strokeWidth="1" strokeDasharray="3 3">
          <line x1="170" y1="280" x2="220" y2="120" />
          <line x1="430" y1="100" x2="370" y2="280" />
          <line x1="260" y1="290" x2="320" y2="150" />
        </g>

        {/* Radar sweep */}
        <g className="animate-radar-sweep">
          <line
            x1="300" y1="200" x2="300" y2="20"
            stroke="hsl(350 70% 33%)"
            strokeOpacity="0.85"
            strokeWidth="1.5"
          />
          <path
            d="M 300 200 L 300 20 A 180 180 0 0 1 425 60 Z"
            fill="url(#sweep-grad)"
          />
        </g>

        {/* CT players */}
        {CT_DOTS.map((p, i) => (
          <PlayerDot key={`ct-${i}`} x={p.x} y={p.y} side="ct" delay={p.delay} />
        ))}

        {/* T players */}
        {TT_DOTS.map((p, i) => (
          <PlayerDot key={`tt-${i}`} x={p.x} y={p.y} side="tt" delay={p.delay} />
        ))}

        {/* Bomb */}
        <g transform="translate(330 180)">
          <rect x="-5" y="-5" width="10" height="10" fill="hsl(0 80% 60% / 0.20)" stroke="hsl(0 80% 60%)" strokeWidth="1.5" />
          <circle cx="0" cy="0" r="2" fill="hsl(0 80% 60%)" className="animate-dot-pulse" style={{ animationDelay: "0.4s" }} />
        </g>

        {/* Corner ticks */}
        {CORNER_TICKS.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="hsl(350 70% 33% / 0.35)" strokeWidth="1.5" />
        ))}
      </svg>

      {/* HUD overlay */}
      <div className="absolute top-3 right-3 pointer-events-none">
        <div className="text-[9px] font-mono-rs uppercase tracking-wider text-primary/60 text-right space-y-1">
          <div>10 / 10 VIVOS</div>
          <div className="text-muted-foreground">BOMBA · PLANTADA</div>
        </div>
      </div>
    </div>
  );
}

function PlayerDot({ x, y, side, delay }: { x: number; y: number; side: "ct" | "tt"; delay: number }) {
  const ringColor = side === "ct" ? "hsl(213 100% 65%)" : "hsl(33 100% 64%)";
  const glow = side === "ct" ? "url(#dot-glow-ct)" : "url(#dot-glow-tt)";
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="18" fill={glow} />
      <circle r="4.5" fill={ringColor} className="animate-dot-pulse" style={{ animationDelay: `${delay}s` }} />
      <circle r="4.5" fill="none" stroke={ringColor} strokeOpacity="0.5" />
    </g>
  );
}

const CT_DOTS = [
  { x: 180, y: 280, delay: 0 },
  { x: 230, y: 305, delay: 0.5 },
  { x: 290, y: 320, delay: 1.0 },
  { x: 360, y: 290, delay: 1.5 },
  { x: 420, y: 270, delay: 0.2 },
];

const TT_DOTS = [
  { x: 200, y: 110, delay: 0.3 },
  { x: 260, y: 90, delay: 0.8 },
  { x: 330, y: 110, delay: 1.2 },
  { x: 390, y: 130, delay: 1.7 },
  { x: 450, y: 90, delay: 0.9 },
];

const CORNER_TICKS = [
  { x1: 30, y1: 30, x2: 30, y2: 50 },
  { x1: 30, y1: 30, x2: 50, y2: 30 },
  { x1: 570, y1: 30, x2: 570, y2: 50 },
  { x1: 570, y1: 30, x2: 550, y2: 30 },
  { x1: 30, y1: 370, x2: 30, y2: 350 },
  { x1: 30, y1: 370, x2: 50, y2: 370 },
  { x1: 570, y1: 370, x2: 570, y2: 350 },
  { x1: 570, y1: 370, x2: 550, y2: 370 },
];
