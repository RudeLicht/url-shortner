import type { ComponentType } from "react";
import { TriangleAlertIcon } from "lucide-react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function ErrorState({
  icon: Icon = TriangleAlertIcon,
  title,
  description,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/30 px-6 py-16 text-center",
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="size-6 text-destructive" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
