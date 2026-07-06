/**
 * Northline Design Tokens
 *
 * Mirrors the canonical values declared in `styles.css :root`. Keep the two
 * in sync — the stylesheet is what ships to the browser; these constants are
 * for programmatic use (charts, canvas, exports).
 */

export const colors = {
  // Core backgrounds - deep maritime theme
  bg: {
    primary: '#08111f',
    secondary: '#0d1828',
    tertiary: '#122033',
    elevated: '#17263a',
    glass: 'rgba(17, 31, 49, 0.82)',
    glassHover: 'rgba(24, 41, 62, 0.94)',
  },

  // Text colors
  ink: {
    primary: '#f4f8fb',
    secondary: '#b7c8d7',
    muted: '#7d93a7',
    inverse: '#07111f',
  },

  // Accent colors
  accent: {
    cyan: '#38bdf8',
    teal: '#2dd4bf',
    purple: '#7c8fa5',
    pink: '#fb7185',
    warm: '#f59e0b',
  },

  // Semantic colors
  semantic: {
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#38bdf8',
  },

  // Border colors
  border: {
    default: 'rgba(148, 163, 184, 0.24)',
    hover: 'rgba(56, 189, 248, 0.45)',
    active: 'rgba(56, 189, 248, 0.6)',
    glass: 'rgba(148, 163, 184, 0.18)',
  },

  // Special effects
  glow: {
    cyan: 'rgba(56, 189, 248, 0.28)',
    teal: 'rgba(45, 212, 191, 0.26)',
    purple: 'rgba(124, 143, 165, 0.3)',
  },
} as const;

export const gradients = {
  primary: 'linear-gradient(135deg, #38bdf8 0%, #2dd4bf 100%)',
  warm: 'linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)',
  cool: 'linear-gradient(135deg, #38bdf8 0%, #7c8fa5 100%)',
  success: 'linear-gradient(135deg, #22c55e 0%, #2dd4bf 100%)',
  danger: 'linear-gradient(135deg, #fb7185 0%, #ef4444 100%)',
  glass: 'linear-gradient(180deg, rgba(17, 31, 49, 0.82) 0%, rgba(13, 24, 40, 0.9) 100%)',
} as const;

export const typography = {
  fontFamily: {
    display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },

  fontSize: {
    xs: '0.75rem',     // 12px
    sm: '0.875rem',    // 14px
    base: '1rem',      // 16px
    lg: '1.125rem',    // 18px
    xl: '1.25rem',     // 20px
    '2xl': '1.5rem',   // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem',  // 36px
    '5xl': '3rem',     // 48px
  },

  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },

  lineHeight: {
    tight: '1.2',
    normal: '1.5',
    relaxed: '1.75',
  },

  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.1em',
    widest: '0.2em',
  },
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.25rem',   // 20px
  6: '1.5rem',    // 24px
  8: '2rem',      // 32px
  10: '2.5rem',   // 40px
  12: '3rem',     // 48px
  16: '4rem',     // 64px
  20: '5rem',     // 80px
  24: '6rem',     // 96px
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(1, 10, 20, 0.24)',
  md: '0 8px 18px rgba(1, 10, 20, 0.24)',
  lg: '0 18px 36px rgba(1, 10, 20, 0.28)',
  xl: '0 26px 54px rgba(1, 10, 20, 0.34)',
  glass: '0 18px 36px rgba(1, 10, 20, 0.28)',
  glow: {
    cyan: '0 0 0 1px rgba(56, 189, 248, 0.28), 0 18px 42px rgba(6, 78, 116, 0.24)',
    teal: '0 0 0 1px rgba(45, 212, 191, 0.26), 0 18px 42px rgba(15, 118, 110, 0.22)',
    purple: '0 0 20px rgba(124, 143, 165, 0.4)',
  },
} as const;

export const transitions = {
  fast: '150ms ease',
  base: '200ms ease',
  slow: '300ms ease',
  spring: '500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const breakpoints = {
  xs: '320px',
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modal: 1040,
  popover: 1050,
  tooltip: 1060,
  toast: 1070,
} as const;

export type ColorVariant = keyof typeof colors.semantic | 'cyan' | 'teal' | 'purple' | 'pink' | 'warm';
export type Size = 'sm' | 'md' | 'lg' | 'xl';
export type Radius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
