"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Moon, Rows3, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const STEPS = [
  { href: "/baseline", label: "Baseline", id: "baseline" },
  { href: "/preferences", label: "Preferences", id: "preferences" },
  { href: "/evaluate", label: "Evaluate", id: "evaluate" },
  { href: "/tracked", label: "Tracked Jobs", id: "tracked" },
  { href: "/tailor", label: "Tailor", id: "tailor" },
] as const;

type Status = {
  facts: number;
  openQuestions: number;
  preferencesSaved: boolean;
  tracked: number;
  evaluations: number;
  tailored: boolean;
  demo: boolean;
  displayName: string;
  provider: string;
};

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<Status>("/api/status")
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  const done = {
    baseline: (status?.facts ?? 0) > 0 && (status?.openQuestions ?? 0) === 0,
    preferences: status?.preferencesSaved ?? false,
    evaluate: (status?.evaluations ?? 0) > 0,
    tracked: (status?.tracked ?? 0) > 0,
    tailor: status?.tailored ?? false,
  };

  async function runDemo(action: "load" | "clear") {
    try {
      await api("/api/demo", { method: "POST", body: JSON.stringify({ action }) });
      toast.success(action === "load" ? "Sample baseline loaded" : "Sample data removed");
      setResetOpen(false);
      router.refresh();
      const next = await api<Status>("/api/status");
      setStatus(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the sample");
    }
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4 pr-12">
        <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-semibold text-background">
          K
        </span>
        <div>
          <p className="text-sm font-semibold tracking-tight">Keel</p>
          <p className="text-[11px] text-muted-foreground">Job search grounded in your record</p>
        </div>
      </div>

      <nav aria-label="Job search steps" className="flex flex-col gap-0.5 px-2">
        {STEPS.map((step, index) => {
          const active = pathname === step.href;
          const complete = done[step.id];
          return (
            <Link
              key={step.id}
              href={step.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[10px] font-medium",
                  complete && "border-transparent bg-foreground text-background",
                  !complete && active && "border-foreground text-foreground",
                  !complete && !active && "border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {complete ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="flex-1">{step.label}</span>
              {step.id === "tracked" && (
                <span className="text-xs tabular-nums text-muted-foreground">{status?.tracked ?? 0}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <p className="px-4 pt-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">Reference</p>
      <nav aria-label="Reference" className="flex flex-col gap-0.5 px-2">
        <Link
          href="/level-map"
          aria-current={pathname === "/level-map" ? "page" : undefined}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
            pathname === "/level-map"
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
          )}
        >
          <span className="grid size-5 place-items-center text-muted-foreground" aria-hidden>
            <Rows3 className="size-3.5" />
          </span>
          <span className="flex-1">Level map</span>
        </Link>
      </nav>

      <div className="mt-auto border-t border-sidebar-border p-3">
        <ThemeToggle />
        <div className="mt-3 px-1">
          <p className="text-sm font-medium">{status?.displayName || "Local user"}</p>
          <p className="text-xs text-muted-foreground">
            {status?.provider === "local" ? "Local scoring" : `Provider: ${status?.provider ?? "local"}`}
          </p>
        </div>
        <button
          type="button"
          className="mt-3 px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setResetOpen(true)}
        >
          {status?.demo ? "Clear sample" : "Load sample"}
        </button>
        <p className="mt-3 px-1 text-[11px] leading-4 text-muted-foreground">
          Resumes stay on this machine unless you configure a model.
        </p>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{status?.demo ? "Remove the sample?" : "Load the sample baseline?"}</DialogTitle>
            <DialogDescription>
              {status?.demo
                ? "Sample documents, facts, and the sample preference row are deleted. Anything you added yourself stays."
                : "Adds a labeled senior TPM example so you can click through. Your real search starts empty until you do this."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void runDemo(status?.demo ? "clear" : "load")}>
              {status?.demo ? "Clear sample" : "Load sample"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-start"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light mode" : "Dark mode"}
    </Button>
  );
}
