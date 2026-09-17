import { cn } from "@/lib/utils";

export function Ingot({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 32"
      className={cn("text-brass", className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M10.2 11.4 17.1 4.2h13.8l6.9 7.2-3.4 15.2H13.6z" />
      <path
        d="M10.2 11.4h27.6L36 26.6H13.6z"
        className="opacity-70"
      />
      <path d="M17.1 4.2h13.8l3.8 7.2H13.3z" className="opacity-90" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Ingot className="h-5 w-7" />
      <span className="font-display text-xl tracking-tight text-fg">Goldroom</span>
    </span>
  );
}
