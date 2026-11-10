/**
 * Minimal Tailwind-aware class merge.
 *
 * Tailwind resolves conflicting utilities by CSS source order, not by the order
 * they appear in a class string — so a base `w-full` can silently beat a caller's
 * `w-36`. This drops base classes whose utility group the caller re-specifies.
 * Scoped to the groups the UI kit actually overrides; anything else passes through.
 */
const GROUPS = [
  "w",
  "h",
  "min-w",
  "max-w",
  "min-h",
  "max-h",
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "ps",
  "pe",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ms",
  "me",
  "text",
  "rounded",
  "bg",
  "border",
  "gap",
  "grid-cols",
] as const;

/** `h-9.5` → `h`, `min-w-52` → `min-w`, `focus:outline-2` → `focus:outline`. */
function groupOf(cls: string): string | null {
  const [variants, base] = (() => {
    const i = cls.lastIndexOf(":");
    return i === -1 ? ["", cls] : [cls.slice(0, i + 1), cls.slice(i + 1)];
  })();

  // longest prefix wins so `min-w` beats `m`
  const match = [...GROUPS]
    .sort((a, b) => b.length - a.length)
    .find((g) => base === g || base.startsWith(`${g}-`) || base.startsWith(`-${g}-`));

  return match ? variants + match : null;
}

export function cx(base: string, override?: string): string {
  if (!override) return base;

  const overridden = new Set(override.split(/\s+/).filter(Boolean).map(groupOf).filter(Boolean) as string[]);
  if (overridden.size === 0) return `${base} ${override}`;

  const kept = base
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) => {
      const g = groupOf(c);
      return !g || !overridden.has(g);
    });

  return `${kept.join(" ")} ${override}`;
}
