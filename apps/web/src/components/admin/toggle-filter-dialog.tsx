"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export type ToggleFilterRow = {
  id: string;
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

type ToggleFilterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  rows: ToggleFilterRow[];
};

export function ToggleFilterDialog({
  open,
  onOpenChange,
  title,
  rows,
}: ToggleFilterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {rows.map(({ id, label, checked, onCheckedChange }) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`toggle-filter-${id}`}>{label}</Label>
              <Switch
                id={`toggle-filter-${id}`}
                checked={checked}
                onCheckedChange={onCheckedChange}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
