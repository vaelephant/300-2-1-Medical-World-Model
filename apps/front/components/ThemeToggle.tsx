"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="outline" size="icon" aria-label="切换浅色/深色模式" title="切换浅色/深色模式" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  );
}
