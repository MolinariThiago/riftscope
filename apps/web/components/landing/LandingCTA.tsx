import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";

export function LandingCTA() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <div className="glass-card border-glow rounded-2xl p-12 relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute inset-0 bg-glow-primary opacity-50 pointer-events-none" />

          <div className="relative z-10 space-y-6">
            <h2 className="text-4xl lg:text-5xl font-display font-bold">
              Ready to <span className="gradient-text">dominate</span> your matches?
            </h2>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">
              Upload your first demo for free. No credit card required.
              Results in under 2 minutes.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/register"
                className="group inline-flex items-center gap-2.5 px-8 py-4 bg-primary text-primary-foreground rounded-lg font-bold text-base hover:bg-primary/90 transition-all duration-200 glow-primary font-display"
              >
                <Upload size={18} />
                Upload your demo — it's free
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
            <p className="text-xs text-muted-foreground font-mono-rs">
              SUPPORTS CS2 .DEM FILES • UP TO 200MB • AUTO-PROCESSED
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
