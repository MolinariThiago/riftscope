"use client";

import { Check, Link2, RotateCcw } from "lucide-react";

import { LayersPanel } from "@/components/replay/LayersPanel";
import { useT } from "@/lib/i18n/useT";
import {
  type Density,
  type Locale,
  type PlaybackSpeedDefault,
  type ThemeName,
  useSettings,
} from "@/lib/stores/settings";
import { cn } from "@/lib/utils";

const THEMES: { name: ThemeName; label: string; swatch: [string, string, string] }[] = [
  { name: "tactical-dark", label: "Tactical Dark", swatch: ["#0d1320", "#0DDDE8", "#7c3aed"] },
  { name: "hltv-classic",  label: "HLTV Classic",  swatch: ["#f4f5f7", "#f17a13", "#1c4d8e"] },
  { name: "minimal-pro",   label: "Minimal Pro",   swatch: ["#fafafa", "#3357df", "#a854f0"] },
  { name: "light",         label: "Light",         swatch: ["#ffffff", "#0d8a96", "#7d3dc7"] },
];

const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: "es", label: "Español (Latam)", flag: "🇦🇷" },
  { code: "en", label: "English",         flag: "🇺🇸" },
  { code: "pt", label: "Português (BR)",  flag: "🇧🇷" },
];

const SPEEDS: PlaybackSpeedDefault[] = [0.5, 1, 2, 4];

