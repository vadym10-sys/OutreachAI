import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";

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
    <SurfaceCard as="header" padding="lg" className="overflow-hidden rounded-[2rem] lg:flex lg:items-end lg:justify-between lg:gap-6">
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
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-ink dark:text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{detail}</p>
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
    <SurfaceCard className="ui-ai-panel">
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
    <SurfaceCard tone="dashed" padding="lg" className="text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-brand dark:bg-slate-800 dark:text-teal-300">
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
        <div className="grid size-10 place-items-center rounded-2xl bg-slate-100 text-brand dark:bg-slate-800">
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
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
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
                  ? "border-teal-300 bg-teal-50 text-brand dark:border-teal-500 dark:bg-slate-800"
                  : done
                    ? "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              )}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className={done || active ? "text-brand" : "text-slate-300 dark:text-slate-600"} />
                <span className="font-bold">{step}</span>
              </div>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
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
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length ? rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="bg-white dark:bg-slate-900">
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                    {cell}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
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
