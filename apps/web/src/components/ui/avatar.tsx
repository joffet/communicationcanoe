import { cn } from "@/lib/utils";

export function Avatar({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const initials = (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100",
        className,
      )}
    >
      {initials}
    </div>
  );
}
