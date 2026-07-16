# OutreachAI Design System V2

## Principles

- Decision-first: every screen should answer what matters now, why, and what the next safe action is.
- Real-data only: production UI must use existing backend/API data and must label demo previews as demo.
- Enterprise clarity: dense enough for daily work, calm enough for sales trust.
- Review-first safety: generation and sending controls must make status, risk, and confirmation obvious.
- Accessible by default: visible focus, 44px touch targets, adequate contrast, keyboard-friendly controls, and reduced-motion support.

## Tokens

Colors:

- Background: `--ui-bg`
- Surface: `--ui-surface`
- Subtle surface: `--ui-surface-subtle`
- Accent surface: `--ui-surface-accent`
- Warning surface: `--ui-surface-warning`
- Text: `--ui-text`
- Muted text: `--ui-text-soft`
- Brand accent: `--ui-brand`
- Strong brand: `--ui-brand-strong`
- Success: `--ui-success`
- Warning: `--ui-warning`
- Danger: `--ui-danger`

Typography:

- Display: `.ui-display`
- Title: `.ui-title`
- Copy: `.ui-copy`
- Eyebrow: `.ui-eyebrow`

Spacing:

- Component inner padding: `p-4`, `p-5`, `p-6`
- Page gutters: `px-4`, `min-[360px]:px-5`, desktop `lg:p-8`
- Section rhythm: `py-14`, desktop `sm:py-20`

Radius:

- Small: `--ui-radius-sm`
- Medium: `--ui-radius-md`
- Large: `--ui-radius-lg`
- XL surfaces: `--ui-radius-xl`

Depth:

- Standard card: `--ui-shadow`
- Overlay/drawer/modal: `--ui-shadow-strong`

Breakpoints:

- Mobile: default, no horizontal overflow.
- Small mobile refinements: `min-[360px]`, `min-[390px]`, `min-[430px]`.
- Tablet: `md`.
- Desktop shell: `lg`.
- Wide app grids: `xl`.

## Components

Core primitives live in `apps/web/components/design-system.tsx`.

- `SurfaceCard`: repeated surface primitive for cards, panels, page sections, and dark/accent/warning/dashed states.
- `AppBadge`: neutral, brand, success, warning, danger, and dark badges.
- `AppButton`: primary, secondary, ghost variants.
- `AppInput`, `AppTextarea`, `AppSelect`: labeled form controls with hint/error support.
- `SearchField`, `FilterBar`: search and filter composition.
- `Tabs`, `TabButton`: accessible tablist styling.
- `DataTable`: responsive table shell for real tabular data.
- `MetricSurface`: restrained metrics for real operational status.
- `PageHero`, `SectionPanel`, `AiPanel`: page-level hierarchy.
- `LoadingStateView`, `EmptyStateView`, `ErrorStateView`: consistent async states.
- `TimelineRail`: version/history/progress timelines.
- `ToastNotice`: non-blocking success/warning/error feedback.
- `ModalFrame`, `ConfirmationDialog`: confirmation and blocking flows.
- `DrawerPanel`: mobile/secondary navigation or contextual panels.
- `DropdownPanel`, `CommandMenu`: menus and command discovery.

## Usage Rules

- Use `AppButton` for real actions. Links remain links for navigation.
- Use badges for status, not decoration.
- Do not show unsupported bulk actions.
- Never show backend JSON in production UI unless the page is explicitly owner/admin diagnostics.
- Use skeletons or loading states with finite resolution; avoid infinite loaders.
- Show empty states that guide to a real workflow.
- Destructive actions require confirmation.
- Sending or launching must preserve the review-first safety model.

## Accessibility

- All interactive controls must have visible focus via `.focus-ring` or native focus styles.
- Touch targets must be at least 44px high.
- Do not rely on color alone for status.
- Keep app copy concise and scannable.
- Honor `prefers-reduced-motion`.
- Dialog/drawer usage should preserve focus order and clear labels.

## Theme

Light theme is primary. Dark theme tokens exist for safe inherited styling where supported, but the redesign should not introduce dark-mode-only surfaces or inaccessible contrast.
