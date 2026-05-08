export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Right: Brand panel */}
      <div className="hidden lg:flex flex-1 bg-surface border-l border-border flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-30" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-glow-primary pointer-events-none" />

        <div className="relative z-10 text-center space-y-6 max-w-sm">
          {/* Logo */}
          <div className="font-display font-bold text-5xl tracking-tight">
            <span className="gradient-text">RIFT</span>
            <span className="text-foreground/80">SCOPE</span>
          </div>

          <p className="text-muted-foreground text-lg leading-relaxed">
            The most advanced CS2 demo analytics platform. See every angle, win every round.
          </p>

          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            {[
              "✦ Interactive heatmaps & round timelines",
              "✦ ADR, KAST, Rating 2.0 per player",
              "✦ Economy analysis & clutch tracker",
              "✦ Results in under 2 minutes",
            ].map((f) => (
              <div key={f} className="text-left">{f}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
