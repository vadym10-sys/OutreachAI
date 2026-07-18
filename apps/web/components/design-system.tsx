import Link from "next/link";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Command, Loader2, Search, Sparkles, Wand2 } from "lucide-react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type SurfaceTone = "default" | "subtle" | "accent" | "warning" | "dashed" | "dark";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "section" | "div" | "header";
  tone?: SurfaceTone;
  padding?: "sm" | "md" | "lg";
  children: ReactNode;
};

const surfaceToneClass: Record<SurfaceTone, string> = {
  default: "ui-card",
  subtle: "ui-card ui-card-subtle",
  accent: "ui-card ui-card-accent",
  warning: "ui-card ui-card-warning",
  dashed: "ui-card ui-card-dashed",
  dark: "ui-card ui-card-dark",
};

const surfacePaddingClass = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function SurfaceCard({
  as: Component = "section",
  tone = "default",
  padding = "md",
  className,
  children,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cx(surfaceToneClass[tone], surfacePaddingClass[padding], className)}
      {...props}
    >
      {children}
    </Component>
  );
}

export function OperatingPanel({
  children,
  className,
  as: Component = "section",
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "article" | "section" | "div" | "header";
  children: ReactNode;
}) {
  return (
    <Component className={cx("ui-card ui-orbit-card rounded-[2rem] p-5 sm:p-6", className)} {...props}>
      {children}
    </Component>
  );
}

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "dark";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "ui-badge ui-badge-neutral",
  brand: "ui-badge ui-badge-brand",
  success: "ui-badge ui-badge-success",
  warning: "ui-badge ui-badge-warning",
  danger: "ui-badge ui-badge-danger",
  dark: "ui-badge ui-badge-dark",
};

export function AppBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx(badgeToneClass[tone], className)}>{children}</span>;
}

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonSize = "md" | "lg";

const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: "ui-button ui-button-primary",
  secondary: "ui-button ui-button-secondary",
  ghost: "ui-button ui-button-ghost",
};

const buttonSizeClass: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-sm",
};

