"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { patch, get } from "@/lib/api";
import { SectionTitle, LoadingRows } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth-context";

interface CustomerMe {
  id: number;
  companyName: string;
  contactName: string;
  phone: string | null;
  address: string | null;
}

export default function PortalProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ contactName: "", phone: "", address: "" });

  const me = useQuery({
    queryKey: ["customer-me"],
    queryFn: () => get<{ customer: CustomerMe }>("/customers/me"),
  });

  useEffect(() => {
    if (me.data) {
      const c = me.data.customer;
      setForm({ contactName: c.contactName ?? "", phone: c.phone ?? "", address: c.address ?? "" });
    }
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => patch(`/customers/${me.data!.customer.id}`, form),
    onSuccess: () => toast("success", "Profile saved"),
    onError: () => toast("error", "Save failed"),
  });

  return (
    <>
      <SectionTitle title="Profile" desc="Your billing contact details — invoices carry these." />

      {me.isLoading ? (
        <LoadingRows rows={3} />
      ) : (
        <div className="card max-w-[560px] p-6">
          <div className="space-y-4">
            <div>
              <label className="field-label" htmlFor="pr-company">
                Company
              </label>
              <input id="pr-company" className="input" value={me.data?.customer.companyName ?? ""} disabled />
              <p className="text-xs text-faint mt-1">Company name is set at signup — contact us to change it.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="pr-email">
                Sign-in email
              </label>
              <input id="pr-email" className="input" value={user?.email ?? ""} disabled />
            </div>
            <div>
              <label className="field-label" htmlFor="pr-contact">
                Contact name
              </label>
              <input id="pr-contact" className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </div>
            <div>
              <label className="field-label" htmlFor="pr-phone">
                Phone
              </label>
              <input id="pr-phone" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="field-label" htmlFor="pr-address">
                Address
              </label>
              <input id="pr-address" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
