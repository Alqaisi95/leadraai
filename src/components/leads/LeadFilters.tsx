"use client";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/Input";
import { api } from "@/lib/client";

export interface LeadFilterState {
  q: string;
  temperature: string;
  ownerId: string;
  projectId: string;
}

export const EMPTY_FILTERS: LeadFilterState = { q: "", temperature: "", ownerId: "", projectId: "" };

export function toQuery(f: LeadFilterState) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.temperature) p.set("temperature", f.temperature);
  if (f.ownerId) p.set("ownerId", f.ownerId);
  if (f.projectId) p.set("projectId", f.projectId);
  return p;
}

export function LeadFilters({
  value,
  onChange,
  right,
}: {
  value: LeadFilterState;
  onChange: (f: LeadFilterState) => void;
  right?: React.ReactNode;
}) {
  const [members, setMembers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    api("/api/members")
      .then((d) => setMembers(d.items.filter((m: any) => m.status === "ACTIVE")))
      .catch(() => {});
    api("/api/projects")
      .then((d) => setProjects(d.items))
      .catch(() => {});
  }, []);

  const active = value.q || value.temperature || value.ownerId || value.projectId;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-64">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
        <Input
          className="h-8.5 ps-9 text-[12.5px]"
          aria-label="بحث في العملاء"
          placeholder="بحث بالاسم أو الهاتف…"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </div>

      <Select
        className="h-8.5 w-36 text-[12.5px]"
        value={value.temperature}
        onChange={(e) => onChange({ ...value, temperature: e.target.value })}
      >
        <option value="">كل التصنيفات</option>
        <option value="SALES_READY">جاهز للبيع</option>
        <option value="WARM">دافئ</option>
        <option value="COLD">بارد</option>
      </Select>

      {members.length > 0 && (
        <Select
          className="h-8.5 w-40 text-[12.5px]"
          value={value.ownerId}
          onChange={(e) => onChange({ ...value, ownerId: e.target.value })}
        >
          <option value="">كل الموظفين</option>
          <option value="unassigned">غير مخصص</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.user.fullName}
            </option>
          ))}
        </Select>
      )}

      {projects.length > 0 && (
        <Select
          className="h-8.5 w-40 text-[12.5px]"
          value={value.projectId}
          onChange={(e) => onChange({ ...value, projectId: e.target.value })}
        >
          <option value="">كل المشاريع</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}

      {active && (
        <button
          className="flex items-center gap-1 rounded-field px-2 py-1 text-[12px] font-semibold text-dim hover:text-danger"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X size={12} /> مسح
        </button>
      )}

      <div className="ms-auto flex items-center gap-2">{right}</div>
    </div>
  );
}
