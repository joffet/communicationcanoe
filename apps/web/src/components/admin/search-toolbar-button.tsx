"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchToolbarButtonProps = {
  active: boolean;
  onToggle: () => void;
};

export function SearchToolbarButton({ active, onToggle }: SearchToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onToggle}
      aria-pressed={active}
    >
      <Search className="size-4" />
      Search
    </Button>
  );
}

type ToolbarSearchFieldRowProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  className?: string;
};

export function ToolbarSearchFieldRow({
  value,
  onChange,
  inputRef,
  placeholder = "Search…",
  className,
}: ToolbarSearchFieldRowProps) {
  return (
    <div className={cn("w-full", className)}>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
      />
    </div>
  );
}
