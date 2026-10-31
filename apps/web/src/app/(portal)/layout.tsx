"use client";

import { AppShell } from "@/components/app-shell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <AppShell kind="portal">{children}</AppShell>;
}
