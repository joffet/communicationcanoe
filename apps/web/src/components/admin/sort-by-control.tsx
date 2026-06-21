"use client";

import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type SortOption<T extends string = string> = {
  value: T;
  label: React.ReactNode;
};

export type SortByControlProps<T extends string = string> = {
  value: T;
  direction: "asc" | "desc";
  onChange: (field: T, direction: "asc" | "desc") => void;
  options: SortOption<T>[];
  label?: string;
  className?: string;
};

function handleSortChange<T extends string>(
  currentValue: T,
  currentDirection: "asc" | "desc",
  newValue: T | undefined,
  onChange: (field: T, direction: "asc" | "desc") => void,
) {
  if (newValue) {
    if (currentValue === newValue) {
      onChange(newValue, currentDirection === "asc" ? "desc" : "asc");
    } else {
      onChange(newValue, "asc");
    }
  } else {
    onChange(currentValue, currentDirection === "asc" ? "desc" : "asc");
  }
}

export function SortByControl<T extends string = string>({
  value,
  direction,
  onChange,
  options,
  label = "Sort",
  className,
}: SortByControlProps<T>) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ArrowUpDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) =>
          handleSortChange(value, direction, v as T | undefined, onChange)
        }
        className="flex-wrap"
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
            {option.label}
            {value === option.value ? (direction === "asc" ? " ↑" : " ↓") : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
