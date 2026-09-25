"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getExistingCodeFromConflict, shortenUrl } from "@/features/links/api";
import { addTrackedCode, buildShortUrl } from "@/features/links/utils";
import { ApiError } from "@/lib/api/client";

const formSchema = z
  .object({
    url: z.url({
      protocol: /^https?$/,
      error: "Enter a valid http:// or https:// URL",
    }),
    expiry: z.string().optional(),
  })
  .refine(
    (data) => {
      if (!data.expiry) return true;
      const date = new Date(data.expiry);
      return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
    },
    {
      message: "Expiry must be a valid date in the future",
      path: ["expiry"],
    }
  );

type FormValues = z.infer<typeof formSchema>;

type ShortenFormProps = {
  onCreated: () => void;
};

export function ShortenForm({ onCreated }: ShortenFormProps) {
  const [showExpiry, setShowExpiry] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { url: "", expiry: "" },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      const response = await shortenUrl({
        url: values.url,
        expiry: values.expiry
          ? new Date(values.expiry).toISOString()
          : undefined,
      });

      addTrackedCode(response.short_url);
      setResult(response.short_url);
      setCopied(false);
      reset({ url: "", expiry: "" });
      setShowExpiry(false);
      onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          const existingCode = getExistingCodeFromConflict(error);
          if (existingCode) {
            addTrackedCode(existingCode);
            reset({ url: "", expiry: "" });
            setShowExpiry(false);
            setResult(existingCode);
            setCopied(false);
            onCreated();
            toast.info("This URL already has a short link", {
              description: values.expiry
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
          setError("expiry", { message: error.message });
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

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setShowExpiry((current) => !current)}
          className="self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {showExpiry ? "Remove expiry" : "Add an expiry date"}
        </button>
        {showExpiry && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiry" className="sr-only">
              Expiry
            </Label>
            <Input
              id="expiry"
              type="datetime-local"
              aria-invalid={!!errors.expiry}
              className="max-w-xs"
              {...register("expiry")}
            />
            {errors.expiry && (
              <p className="text-sm text-destructive">
                {errors.expiry.message}
              </p>
            )}
          </div>
        )}
      </div>

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
