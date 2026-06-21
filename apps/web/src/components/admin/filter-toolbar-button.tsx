"use client";

import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type FilterToolbarButtonProps = {
  nonDefaultCount: number;
  onOpen: () => void;
};

export function FilterToolbarButton({
  nonDefaultCount,
  onOpen,
}: FilterToolbarButtonProps) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onOpen}>
      <Filter className="size-4" />
      Filter
      {nonDefaultCount > 0 ? (
        <Badge variant="secondary" className="ml-1">
          {nonDefaultCount}
        </Badge>
      ) : null}
    </Button>
  );
}
