"use client";

import Link from "next/link";
import { LoopMark } from "@/components/app-shell";

/** Centered auth card on the ground — no sidebar, no chrome colour. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <Link href="/" className="flex items-center gap-2.5 mb-8">
        <LoopMark size={24} />
        <span className="font-medium text-[17px] tracking-tight">Brightloop</span>
      </Link>
      <div className="card w-full max-w-[440px] p-8">{children}</div>
      <p className="text-xs text-faint mt-6">
        Subscriptions, billed on time · runs locally end-to-end
      </p>
    </div>
  );
}
