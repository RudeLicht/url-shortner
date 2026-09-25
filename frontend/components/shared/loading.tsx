import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

type LoadingProps = {
  label?: string;
  className?: string;
};

export function Loading({ label = "Loading...", className }: LoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted-foreground",
        className
      )}
    >
      <Loader2Icon className="size-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
