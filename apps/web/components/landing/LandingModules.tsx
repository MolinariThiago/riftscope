"use client";

// Landing modules — Spanish copy, coach/analyst targeted.
// No technical details, no admin features, only user benefits.

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Crosshair,
  Filter,
  Layers,
  Library,
  ListChecks,
  Map,
  PenTool,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { fadeUp, staggerContainer, inViewport } from "./motion";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------
function SectionShell({
  tag,
  title,
  lede,
  children,
}: {
  tag: string;
  title: React.ReactNode;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-24 px-6 border-t border-border/30">
      <motion.div
        className="max-w-6xl mx-auto"
        variants={staggerContainer(0.08)}
        initial="hidden"
        whileInView="show"
        viewport={inViewport}
      >
        <motion.div variants={fadeUp} className="max-w-2xl mb-12">
          <span className="inline-flex items-center gap-2 mb-3 text-[11px] font-mono-rs uppercase tracking-wider text-primary">
            <span className="h-px w-8 bg-primary" />
            {tag}
          </span>
          <h2 className="text-3xl lg:text-4xl font-display font-bold mb-3">
            {title}
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">{lede}</p>
        </motion.div>
        {children}
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Module card
// ---------------------------------------------------------------------------
function ModuleCard({
  icon: Icon,
  title,
  desc,
  tone = "primary",
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  tone?: "primary" | "accent" | "win" | "ct" | "tt";
}) {
  const toneClass: Record<string, string> = {
    primary: "text-primary bg-primary-dim",
    accent: "text-accent bg-accent/10",
    win: "text-win bg-win/10",
    ct: "text-ct bg-ct-dim",
    tt: "text-tt bg-tt-dim",
  };
  return (
    <motion.div
      variants={fadeUp}
      className="glass-card card-glow rounded-xl p-5"
    >
      <div className={cn("inline-flex p-2 rounded-lg mb-3", toneClass[tone])}>
        <Icon size={16} />
      </div>
      <h3 className="font-display font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </motion.div>
  );
}

// ===========================================================================
// NOVEDADES
// ===========================================================================
export function LandingWhatsNew() {
  const items = [
    {
      badge: "NUEVO",
      title: "Leaderboards (beta)",
      desc: "Ranking de los mejores jugadores pro con rating real. Filtrá por mapa, ventana de tiempo y rondas mínimas para encontrar quién está en forma ahora.",
    },
    {
      badge: "NUEVO",
      title: "Series Bo3 / Bo5 completas",
      desc: "Las tarjetas de series se expanden para mostrar cada mapa jugado. Cada uno con su botón de Ver en 2D, sin tener que buscar mapas sueltos.",
    },
    {
      badge: "MEJORA",
      title: "Stats reales del demo",
      desc: "Daño, KAST, asistencias y utilidad medidos directamente del demo, no estimados. Los números coinciden con lo que reporta HLTV para el mismo partido.",
    },
    {
      badge: "NUEVO",
      title: "Filtros por mapa, equipo y evento",
      desc: "El feed pro ahora tiene filtros para acotar a un equipo específico en un mapa específico. Ideal para preparar rivales.",
    },
  ];
  return (
    <SectionShell
      tag="NOVEDADES"
      title={
        <>
          Lo último en <span className="gradient-text">RIFTSCOPE.</span>
        </>
      }
      lede="Las mejoras más recientes — directo a lo que cambió para vos."
    >
      <div className="space-y-3">
        {items.map((it) => (
          <motion.div
            key={it.title}
            variants={fadeUp}
            className="glass-card rounded-lg p-4 flex items-start gap-4"
          >
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono-rs uppercase tracking-wider flex-shrink-0 mt-0.5",
                it.badge === "NUEVO"
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-surface-elevated text-muted-foreground border border-border",
              )}
            >
              {it.badge}
            </span>
            <div>
              <h3 className="font-display font-semibold text-base mb-1">
                {it.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {it.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// PARTIDOS PRO
// ===========================================================================
export function LandingProMatches() {
  return (
    <SectionShell
      tag="PARTIDOS PRO"
      title={
        <>
          Todos los partidos pro, <span className="gradient-text">listos para analizar.</span>
        </>
      }
      lede="Un feed curado de partidos profesionales de CS2 que podés abrir en 2D con un click. Sin buscar demos, sin torrents."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={Trophy}
          tone="primary"
          title="Siempre actualizado"
          desc="El feed se actualiza automáticamente con los partidos más recientes: finales, temporada regular, clasificatorias."
        />
        <ModuleCard
          icon={Star}
          tone="accent"
          title="Majors primero"
          desc="Ordenado por importancia. Los Majors y finales tier-1 siempre están arriba para que encuentres rápido lo que importa."
        />
        <ModuleCard
          icon={Layers}
          tone="primary"
          title="Bo3 / Bo5 expandido"
          desc="Las series muestran cada mapa con su estado y botón de Ver en 2D. No hace falta buscar mapas individuales."
        />
        <ModuleCard
          icon={Filter}
          tone="accent"
          title="Filtros que sirven"
          desc="Filtrá por mapa, equipo o torneo. Combiná filtros para encontrar exactamente la serie que necesitás preparar."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="Análisis inmediato"
          desc="Un partido importado y parseado aparece listo para ver. Entrá al visor 2D al instante."
        />
        <ModuleCard
          icon={Zap}
          tone="tt"
          title="Diseñado para coaches"
          desc="Los contadores en la parte superior te dicen cuántos partidos están listos, cuántos en cola, y cuántos hay en total."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// LEADERBOARDS
// ===========================================================================
export function LandingLeaderboards() {
  return (
    <SectionShell
      tag="LEADERBOARDS"
      title={
        <>
          Los mejores jugadores, <span className="gradient-text">rankeados con datos reales.</span>
        </>
      }
      lede="Un ranking unificado de cada partido pro en la plataforma. La misma métrica que reconoce la comunidad — rating, ADR, K/D, KAST — calculada desde el demo."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ModuleCard
          icon={BarChart3}
          tone="primary"
          title="La métrica que conocés"
          desc="Rating estilo HLTV, reproducible y comparable con cualquier sitio de estadísticas de CS2."
        />
        <ModuleCard
          icon={Map}
          tone="accent"
          title="Ranking por mapa"
          desc="Barra de mapas del pool activo. Encontrá al mejor jugador de Mirage, el mejor AWP de Anubis, la entrada más limpia de Inferno."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="Forma vs histórico"
          desc="Ventanas de 30d / 90d / 12m / Todo el tiempo. Alterná entre forma actual y leyendas históricas sin salir de la página."
        />
        <ModuleCard
          icon={Sparkles}
          tone="primary"
          title="Muestra real"
          desc="Slider de rondas mínimas para filtrar jugadores con pocas apariciones. Hay que jugar para rankear."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// PIZARRA TÁCTICA
// ===========================================================================
export function LandingTactical() {
  return (
    <SectionShell
      tag="PIZARRA TÁCTICA"
      title={
        <>
          Dibujalo, <span className="gradient-text">guardalo, ejecutalo.</span>
        </>
      }
      lede="Una pizarra top-down con los mapas reales de CS2. Posicioná jugadores, dibujá rotaciones, armá ejecuciones — y guardalo todo en tu playbook."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={PenTool}
          tone="primary"
          title="Mapas reales, vista aérea"
          desc="Elegí un mapa, colocá los cinco jugadores por lado. Colores por equipo para que el diagrama se lea al instante."
        />
        <ModuleCard
          icon={Target}
          tone="tt"
          title="Radio de utilidad real"
          desc="Los marcadores de humo, flash y molotov se renderizan con el área real que cubren en ese mapa."
        />
        <ModuleCard
          icon={ListChecks}
          tone="primary"
          title="Paso a paso"
          desc="Una táctica es una secuencia: setup → humos → entrada. Agregá frames para capturar cada momento sin redibujar."
        />
        <ModuleCard
          icon={Library}
          tone="accent"
          title="Guardado en tu playbook"
          desc="Guardá tácticas terminadas en carpetas con tags (mapa, lado, anti-eco, ejecución A). Buscá después por nombre o tag."
        />
        <ModuleCard
          icon={Crosshair}
          tone="ct"
          title="Desde rondas reales"
          desc="¿Encontraste una ronda en el visor que vale recordar? Capturala directamente como táctica — posiciones y utilidad se cargan solas."
        />
        <ModuleCard
          icon={Trophy}
          tone="primary"
          title="Hecho para equipos"
          desc="Un playbook compartido para tu equipo. Todos referencian los mismos diagramas en la práctica. Sin más 'la jugada que hicimos la semana pasada'."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// FAQ
// ===========================================================================
const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Qué demos puedo subir?",
    a: "Cualquier demo estándar de CS2 (.dem) — matchmaking, FACEIT, ESEA, o un demo pro que hayas descargado. Los archivos de series con múltiples mapas también funcionan: cada mapa se analiza por separado.",
  },
  {
    q: "¿Cuánto tarda en estar listo?",
    a: "Normalmente entre 2 y 10 minutos por mapa, dependiendo de la duración. Un Bo3 típico termina en unos 15-25 minutos. Vas a ver el progreso en vivo mientras se procesa.",
  },
  {
    q: "¿Es gratis?",
    a: "Sí, RIFTSCOPE es gratis durante la beta. Los partidos pro están analizados y listos para ver sin costo. Los planes pagos llegarán cuando la biblioteca esté completa.",
  },
  {
    q: "¿De dónde salen los partidos pro?",
    a: "De demos reales de torneos — Majors, finales regionales, ligas, copas online. Los partidos nuevos se agregan automáticamente a medida que terminan los eventos.",
  },
  {
    q: "¿Qué significa el rating?",
    a: "Es el rating estándar de CS2 que ya conocés de sitios como HLTV. Mayor es mejor; alrededor de 1.00 es promedio y más de 1.10 es fuerte. Calculado desde datos reales del demo.",
  },
  {
    q: "¿Mis demos privados son visibles para otros?",
    a: "No. Un demo que subís es solo tuyo — únicamente tu cuenta puede verlo. Los partidos pro son públicos porque son eventos públicos.",
  },
  {
    q: "¿Puedo compartir una ronda o clutch específico?",
    a: "Los links por ronda están en camino. El visor ya sabe saltar a una ronda específica; estamos armando eso como una URL compartible con preview para Discord.",
  },
];

export function LandingFAQ() {
  return (
    <SectionShell
      tag="PREGUNTAS FRECUENTES"
      title={
        <>
          Preguntas <span className="gradient-text">comunes.</span>
        </>
      }
      lede="Respuestas directas. Si falta algo, escribinos."
    >
      <div className="space-y-2">
        {FAQ.map((item, i) => (
          <FAQItem key={item.q} q={item.q} a={item.a} defaultOpen={i === 0} />
        ))}
      </div>
      <motion.p
        variants={fadeUp}
        className="mt-10 text-sm text-muted-foreground"
      >
        ¿Buscás la guía completa?{" "}
        <Link href="/docs" className="text-primary hover:underline inline-flex items-center gap-1">
          Ir a los docs
          <ArrowRight size={12} />
        </Link>
      </motion.p>
    </SectionShell>
  );
}

function FAQItem({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(!!defaultOpen);
  return (
    <motion.div variants={fadeUp} className="glass-card rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-surface-elevated/40 transition-colors"
      >
        <span className="font-semibold text-sm">{q}</span>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
          {a}
        </div>
      )}
    </motion.div>
  );
}
