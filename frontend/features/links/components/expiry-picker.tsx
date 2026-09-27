"use client";

import { useState } from "react";
import { CalendarIcon, ClockIcon, InfinityIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  EXPIRY_PRESETS,
  combineDateAndTime,
  formatDateTime,
  formatRelative,
  resolveExpiry,
  type ExpiryPreset,
} from "@/features/links/expiry";
import { useNow } from "@/hooks/use-now";

type ExpiryPickerProps = {
  preset: ExpiryPreset;
  onPresetChange: (preset: ExpiryPreset) => void;
  customDate: Date | undefined;
  onCustomDateChange: (date: Date | undefined) => void;
  customTime: string;
  onCustomTimeChange: (time: string) => void;
  error?: string;
};

export function ExpiryPicker({
  preset,
  onPresetChange,
  customDate,
  onCustomDateChange,
  customTime,
  onCustomTimeChange,
  error,
}: ExpiryPickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const now = useNow(30_000);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const expiry = resolveExpiry(
    preset,
    combineDateAndTime(customDate, customTime),
    now
  );

  return (
    <div className="flex flex-col gap-2.5 text-left">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span
          id="expiry-label"
          className="text-xs font-medium text-muted-foreground sm:w-14"
        >
          Expires
        </span>
        <ToggleGroup
          aria-labelledby="expiry-label"
          variant="outline"
          size="sm"
          spacing={1.5}
          value={[preset]}
          // A single-select toggle group lets you "unpress" the active item;
          // ignore that so one preset is always selected.
          onValueChange={(value) => {
            const [next] = value as ExpiryPreset[];
            if (next) onPresetChange(next);
          }}
          className="flex-wrap"
        >
          {EXPIRY_PRESETS.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="rounded-full px-3 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
            >
              {value === "custom" && <CalendarIcon />}
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-16">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  aria-invalid={!!error}
                  className="w-40 justify-start font-normal"
                />
              }
            >
              <CalendarIcon className="text-muted-foreground" />
              {customDate
                ? customDate.toLocaleDateString(undefined, { dateStyle: "medium" })
                : "Pick a date"}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customDate}
                defaultMonth={customDate}
                disabled={{ before: startOfToday }}
                onSelect={(date) => {
                  onCustomDateChange(date);
                  setCalendarOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <Label htmlFor="expiry-time" className="sr-only">
            Expiry time
          </Label>
          <Input
            id="expiry-time"
            type="time"
            value={customTime}
            onChange={(event) => onCustomTimeChange(event.target.value)}
            aria-invalid={!!error}
            className="w-32"
          />
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive sm:pl-16">{error}</p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:pl-16">
          {preset === "never" ? (
            <>
              <InfinityIcon className="size-3.5" />
              This link won&apos;t expire.
            </>
          ) : expiry ? (
            <>
              <ClockIcon className="size-3.5" />
              Expires {formatDateTime(expiry)} · {formatRelative(expiry.getTime(), now)}
            </>
          ) : (
            <>
              <ClockIcon className="size-3.5" />
              Pick a date and time.
            </>
          )}
        </p>
      )}
    </div>
  );
}
