"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getExistingCodeFromConflict,
  isAliasTakenConflict,
  shortenUrl,
} from "@/features/links/api";
import { isValidAlias } from "@/features/links/alias";
import { ExpiryPicker } from "@/features/links/components/expiry-picker";
import { QrCodeDialog } from "@/features/links/components/qr-code-dialog";
import { combineDateAndTime, resolveExpiry } from "@/features/links/expiry";
import { addTrackedEntry, buildShortUrl } from "@/features/links/utils";
import { ApiError, getRateLimitMessage } from "@/lib/api/client";

const formSchema = z
  .object({
    url: z.url({
      protocol: /^https?$/,
      error: "Enter a valid http:// or https:// URL",
    }),
    alias: z.string().trim().refine((a) => a === "" || isValidAlias(a), {
      message:
        "Alias must be 3-20 letters, numbers, - or _, and not a reserved word",
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
  alias: "",
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

  const [expiryPreset, customDate, customTime, alias] = useWatch({
    control,
    name: ["expiryPreset", "customDate", "customTime", "alias"],
  });

  const trimmedAlias = (alias ?? "").trim();
  const aliasPreview =
    trimmedAlias.length > 0 && isValidAlias(trimmedAlias)
      ? buildShortUrl(trimmedAlias)
      : null;

  // Any change to the expiry choice clears its error; it's re-checked on submit.
  const clearExpiryErrors = () => clearErrors(["expiryPreset", "customDate"]);

  const onSubmit = async (values: FormValues) => {
    const expiry = toRequestExpiry(values);
    const trimmedAlias = values.alias.trim();

    try {
      const response = await shortenUrl({
        url: values.url,
        expiry: expiry?.toISOString(),
        alias: trimmedAlias.length > 0 ? trimmedAlias : undefined,
      });

      // The frontend and backend deploy independently, so an older backend
      // that predates delete tokens could omit the field entirely - guard
      // at runtime rather than trusting the response type.
      const token =
        typeof response.delete_token === "string" &&
        response.delete_token.length > 0
          ? response.delete_token
          : null;
      addTrackedEntry(response.short_url, token);
      setResult(response.short_url);
      setCopied(false);
      reset(DEFAULT_VALUES);
      onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        const rateLimitMessage = getRateLimitMessage(error);
        if (rateLimitMessage) {
          setError("root", { message: rateLimitMessage });
          return;
        }
        if (error.status === 409) {
          if (isAliasTakenConflict(error)) {
            setError("alias", { message: "That alias is already taken" });
            return;
          }
          const existingCode = getExistingCodeFromConflict(error);
          if (existingCode) {
            // A null token here never downgrades a token this browser
            // already owns; the returned value is whatever was stored for
            // this code *before* this call, so it tells apart "already in
            // your list" (owned or not) from "brand new to this browser"
            // without a second read of storage.
            const previousEntry = addTrackedEntry(existingCode, null);
            reset(DEFAULT_VALUES);
            setResult(existingCode);
            setCopied(false);
            onCreated();
            // The backend checks URL uniqueness before the alias, so a
            // submitted alias is silently ignored on this path - make sure
            // that's said explicitly, alongside the expiry note.
            const expiryNote = expiry
              ? "The expiry you set wasn't applied - the existing link's expiry was kept."
              : null;
            const aliasNote =
              trimmedAlias.length > 0 && trimmedAlias !== existingCode
                ? `Your custom alias "${trimmedAlias}" was not created.`
                : null;
            if (previousEntry) {
              const description = [expiryNote, aliasNote].filter(Boolean).join(" ");
              toast.info("This URL already has a short link", {
                description: description.length > 0 ? description : undefined,
              });
            } else {
              const description =
                "It's been added to your list as read-only - you won't be able to delete it." +
                [expiryNote, aliasNote].map((note) => (note ? ` ${note}` : "")).join("");
              toast.info("This URL was already shortened by someone else", {
                description,
              });
            }
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
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
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
        </div>

        <div>
          <Label htmlFor="alias">Custom alias</Label>
          <Input
            id="alias"
            type="text"
            placeholder="my-link"
            aria-invalid={!!errors.alias}
            className="mt-1"
            {...register("alias")}
          />
          {errors.alias ? (
            <p className="mt-1.5 text-sm text-destructive">
              {errors.alias.message}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Optional, 3-20 letters, numbers, - or _
            </p>
          )}
          {aliasPreview && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {aliasPreview}
            </p>
          )}
        </div>
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
          <div className="flex shrink-0 items-center gap-1">
            <QrCodeDialog code={result} />
            <Button variant="outline" size="sm" type="button" onClick={handleCopy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
