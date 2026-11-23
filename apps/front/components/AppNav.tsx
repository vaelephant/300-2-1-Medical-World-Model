"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/patients", label: "Patients" },
  { href: "/world-model", label: "World Model" },
  { href: "/simulation", label: "Simulation" },
  { href: "/evaluation", label: "Evaluation" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-outline-variant/60 bg-surface-lowest">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="font-serif text-lg font-semibold tracking-tight text-on-surface">
            DR.SEEK
            <span className="ml-2 text-primary">HCC World Model</span>
          </p>
          <p className="truncate text-xs text-on-surface-variant">
            Digital Twin Studio · V1 Research Prototype
          </p>
        </div>
        <nav className="flex flex-wrap gap-1">
          {links.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  active
                    ? "rounded-md bg-primary-container px-3 py-1.5 text-sm font-medium text-primary"
                    : "rounded-md px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-low"
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
