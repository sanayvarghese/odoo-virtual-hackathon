"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { SectionTitle, LoadingRows } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

interface DevConfig {
  apiUrl: string;
  appUrl: string;
  aiModel: string;
  aiUrl: string;
}

/**
 * Settings is intentionally read-only for server configuration: database and
 * model endpoints come from validated environment variables, not mutable UI
 * fields. This makes the demo's security posture explicit rather than giving
 * controls that pretend to save.
 */
export default function SettingsPage() {
  const { user } = useAuth();
  const config = useQuery({ queryKey: ["dev-config"], queryFn: () => get<DevConfig>("/dev/config") });

  return (
    <div className="max-w-[1152px]">
      <SectionTitle title="Settings" desc="Account identity, security posture and the local demo runtime." />

      <SettingsRow title="Your account" desc="The session identity currently using this workspace.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" value={user?.name ?? "—"} />
          <Field label="Email" value={user?.email ?? "—"} />
          <Field label="Role" value={user?.role ?? "—"} />
          <Field label="Email verification" value={user?.emailVerified ? "Verified" : "Not verified"} />
        </div>
      </SettingsRow>

      <SettingsRow title="Security" desc="Brightloop uses an httpOnly session cookie and double-submit CSRF protection.">
        <div className="space-y-3">
          <SecurityLine title="Session cookie" text="bl_session is httpOnly and SameSite=Lax; it is never exposed to JavaScript." state="on" />
          <SecurityLine title="CSRF protection" text="Every state-changing request validates the bl_csrf cookie against X-CSRF-Token." state="on" />
          <SecurityLine title="Passwords" text="Argon2 hashing, 9+ characters, uppercase, lowercase and a special character." state="on" />
          <SecurityLine title="Permissions" text="API routes enforce admin, staff and customer scopes server-side." state="on" />
        </div>
      </SettingsRow>

      <SettingsRow title="Local AI runtime" desc="The copilot remains on the local network: it calls Ollama directly, streams tool use, and restricts data by role.">
        {config.isLoading ? <LoadingRows rows={2} /> : config.data ? (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Model" value={config.data.aiModel} mono />
            <Field label="Ollama endpoint" value={config.data.aiUrl} mono />
            <Field label="API endpoint" value={config.data.apiUrl} mono />
            <Field label="Web endpoint" value={config.data.appUrl} mono />
          </div>
        ) : <p className="text-sm text-muted">Runtime configuration is unavailable while the API is offline.</p>}
      </SettingsRow>
    </div>
  );
}

function SettingsRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return <section className="grid grid-cols-[minmax(260px,39%)_1fr] gap-8 py-8 border-t border-line first:border-0 first:pt-0">
    <div className="pt-1"><h2 className="text-[16px] font-medium">{title}</h2><p className="text-muted mt-1 leading-relaxed">{desc}</p></div>
    <div className="rounded-2xl bg-[#fafafa] p-4">{children}</div>
  </section>;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="field-label">{label}</p><div className={`h-10 rounded-[10px] border border-line bg-surface px-3 flex items-center ${mono ? "mono-id" : ""}`}>{value}</div></div>;
}

function SecurityLine({ title, text, state }: { title: string; text: string; state: "on" | "off" }) {
  return <div className="flex gap-3 rounded-[10px] bg-surface px-3 py-3"><span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${state === "on" ? "bg-positive" : "bg-faint"}`} /><div><p className="font-medium">{title} <span className="pill pill-positive ml-1">enabled</span></p><p className="text-sm text-muted mt-1">{text}</p></div></div>;
}
