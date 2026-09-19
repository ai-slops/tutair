# Tutair Design System

## 0. Research Log

- Embedded references: shortlisted Notion, Claude, and Wired for warm editorial reading → picked Minimalist UI + Notion because Tutair needs a paper-like learning workspace with quiet, inspectable structure rather than dashboard theater.
- Lazyweb: 2 desktop queries, 9 results reviewed by metadata; three strongest screens downloaded (Gemini guided learning, MagicSchool AI, Lookback). Image inspection timed out in the available research tool, so only search-grounded patterns were used: prominent goal composer, persistent navigation, and list/detail conversation structure.
- Existing UI: greenfield repository; no prior components, tokens, styling files, or `DESIGN.md` existed to inspect.
- Imagen drafts: skipped — image-generation tooling is unavailable in this environment.
- Primitive showcase: the product surface itself is the state harness; buttons, inputs, notices, list rows, tabs, and drawers expose their empty/loading/error/active/focus states in real workflows at the required breakpoints.

## 1. Atmosphere & Identity

Tutair feels like a well-used field notebook guided by a thoughtful tutor: warm ivory paper, forest ink, handwritten-margin energy without visual nostalgia. Its signature is the **evidence margin**—knowledge and revision evidence sit beside the conversation like annotated sources, never collapsed into false mastery scores.

The memorable moment is a calm three-part learning desk: thread index, readable dialogue, and an optional evidence folio. On narrow screens these become deliberate layers rather than a squeezed dashboard.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--color-canvas` | `#f3efe4` | App background |
| Paper | `--color-paper` | `#fffdf7` | Reading and form surfaces |
| Paper muted | `--color-paper-muted` | `#ebe5d7` | Sidebar, active rows |
| Paper raised | `--color-paper-raised` | `#ffffff` | Dialogs and popovers |
| Ink | `--color-ink` | `#1e2922` | Primary text |
| Ink muted | `--color-ink-muted` | `#687069` | Supporting text |
| Ink faint | `--color-ink-faint` | `#8b918c` | Metadata and placeholders |
| Forest | `--color-forest` | `#174d37` | Primary actions and links |
| Forest hover | `--color-forest-hover` | `#0f3c2a` | Interactive hover |
| Forest wash | `--color-forest-wash` | `#e0e9df` | Selection and evidence tint |
| Rule | `--color-rule` | `#d8d2c5` | Whisper dividers |
| Rule strong | `--color-rule-strong` | `#b8b2a6` | Input outlines |
| Amber | `--color-amber` | `#8a5a16` | Synthetic/demo warning |
| Amber wash | `--color-amber-wash` | `#f4e7c9` | Warning surface |
| Error | `--color-error` | `#a23b32` | Errors and destructive actions |
| Error wash | `--color-error-wash` | `#f5dfdb` | Error surface |
| Success | `--color-success` | `#356b46` | Connected/complete state |
| Overlay | `--color-overlay` | `rgb(30 41 34 / 34%)` | Drawer and dialog scrim |
| Grain | `--color-grain` | `rgb(30 41 34 / 3%)` | Subtle canvas texture |

Rules: color conveys interaction or semantic state; exposure is always written as evidence language, never encoded as mastery percentages. No colors outside these tokens.

## 3. Typography

- Display/serif: `Georgia, "Times New Roman", serif`—topic headings and key questions.
- UI/body: `"Avenir Next", Avenir, "Segoe UI", sans-serif`—conversation, controls, metadata.
- Two families only; system-resident stacks avoid render-blocking font requests.

| Token | Size | Weight | Line height | Tracking | Usage |
|---|---:|---:|---:|---:|---|
| `--type-display` | `clamp(2rem, 5vw, 3.5rem)` | 400 | 1.04 | -0.03em | Empty-state question |
| `--type-h1` | `clamp(1.75rem, 3vw, 2.5rem)` | 400 | 1.12 | -0.02em | Conversation title |
| `--type-h2` | `1.5rem` | 400 | 1.2 | -0.015em | Panel title |
| `--type-h3` | `1.125rem` | 600 | 1.35 | -0.01em | Card title |
| `--type-body-lg` | `1.0625rem` | 400 | 1.7 | 0 | Tutor response |
| `--type-body` | `0.9375rem` | 400 | 1.6 | 0 | Default UI text |
| `--type-small` | `0.8125rem` | 500 | 1.45 | 0 | Metadata |
| `--type-label` | `0.6875rem` | 700 | 1.3 | 0.08em | Uppercase labels |

Body text never drops below the small token. Long-form conversation is limited to 68ch.

## 4. Spacing & Layout

Base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px.

Radius tokens: `--radius-sm` 6px, `--radius-md` 10px, `--radius-lg` 16px, `--radius-round` 999px. Icon tokens: `--icon-sm` 16px, `--icon-md` 20px, `--icon-lg` 24px. Control minimum: `--control-min` 44px.

