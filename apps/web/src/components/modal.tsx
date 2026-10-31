"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/** Plain white modal on a translucent ink scrim — no glass, no gradient. */
export function Modal({
  title,
  desc,
  width = 560,
  onClose,
  children,
}: {
  title: string;
  desc?: string;
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto py-10 px-4" style={{ background: "rgba(10,10,10,0.4)" }}>
      <div className="card w-full shadow-[0_24px_80px_rgba(0,0,0,0.25)]" style={{ maxWidth: width }} role="dialog" aria-modal>
        <div className="flex items-start justify-between px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-rule)" }}>
          <div>
            <h2 className="text-[16px] font-medium">{title}</h2>
            {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink cursor-pointer" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
