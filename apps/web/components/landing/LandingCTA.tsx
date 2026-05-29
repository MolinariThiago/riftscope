"use client";

import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";
import { motion } from "framer-motion";

import { fadeUp, staggerContainer, inViewport } from "./motion";

export function LandingCTA() {
  return (
    <section className="py-24 px-6">
      <motion.div
        className="max-w-4xl mx-auto"
        variants={staggerContainer(0.1)}
        initial="hidden"
        whileInView="show"
        viewport={inViewport}
      >
        <div className="glass-card rounded-2xl p-12 text-center relative overflow-hidden">
          {/* Static glow accent */}
          <div className="absolute inset-x-0 top-0 h-40 bg-glow-primary opacity-50 pointer-events-none" />

          <div className="relative z-10 space-y-6">
            <motion.h2 variants={fadeUp} className="text-3xl lg:text-4xl font-display font-bold">
              Ready to <span className="gradient-text">dominate</span> your matches?
            </motion.h2>
            <motion.p variants={fadeUp} className="text-muted-foreground text-lg max-w-lg mx-auto">
              Upload your first demo for free. No credit card required —
              results in under 2 minutes.
            </motion.p>
            <motion.div variants={fadeUp} className="flex justify-center">
              <Link
                href="/register"
                className="group inline-flex items-center gap-2.5 px-8 py-4 bg-primary text-primary-foreground rounded-lg font-bold text-base hover:bg-primary/90 transition-colors font-display"
              >
                <Upload size={18} />
                Upload your demo — it's free
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs text-muted-foreground font-mono-rs">
              SUPPORTS CS2 .DEM FILES · UP TO 200MB · AUTO-PROCESSED
            </motion.p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
