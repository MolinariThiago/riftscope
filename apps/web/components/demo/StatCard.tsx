import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color?: string;
  subtitle?: string;
}

export function StatCard({ label, value, icon: Icon, color = "text-primary", subtitle }: StatCardProps) {
  return (
    <div className="glass-card p-4 rounded-xl space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono-rs uppercase tracking-wider">{label}</span>
        <Icon size={14} className={color} />
      </div>
      <div className={`text-2xl font-display font-bold stat-value ${color}`}>{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  );
}
