"use client";

const stats = [
  { value: "50M+", label: "Rounds analyzed" },
  { value: "140K+", label: "Demos processed" },
  { value: "38", label: "Metrics tracked" },
  { value: "<2min", label: "Processing time" },
];

export function LandingStats() {
  return (
    <section className="py-16 px-6 border-y border-border/50">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <div className="text-4xl font-display font-bold gradient-text mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
