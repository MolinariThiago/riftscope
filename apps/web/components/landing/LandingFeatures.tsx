"use client";

import {
  Map,
  BarChart3,
  Clock,
  DollarSign,
  Target,
  Shield,
  Flame,
  ScanSearch,
  Award,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";

import { fadeUp, staggerContainer, inViewport } from "./motion";

type Feature = {
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
  bg: string;
};

const features: Feature[] = [
  {
    icon: Map,
    title: "Heatmaps interactivos",
    desc: "Ubicaciones de kills, humos, flashes y caminos de movimiento renderizados directamente sobre el mapa.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: Clock,
    title: "Timeline por ronda",
    desc: "Reproducí cada ronda con precisión por segundo — kills, planteos y utilidad de un vistazo.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: BarChart3,
    title: "Stats avanzados",
    desc: "ADR, KAST, HS%, Rating 2.0, duelos de apertura, multi-kills y rendimiento en clutches.",
    color: "text-win",
    bg: "bg-win/10",
  },
  {
    icon: DollarSign,
    title: "Análisis económico",
    desc: "Seguí la economía del equipo por ronda: full buy, eco, force buy y manejo del dinero.",
    color: "text-tt",
    bg: "bg-tt-dim",
  },
  {
    icon: Target,
    title: "Entradas y aperturas",
    desc: "Identificá a tus mejores entry fraggers y el impacto del first blood en los resultados de ronda.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: Shield,
    title: "Rendimiento en clutch",
    desc: "Todas las situaciones 1vX rastreadas: tasa de éxito, condiciones y momentos de alto impacto.",
    color: "text-ct",
    bg: "bg-ct-dim",
  },
  {
    icon: Flame,
    title: "Análisis de utilidad",
    desc: "Efectividad de humos, flash assists, daño de HE y control de zona con molotovs.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: ScanSearch,
    title: "Buscador de jugadores",
    desc: "Encontrá cualquier jugador en tus demos y compará a dos jugadores lado a lado.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: Award,
    title: "Rating por partido",
    desc: "Ratings de rendimiento individual y por equipo con scoring de impacto contextual.",
    color: "text-win",
    bg: "bg-win/10",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="py-24 px-6 border-t border-border/30">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl mb-12">
          <div className="inline-flex items-center gap-2 mb-3 text-[11px] font-mono-rs uppercase tracking-wider text-primary">
            <span className="h-px w-8 bg-primary" />
            FUNCIONES
          </div>
          <h2 className="text-3xl lg:text-4xl font-display font-bold mb-3">
            Cada dato que <span className="gradient-text">importa.</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            De kills crudos a patrones estratégicos — RIFTSCOPE extrae la
            inteligencia que necesitás para mejorar.
          </p>
        </div>

        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer(0.06)}
          initial="hidden"
          whileInView="show"
          viewport={inViewport}
        >
          {features.map((feature, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="group glass-card p-5 hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className={`w-10 h-10 rounded-lg ${feature.bg} flex items-center justify-center mb-4`}>
                <feature.icon size={18} className={feature.color} />
              </div>
              <h3 className="font-display font-bold text-base mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
