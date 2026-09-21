# High-Tech Premium Design System (Vercel/Stripe Inspired)

This document establishes the visual design language, color palettes, spacing, typography, and interactive behavior for the **ai-labs** suite.

---

## 1. Color Palette

Our colors reflect a clean, futuristic, developer-first aesthetic. We use deep obsidian blacks for depth, low-opacity borders for clean structure, and highly saturated neon accents to draw attention to telemetry, active states, and successful physical movement.

| Token | Color | Hex/RGB/OKLCH | Application |
| :--- | :--- | :--- | :--- |
| **Obsidian Base** | Deepest Black | `#030303` / `oklch(0.10 0.01 290)` | Global app background, body background |
| **Obsidian Card** | Dark Slate | `#09090b` / `oklch(0.14 0.01 290)` | Underlay for panels and container grids |
| **Glass Background** | Transparent Charcoal | `rgba(15, 15, 18, 0.6)` / `oklch(0.12 0.02 290 / 0.6)` | Overlay panels with backdrop-filters |
| **Border Clean** | Ultra-fine Border | `rgba(255, 255, 255, 0.08)` / `#1f1f23` | Card borders, section separators, buttons |
| **Border Active** | Subtle Neon Glow | `rgba(0, 242, 254, 0.25)` | Hover states, active inputs, focused items |
| **Clinical Teal** | Cyber Cyan | `#00f2fe` / `oklch(0.78 0.16 195)` | Primary telemetry indicator, active pose overlays, reps |
| **Cyber Gold** | Performance Amber | `#ffb700` / `oklch(0.80 0.16 85)` | Highlight metric, warnings, caution states, near-target reps |
| **Neon Rose** | Accent Red | `#ff0055` / `oklch(0.60 0.22 15)` | Errors, delete states, critical boundary violations |
| **Text Primary** | High-Contrast White | `#f4f4f5` / `oklch(0.95 0.01 290)` | Headings, critical numbers, body text |
| **Text Muted** | Zinc Gray | `#a1a1aa` / `oklch(0.70 0.01 290)` | Labels, units, secondary descriptions, timestamps |

---

## 2. Typography

We enforce a modern, geometric sans-serif styling (Inter/Outfit) with strict hierarchy, high contrast, and monospace numerals for shifting values (e.g., telemetry trackers).

- **Headings (H1/H2):** Bold geometric sans-serif (Outfit/Inter) with negative letter-spacing for a modern editorial feel (`letter-spacing: -0.03em`).
- **Telemetry Numbers:** Tabular-nums (`font-variant-numeric: tabular-nums`) to prevent shifting layouts during active sessions.
- **Sizing Hierarchy:**
  - **Hero Title:** `2.5rem` to `3.25rem` (clamp, tight line-height `1.1`)
  - **Card Title:** `1.15rem` (semi-bold)
  - **Telemetry Big Value:** `2rem` to `2.5rem` (extra-bold, `font-family: 'Outfit', monospace-like`)
  - **Body / Label:** `0.85rem` to `0.9rem` (regular/medium)
  - **Subtext / Helper:** `0.75rem` (muted)

---

## 3. Glassmorphic Component Spec

Glassmorphism provides a premium look by overlaying content onto the dark obsidian background while letting background glow gradients shine through.

```css
.glass-panel {
  background: rgba(10, 10, 12, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 
    0 4px 30px rgba(0, 0, 0, 0.4),
    inset 0 1px 1px rgba(255, 255, 255, 0.05);
}
```

### Applied Elements:
- **`FormStatsDashboard` container:** Full glassmorphic wrapping panel.
- **Telemetry cards:** Nested glass cards with subtle gradient borders.
- **Video upload container (`.formai-drop-zone`):** Semi-transparent backdrop with dashed border that transitions into an active Teal glow upon file select or hover.

---

## 4. Micro-Animations & Dynamic States

Interactive elements must feel alive, responsive, and tactile.

### Hover Transitions:
- **Cards & Buttons:** Smooth scale (`transform: translateY(-2px) scale(1.01)`) and border-color transitions over `150ms ease-out`.
- **Glow overlays:** Glow shadows intensify on hover.

### Pulse States for Active Recording & Inference:
- **Active Recording:** Pulse indicator animating between `opacity: 0.4` and `opacity: 1` using `oklch` teal shadows.
- **WASM / Processing Spinner:** High-tech, dual-color concentric ring spinner with glowing neon elements instead of standard flat colors.

```css
@keyframes cyber-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.4);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(0, 242, 254, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(0, 242, 254, 0);
  }
}
```
