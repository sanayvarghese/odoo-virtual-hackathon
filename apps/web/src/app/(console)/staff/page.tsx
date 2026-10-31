"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get, post, qs, ApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

interface StaffRow {
  id: number;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function StaffPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ["staff", { q }],
    queryFn: () => get<{ items: StaffRow[]; total: number }>(`/staff${qs({ q, limit: 50 })}`),
  });

  const invite = useMutation<{ staff: { email: string } }>({
    mutationFn: () => post<{ staff: { email: string } }>("/staff", { name: form.name.trim(), email: form.email.trim() }),
    onSuccess: (r: { staff: { email: string } }) => {
      toast("success", `${r.staff.email} added — temp password Brightloop@Temp1, visible in dev mailbox.`);
      setOpen(false);
      setForm({ name: "", email: "" });
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not add staff"),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => post(`/staff/${id}/deactivate`, {}),
    onSuccess: () => {
      toast("success", "Staff account deactivated");
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <>
      <SectionTitle
        title="Staff"
        desc="Admins and staff work the console; only admins can add or deactivate them here."
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Add staff
          </button>
        }
      />

      <input
        className="input max-w-[320px] mb-3"
        placeholder="Search name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="card">
        {list.isLoading ? (
          <LoadingRows rows={4} />
        ) : list.data && list.data.items.length === 0 ? (
          <EmptyState title="No staff accounts" />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Added</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="text-muted">{s.email}</td>
                  <td className="capitalize">{s.role}</td>
                  <td className="text-xs text-faint">{dateTime(s.createdAt)}</td>
                  <td>
                    <span className={`pill ${s.isActive ? "pill-positive" : "pill-neutral"}`}>
                      {s.isActive ? "active" : "deactivated"}
                    </span>
                  </td>
                  <td className="text-right">
                    {s.isActive && s.role === "staff" && (
                      <button
                        className="text-sm text-muted hover:text-negative cursor-pointer"
                        onClick={() => {
                          if (confirm(`Deactivate ${s.email}? They lose console access.`)) deactivate.mutate(s.id);
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title="Add staff" desc="They get the temp password in the dev mailbox and change it after first sign-in." width={440} onClose={() => setOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <div>
              <label className="field-label" htmlFor="s-name">
                Name
              </label>
              <input id="s-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="field-label" htmlFor="s-email">
                Work email
              </label>
              <input id="s-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            {error && (
              <p className="text-sm text-negative" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={invite.isPending}>
                {invite.isPending ? "Adding…" : "Add staff"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