export function AppButton({
  variant = "primary",
  size = "lg",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={cx(buttonVariantClass[variant], buttonSizeClass[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHero({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  copy: ReactNode;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard as="header" padding="lg" className="ui-orbit-card overflow-hidden rounded-[2rem] lg:flex lg:items-end lg:justify-between lg:gap-6">
      <div className="min-w-0 max-w-3xl">
        <p className="ui-eyebrow">{eyebrow}</p>
        <h1 className="ui-display mt-2">{title}</h1>
        <p className="ui-copy mt-3 min-[390px]:text-base">{copy}</p>
      </div>
      {action ? (
        <div className="mt-5 min-w-0 max-w-full shrink-0 [&>a]:w-full [&>button]:w-full min-[430px]:[&>a]:w-auto min-[430px]:[&>button]:w-auto lg:mt-0">
          {action}
        </div>
      ) : null}
    </SurfaceCard>
  );
}

export function MetricSurface({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <SurfaceCard as="article" className="rounded-[1.75rem]">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-ink">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </SurfaceCard>
  );
}

export function SectionPanel({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  copy: ReactNode;
  children: ReactNode;
}) {
  return (
    <SurfaceCard padding="lg" className="rounded-[2rem]">
      <p className="ui-eyebrow">{eyebrow}</p>
      <h2 className="ui-title mt-2">{title}</h2>
      <p className="ui-copy mt-2 max-w-3xl">{copy}</p>
      <div className="mt-5">{children}</div>
    </SurfaceCard>
  );
}

export function AiPanel({
  title,
  copy,
  children,
  badge,
}: {
  title: ReactNode;
  copy?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <SurfaceCard className="ui-ai-panel rounded-[2rem]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="ui-title text-xl">{title}</h3>
          {copy ? <p className="ui-copy mt-2">{copy}</p> : null}
        </div>
        {badge}
      </div>
      <div className="mt-4">{children}</div>
    </SurfaceCard>
  );
}

export function AiLiveCard({
  label,
  title,
  copy,
  metric,
  action,
}: {
  label: ReactNode;
  title: ReactNode;
  copy: ReactNode;
  metric?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <OperatingPanel as="article" className="min-h-[13rem]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(79,70,229,0.14),rgba(0,163,255,0.12))] text-brand">
          <Wand2 size={20} />
        </div>
        {metric ? <div className="rounded-full border border-[var(--ui-border)] bg-white/60 px-3 py-1 text-xs font-black text-[var(--ui-text)]">{metric}</div> : null}
      </div>
      <p className="ui-eyebrow mt-5">{label}</p>
      <h3 className="ui-title mt-2 text-xl">{title}</h3>
      <p className="ui-copy mt-3">{copy}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </OperatingPanel>
  );
}

export function EmptyStateView({
  title,
  copy,
  action,
}: {
  title: ReactNode;
  copy: ReactNode;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard tone="dashed" padding="lg" className="ui-orbit-card rounded-[2rem] text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-brand">
        <Sparkles size={22} />
      </div>
      <h2 className="ui-title mt-4 text-xl">{title}</h2>
      <p className="ui-copy mx-auto mt-2 max-w-xl">{copy}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </SurfaceCard>
  );
}

export function ErrorStateView({
  title,
  copy,
  onRetry,
}: {
  title: ReactNode;
  copy: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <SurfaceCard tone="warning" className="rounded-[1.75rem]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-900" />
            <p className="text-sm font-bold text-amber-950">{title}</p>
          </div>
          <p className="mt-1 text-sm leading-6 text-amber-900">{copy}</p>
        </div>
        {onRetry ? (
          <AppButton variant="secondary" size="md" onClick={onRetry} className="bg-white text-amber-950 hover:border-amber-300">
            Retry
          </AppButton>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

export function LoadingStateView({ title }: { title: ReactNode }) {
  return (
    <SurfaceCard padding="lg" className="rounded-[2rem]">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-2xl bg-slate-100 text-brand">
          <Loader2 size={18} className="animate-spin" />
        </div>
        <p className="ui-eyebrow">{title}</p>
      </div>
      <div className="mt-5 grid gap-3">
        <div className="ui-skeleton h-8 w-2/3 rounded-xl" />
        <div className="ui-skeleton h-4 w-full rounded-xl" />
        <div className="ui-skeleton h-4 w-5/6 rounded-xl" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="ui-skeleton h-24 rounded-2xl" />
          <div className="ui-skeleton h-24 rounded-2xl" />
          <div className="ui-skeleton h-24 rounded-2xl" />
        </div>
      </div>
    </SurfaceCard>
  );
}

export function TimelineRail({
  items,
  activeStep,
  completedSteps,
  title,
  eyebrow,
}: {
  items: string[];
  activeStep: string;
  completedSteps: string[];
  title: ReactNode;
  eyebrow: ReactNode;
}) {
  return (
    <SurfaceCard padding="md" className="rounded-[2rem]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-eyebrow">{eyebrow}</p>
          <h2 className="ui-title mt-1 text-xl">{title}</h2>
        </div>
        <p className="text-sm font-semibold text-slate-600">
          Current step: {activeStep}
        </p>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((step) => {
          const done = completedSteps.includes(step);
          const active = activeStep === step;
          return (
            <div
              key={step}
              className={cx(
                "rounded-xl border p-3 text-sm",
                active
                  ? "border-blue-300 bg-blue-50 text-brand"
                  : done
                    ? "border-slate-200 bg-slate-50 text-slate-700"
                    : "border-slate-200 bg-white text-slate-500"
              )}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className={done || active ? "text-brand" : "text-slate-300"} />
                <span className="font-bold">{step}</span>
              </div>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

export function AiTimeline({
  items,
}: {
  items: Array<{ label: ReactNode; detail: ReactNode; status?: "done" | "active" | "waiting" | "error" }>;
}) {
  return (
    <div className="grid gap-3">
      {items.map((item, index) => {
        const active = item.status === "active";
        const error = item.status === "error";
        return (
          <div key={index} className="grid grid-cols-[2rem_1fr] gap-3">
            <div className="flex flex-col items-center">
              <span className={cx(
                "grid size-8 place-items-center rounded-full border text-xs font-black",
                error ? "border-red-300 bg-red-50 text-red-700" : active ? "border-blue-300 bg-white text-brand shadow-sm" : "border-[var(--ui-border)] bg-white/70 text-[var(--ui-text-soft)]"
              )}>
                {index + 1}
              </span>
              {index < items.length - 1 ? <span className="mt-2 h-full min-h-6 w-px bg-[var(--ui-border)]" /> : null}
            </div>
            <div className={cx("rounded-2xl border p-3", active ? "border-indigo-200 bg-white shadow-sm" : "border-[var(--ui-border)] bg-white/50")}>
              <p className="text-sm font-black text-[var(--ui-text)]">{item.label}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-text-soft)]">{item.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MiniBarChart({
  values,
  labels,
}: {
  values: number[];
  labels?: string[];
}) {
  const max = Math.max(1, ...values.map((value) => Math.max(0, value)));
  return (
    <div className="flex h-28 items-end gap-2 rounded-2xl border border-[var(--ui-border)] bg-white/50 p-3">
      {values.map((value, index) => (
        <div key={`${value}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <div
            className="w-full rounded-t-xl bg-[linear-gradient(180deg,var(--ui-brand),var(--ui-accent))] shadow-sm"
            style={{ height: `${Math.max(12, Math.round((Math.max(0, value) / max) * 72))}px` }}
            aria-label={`${labels?.[index] || "Value"}: ${value}`}
          />
          {labels?.[index] ? <span className="max-w-full truncate text-[10px] font-bold text-[var(--ui-text-soft)]">{labels[index]}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: ReactNode; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs font-bold text-[var(--ui-text-soft)]">
      {items.map((item, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          {item.href ? <Link href={item.href} className="truncate hover:text-[var(--ui-text)]">{item.label}</Link> : <span className="truncate text-[var(--ui-text)]">{item.label}</span>}
          {index < items.length - 1 ? <ChevronRight size={13} aria-hidden="true" /> : null}
        </span>
      ))}
    </nav>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md border border-[var(--ui-border)] bg-white/70 px-1.5 text-[11px] font-black text-[var(--ui-text-soft)] shadow-sm">
      {children}
    </kbd>
  );
}

export function CommandDialog({
  open,
  query,
  onQueryChange,
  onClose,
  children,
}: {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh] ui-command-overlay" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="w-full max-w-2xl overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white text-ink shadow-soft"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search size={18} className="text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search routes, actions and workspace context..."
            className="min-h-11 flex-1 border-0 bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-slate-400"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[24rem] overflow-y-auto p-2">{children}</div>
      </section>
    </div>
  );
}

export function CommandItem({
  href,
  icon,
  title,
  detail,
  shortcut,
  onSelect,
}: {
  href: string;
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  shortcut?: ReactNode;
  onSelect?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 text-left text-slate-700 hover:bg-blue-50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-brand">{icon || <Command size={17} />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-ink">{title}</span>
        {detail ? <span className="block truncate text-xs font-semibold text-slate-500">{detail}</span> : null}
      </span>
      {shortcut ? <span className="shrink-0">{shortcut}</span> : null}
    </Link>
  );
}

export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="bg-white">
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 text-sm text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {empty || "No rows available."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OpportunityCardShell({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <SurfaceCard as="article" className={cx("rounded-[1.75rem] ui-animate-enter", className)} {...props}>{children}</SurfaceCard>;
}

export function CompanyCardShell({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <SurfaceCard as="article" className={cx("rounded-[2rem] ui-animate-enter", className)} {...props}>{children}</SurfaceCard>;
}

export function DecisionMakerCardShell({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <SurfaceCard as="article" tone="subtle" className={cx("rounded-[1.5rem]", className)} {...props}>{children}</SurfaceCard>;
}
