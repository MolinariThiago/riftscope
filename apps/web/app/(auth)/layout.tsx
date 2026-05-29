import { Check } from "lucide-react";

const features = [
  "Interactive heatmaps & round timelines",
  "ADR, KAST, Rating 2.0 per player",
  "Economy analysis & clutch tracker",
  "Results in under 2 minutes",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Left: Form */}
      <div className="relative flex-1 flex items-center justify-center p-8">
        <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
        <div className="relative z-10 w-full max-w-md">{children}</div>
      </div>

      {/* Right: Brand panel */}
      <div className="hidden lg:flex flex-1 bg-surface border-l border-border flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-25" />

        <div className="relative z-10 text-center space-y-8 max-w-sm">
          {/* Logo */}
          <div className="space-y-4">
            <div className="mx-auto w-14 h-14">
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <path d="M16 2L28 8V16L16 22L4 16V8L16 2Z" stroke="hsl(185 100% 52%)" strokeWidth="1.5" fill="hsl(185 100% 52% / 0.1)" />
                <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="hsl(185 100% 52%)" opacity="0.5" />
                <circle cx="16" cy="15" r="3" fill="hsl(185 100% 52%)" />
              </svg>
            </div>
            <div className="font-display font-bold text-5xl tracking-tight">
              <span className="gradient-text">RIFT</span>
              <span className="text-foreground/80">SCOPE</span>
            </div>
          </div>

          <p className="text-muted-foreground text-lg leading-relaxed">
            The most advanced CS2 demo analytics platform.
            See every angle, win every round.
          </p>

          <div className="glass-card rounded-xl p-5 text-left space-y-3">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-3 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-dim/50 flex-shrink-0">
                  <Check size={12} className="text-primary" />
                </span>
                <span className="text-foreground/90">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
