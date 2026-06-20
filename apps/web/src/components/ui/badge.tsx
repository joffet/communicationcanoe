import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" | "outline" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "default" && "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
        variant === "secondary" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        variant === "outline" && "border border-zinc-200 text-zinc-600 dark:border-zinc-700",
        className,
      )}
      {...props}
    />
  );
}
