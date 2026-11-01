import type { ReactNode } from "react";

export function PageHeader({
  step,
  title,
  description,
  action,
}: {
  step: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">{step}</p>
        <h1 className="mt-1 text-[1.65rem] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