Desktop is a fixed-sidenav shell: 288px thread index, fluid conversation, optional 336px evidence folio. The shell is bounded by `100dvh`; each pane owns vertical scroll. Tablet hides the evidence folio in an overlay drawer. Mobile uses one visible layer with thread and evidence drawers; the composer stays in normal grid flow at the bottom of the main shell. Primary content never scrolls horizontally.

## 5. Components

### Button / IconButton
- Structure: native `button`, icon plus optional label.
- Variants: primary forest, secondary paper, ghost, destructive.
- States: hover color shift, active `translateY(1px)`, focus ring, disabled opacity, loading spinner and text.
- Accessibility: 44px target, visible label or `aria-label`, never icon color alone.

### TextField / Composer
- Structure: label, input or textarea, hint/error; composer adds submit action.
- States: default, focus, disabled, loading, error; placeholder is never the only label.
- Layout: stack; composer grows to a defined max height and keeps submit reachable.

### Notice
- Variants: information, synthetic-demo, error.
- Structure: icon, concise title, actionable copy, optional retry.
- Accessibility: error uses `role="alert"`; status uses `role="status"`.

### ThreadRow
- Structure: title, updated time, optional current marker.
- States: default, hover, active, keyboard focus, search-filtered empty.
- Layout: list item with truncation; long titles wrap to two lines at most.

### LearningSearch
- Thread-title filtering is labeled narrowly and never presented as content search.
- Full learning search submits to the server search endpoint and labels result type; thread and knowledge results are inspectable.

### ProviderStatus
- Desktop shows the explicit provider label beside its semantic status dot; compact screens retain an accessible labeled control.
- Activating the status opens server-side setup guidance. Provider credentials are never collected in the browser.

### Message
- Variants: learner and tutor.
- Learner uses a compact forest-wash note aligned to the reading measure; tutor is editorial prose without a chat bubble.
- States: sending, failed with retry, complete; correction action is explicit and keyboard reachable.

### DimensionStrip
- Exactly six labels: Recognition, Recall, Explanation, Application, Discrimination, Transfer.
- The selected concept shows the server projection for its current immutable revision: estimate, uncertainty, status, effective evidence, supporting evidence IDs, projection version, and knowledge revision ID.
- Projection values are labeled as model state, never percentages, meters, mastery grades, or values inferred from evidence counts. A missing dimension is explicitly “State unavailable.”
- Each populated item opens KnowledgeDetail.

### KnowledgeDetail
- Structure: concept heading, immutable definition/revision metadata, sources, evidence list, correction action.
- Current-revision state is a six-row inspectable definition list. It states “Projection, not a mastery score” and preserves backend status language without celebratory or judgmental styling.
- Desktop folio or modal drawer; close control receives focus, Escape closes, focus returns to opener.
- Empty and unavailable source states are written plainly.
- Correction dialog requires an explicit correction intent (revise, claim more, claim less, invalidate evidence, or meaning mismatch); intent is never guessed from prose.

### Modal / Drawer
- Used for settings and destructive confirmation. Raised paper surface, strong rule, restrained shadow.
- Traps focus, closes on Escape except while a destructive request is pending, restores trigger focus.

### EmptyState
- Serif goal prompt, short explanation, suggested prompt buttons sourced from static instructional copy (not fake user data), and focused composer.

## 6. Motion & Interaction

Tokens: `--motion-fast` 120ms, `--motion-standard` 220ms, `--ease-out` cubic-bezier(0.16, 1, 0.3, 1). Only opacity and transform animate. Drawers fade/translate on entry to explain spatial continuity; button press confirms input; a sending indicator communicates work. No decorative looping motion. `prefers-reduced-motion: reduce` makes transitions immediate.

Keyboard: `/` focuses thread search when focus is not in an input; `Ctrl/Cmd+Enter` submits; Escape closes the top drawer/dialog. Native tab order follows visual order.

## 7. Depth & Surface

Strategy: mixed, but quiet. Layout separation uses whisper rules and tonal paper shifts. Only overlays use `--shadow-raised: 0 18px 48px rgba(30, 41, 34, 0.12), 0 2px 8px rgba(30, 41, 34, 0.06)`. Static cards do not float. A subtle paper grain is created with a tokenized CSS radial pattern at very low opacity—no image masquerading as UI.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA: 4.5:1 body contrast, 3:1 large text and boundaries, visible 2px forest focus ring with offset.
- Full keyboard reachability; semantic landmarks and headings; live regions for loading/errors; touch targets at least 44px.
- User data is never encoded by color alone. Exposure and knowledge status always have text.
- Responsive reflow at 375px with no horizontal primary-content scroll; text supports 200% zoom.
- Cognitive accessibility: one primary action per region, plain language, reversible corrections, explicit destructive consequences.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| No custom editorial font asset | Global typography | Network-independent Phase 1 build; Georgia/Avenir stacks retain clear hierarchy | Replace only when a self-hosted licensed font is supplied |
| Primitive showcase is integrated, not a separate route | Product surface | Delivery scope prioritizes the real end-to-end workspace; all primitive states remain exercised through workflows | Add a dedicated story route if the project adopts a component test harness |
