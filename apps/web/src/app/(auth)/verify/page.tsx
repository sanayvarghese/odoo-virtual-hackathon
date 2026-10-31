"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { post, ApiError } from "@/lib/api";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "fail">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("fail");
      setMessage("No verification token in the link.");
      return;
    }
    post<{ message: string }>("/auth/verify", { token })
      .then((r) => {
        setState("done");
        setMessage(r.message);
      })
      .catch((e) => {
        setState("fail");
        setMessage(e instanceof ApiError ? e.message : "Verification failed");
      });
  }, [token]);

  return (
    <>
      <h1 className="text-[24px] font-medium leading-tight">
        {state === "working" ? "Verifying…" : state === "done" ? "Email verified" : "Link problem"}
      </h1>
      <p className="text-muted mt-1.5">{message || "One moment."}</p>
      {state !== "working" && (
        <div className="mt-6 flex gap-2">
          <a href="/login" className="btn btn-primary flex-1">
            Sign in
          </a>
          <a href="/mailbox" className="btn btn-ghost flex-1">
            Dev mailbox
          </a>
        </div>
      )}
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
