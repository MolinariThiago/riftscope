"use client";

import Link from "next/link";
import { ArrowRight, Shield } from "lucide-react";
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
          {/* Burgundy glow */}
          <div className="absolute inset-x-0 top-0 h-40 bg-primary/10 blur-[60px] pointer-events-none" />

          <div className="relative z-10 space-y-6">
            <motion.h2 variants={fadeUp} className="text-3xl lg:text-4xl font-display font-bold">
              Empezá a preparar <span className="gradient-text">tu próximo partido.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="text-muted-foreground text-lg max-w-lg mx-auto">
              Subí tu primer demo gratis. Sin tarjeta de crédito &mdash;
              resultados en menos de 2 minutos.
            </motion.p>
            <motion.div variants={fadeUp} className="flex justify-center">
              <Link
                href="/login"
                className="group inline-flex items-center gap-2.5 px-8 py-4 bg-primary text-primary-foreground rounded-lg font-bold text-base hover:bg-primary/90 transition-colors font-display"
              >
                <Shield size={18} />
                Ingresar con Steam &mdash; es gratis
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs text-muted-foreground font-mono-rs">
              SOPORTA ARCHIVOS .DEM DE CS2 &middot; HASTA 200MB &middot; PROCESADO AUTOMÁTICO
            </motion.p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