export default function SettingsPage() {
  const t = useT();
  const s = useSettings();

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-display font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("settings.subtitle")}</p>
      </div>

      {/* DISPLAY */}
      <Section title={t("settings.sections.display")}>
        <Field label={t("settings.theme")}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {THEMES.map((th) => {
              const active = s.theme === th.name;
              return (
                <button
                  key={th.name}
                  onClick={() => s.set("theme", th.name)}
                  className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    active
                      ? "border-primary bg-primary-dim/30"
                      : "border-border hover:border-border/80 bg-surface-elevated",
                  )}
                >
                  <div className="flex gap-1 mb-2">
                    {th.swatch.map((c, i) => (
                      <div
                        key={i}
                        className="h-4 flex-1 rounded-sm"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{th.label}</span>
                    {active && <Check size={12} className="text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("settings.language")}>
          <div className="flex flex-wrap gap-2">
            {LOCALES.map((loc) => {
              const active = s.locale === loc.code;
              return (
                <button
                  key={loc.code}
                  onClick={() => s.set("locale", loc.code)}
                  className={cn(
                    "px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-all",
                    active
                      ? "border-primary bg-primary-dim/30 text-foreground"
                      : "border-border bg-surface-elevated text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{loc.flag}</span>
                  {loc.label}
                  {active && <Check size={12} className="text-primary" />}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("settings.density")}>
          <Segmented
            value={s.density}
            onChange={(v) => s.set("density", v as Density)}
            options={[
              { value: "comfortable", label: t("settings.densityComfortable") },
              { value: "compact",     label: t("settings.densityCompact") },
            ]}
          />
        </Field>
      </Section>

      {/* REPLAY */}
      <Section title={t("settings.sections.replay")}>
        <Field label={t("settings.defaultSpeed")}>
          <Segmented
            value={String(s.defaultPlaybackSpeed)}
            onChange={(v) => s.set("defaultPlaybackSpeed", Number(v) as PlaybackSpeedDefault)}
            options={SPEEDS.map((sp) => ({ value: String(sp), label: `${sp}×` }))}
          />
        </Field>

        <Field label={t("settings.killFeedFade")}>
          <input
            type="range"
            min={2}
            max={15}
            step={1}
            value={s.killFeedFadeSeconds}
            onChange={(e) => s.set("killFeedFadeSeconds", Number(e.target.value))}
            className="w-full max-w-xs"
          />
          <span className="ml-3 font-mono-rs text-sm text-muted-foreground">
            {s.killFeedFadeSeconds}s
          </span>
        </Field>

        <Field label={t("settings.autoPauseOnKill")}>
          <Toggle value={s.autoPauseOnKill} onChange={(v) => s.set("autoPauseOnKill", v)} />
        </Field>

        <Field label={t("settings.defaultLayers")}>
          <div className="max-w-md">
            <LayersPanel layers={s.defaultLayers} onChange={s.setLayers} />
          </div>
        </Field>
      </Section>

      {/* NOTIFICATIONS */}
      <Section title={t("settings.sections.notifications")}>
        <Field label={t("settings.notifyDemo")}>
          <Toggle value={s.notifyOnDemoComplete} onChange={(v) => s.set("notifyOnDemoComplete", v)} />
        </Field>
        <Field label={t("settings.notifyPro")}>
          <Toggle value={s.notifyOnNewProMatch} onChange={(v) => s.set("notifyOnNewProMatch", v)} />
        </Field>
      </Section>

      {/* PRIVACY */}
      <Section title={t("settings.sections.privacy")}>
        <Field label={t("settings.profileVisibility")}>
          <Segmented
            value={s.profileVisibility}
            onChange={(v) => s.set("profileVisibility", v as typeof s.profileVisibility)}
            options={[
              { value: "public",  label: t("settings.visibilityPublic") },
              { value: "friends", label: t("settings.visibilityFriends") },
              { value: "private", label: t("settings.visibilityPrivate") },
            ]}
          />
        </Field>
        <Field label={t("settings.showLeaderboards")}>
          <Toggle value={s.showInLeaderboards} onChange={(v) => s.set("showInLeaderboards", v)} />
        </Field>
      </Section>

      {/* INTEGRATIONS */}
      <Section title={t("settings.sections.integrations")}>
        <IntegrationRow
          name="Steam"
          help={t("settings.steamHelp")}
          linked={s.steamLinked}
          onConnect={() => s.set("steamLinked", true)}
          onDisconnect={() => s.set("steamLinked", false)}
        />
        <IntegrationRow
          name="Faceit"
          help={t("settings.faceitHelp")}
          linked={s.faceitLinked}
          onConnect={() => s.set("faceitLinked", true)}
          onDisconnect={() => s.set("faceitLinked", false)}
        />
        <Field label="HLTV profile URL">
          <input
            type="url"
            placeholder="https://www.hltv.org/player/123/example"
            value={s.hltvProfileUrl ?? ""}
            onChange={(e) => s.set("hltvProfileUrl", e.target.value || null)}
            className="w-full max-w-md bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
          />
          <p className="text-[11px] text-muted-foreground mt-1">{t("settings.hltvHelp")}</p>
        </Field>
      </Section>

      {/* RESET */}
      <div className="pt-4 border-t border-border">
        <button
          onClick={() => {
            if (confirm("Reset all settings to defaults?")) s.reset();
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors"
        >
          <RotateCcw size={14} />
          {t("settings.resetAll")}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Pieces
// =========================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 sm:items-start">
      <label className="text-sm font-medium pt-1.5">{label}</label>
      <div className="flex items-center flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden bg-surface-elevated">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 text-sm transition-colors",
            value === opt.value
              ? "bg-primary-dim text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors",
        value ? "bg-primary" : "bg-surface-elevated border border-border",
      )}
    >
      <div
        className={cn(
          "absolute top-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform",
          value ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function IntegrationRow({
  name,
  help,
  linked,
  onConnect,
  onDisconnect,
}: {
  name: string;
  help: string;
  linked: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-surface-elevated/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary-dim flex items-center justify-center">
          <Link2 size={14} className="text-primary" />
        </div>
        <div>
          <div className="text-sm font-semibold">{name}</div>
          <div className="text-[11px] text-muted-foreground">{help}</div>
        </div>
      </div>
      {linked ? (
        <button
          onClick={onDisconnect}
          className="px-3 py-1.5 text-xs rounded-md border border-border hover:border-loss hover:text-loss transition-colors"
        >
          {t("common.disconnect")}
        </button>
      ) : (
        <button
          disabled
          title={t("common.comingSoon")}
          className="px-3 py-1.5 text-xs rounded-md bg-muted/50 text-muted-foreground cursor-not-allowed"
        >
          {t("common.comingSoon")}
        </button>
      )}
    </div>
  );
}
