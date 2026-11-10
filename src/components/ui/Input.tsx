"use client";
import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

const FIELD =
  "w-full rounded-field border border-line bg-card px-3 text-fg placeholder:text-dim/70 transition-colors focus:outline-2 focus:outline-ring focus:border-transparent disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(`${FIELD} h-9.5 text-sm`, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cx(`${FIELD} py-2.5 text-sm min-h-20`, className)} {...props} />;
  },
);

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(`${FIELD} h-9.5 text-sm cursor-pointer`, className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-dim">{label}</span>
      {children}
    </label>
  );
}
