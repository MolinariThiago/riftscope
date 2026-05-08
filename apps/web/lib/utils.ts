import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function getRatingColor(rating: number): string {
  if (rating >= 1.2) return "text-win";
  if (rating >= 1.0) return "text-primary";
  if (rating >= 0.85) return "text-foreground";
  return "text-loss";
}
