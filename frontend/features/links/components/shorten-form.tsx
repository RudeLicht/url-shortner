"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getExistingCodeFromConflict, shortenUrl } from "@/features/links/api";
import { ExpiryPicker } from "@/features/links/components/expiry-picker";
import { combineDateAndTime, resolveExpiry } from "@/features/links/expiry";
import { addTrackedCode, buildShortUrl } from "@/features/links/utils";
import { ApiError } from "@/lib/api/client";

const formSchema = z
  .object({
    url: z.url({
      protocol: /^https?$/,
      error: "Enter a valid http:// or https:// URL",
    }),
    expiryPreset: z.enum(["never", "1h", "1d", "7d", "30d", "custom"]),
    customDate: z.date().optional(),
    customTime: z.string(),
  })
  .refine(
    (data) => {
      if (data.expiryPreset !== "custom") return true;
      const expiry = combineDateAndTime(data.customDate, data.customTime);
      return expiry !== null && expiry.getTime() > Date.now();
    },
    {
      message: "Expiry must be a valid date in the future",
      path: ["customDate"],
    }
  );

type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = {
  url: "",
  expiryPreset: "never",
  customDate: undefined,
  customTime: "12:00",
};

/** Presets resolve relative to the moment of submitting, not of picking. */
function toRequestExpiry(values: FormValues): Date | null {
  return resolveExpiry(
    values.expiryPreset,
    combineDateAndTime(values.customDate, values.customTime),
    Date.now()
  );
}

type ShortenFormProps = {
  onCreated: () => void;
};

export function ShortenForm({ onCreated }: ShortenFormProps) {
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const [expiryPreset, customDate, customTime] = useWatch({
    control,
    name: ["expiryPreset", "customDate", "customTime"],
  });

  // Any change to the expiry choice clears its error; it's re-checked on submit.
  const clearExpiryErrors = () => clearErrors(["expiryPreset", "customDate"]);

  const onSubmit = async (values: FormValues) => {
    const expiry = toRequestExpiry(values);

    try {
      const response = await shortenUrl({
        url: values.url,
        expiry: expiry?.toISOString(),
      });

      addTrackedCode(response.short_url);
      setResult(response.short_url);
      setCopied(false);
      reset(DEFAULT_VALUES);
      onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          const existingCode = getExistingCodeFromConflict(error);
          if (existingCode) {
            addTrackedCode(existingCode);
            reset(DEFAULT_VALUES);
            setResult(existingCode);
            setCopied(false);
            onCreated();
            toast.info("This URL already has a short link", {
              description: expiry
                ? "The expiry you set wasn't applied - the existing link's expiry was kept."
                : undefined,
            });
            return;
          }
          setError("url", {
            message: error.message || "This URL has already been shortened",
          });
          return;
        }
        if (error.status === 400) {
          setError("expiryPreset", { message: error.message });
          return;
        }
        setError("root", { message: error.message });
        return;
      }
      setError("root", { message: "Something went wrong. Please try again." });
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildShortUrl(result));
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <div className="flex-1">
          <Input
            type="text"
            placeholder="Paste a long URL..."
            aria-invalid={!!errors.url}
            className="h-12 rounded-xl px-4 text-base"
            {...register("url")}
          />
          {errors.url && (
            <p className="mt-1.5 text-sm text-destructive">
              {errors.url.message}
            </p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          className="h-12 rounded-xl px-6 text-base"
        >
          {isSubmitting ? "Shortening..." : "Shorten"}
        </Button>
      </form>

      <ExpiryPicker
        preset={expiryPreset}
        onPresetChange={(value) => {
          setValue("expiryPreset", value);
          clearExpiryErrors();
        }}
        customDate={customDate}
        onCustomDateChange={(value) => {
          setValue("customDate", value);
          clearExpiryErrors();
        }}
        customTime={customTime}
        onCustomTimeChange={(value) => {
          setValue("customTime", value);
          clearExpiryErrors();
        }}
        error={errors.customDate?.message ?? errors.expiryPreset?.message}
      />

      {errors.root && (
        <p className="text-sm text-destructive">{errors.root.message}</p>
      )}

      {result && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          <span className="truncate font-mono text-sm text-foreground">
            {buildShortUrl(result)}
          </span>
          <Button variant="outline" size="sm" type="button" onClick={handleCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
