/**
 * Northline Design Tokens
 * Futuristic maritime operations aesthetic
 */

export const colors = {
  // Core backgrounds - Deep ocean/space theme
  bg: {
    primary: '#050811',
    secondary: '#0a1220',
    tertiary: '#111a2e',
    elevated: '#162035',
    glass: 'rgba(17, 26, 46, 0.7)',
    glassHover: 'rgba(22, 32, 53, 0.85)',
  },

  // Text colors
  ink: {
    primary: '#ffffff',
    secondary: '#a0aec0',
    muted: '#64748b',
    inverse: '#050811',
  },

  // Accent colors - Futuristic maritime palette
  accent: {
    cyan: '#00d4ff',
    teal: '#40e0b7',
    purple: '#a855f7',
    pink: '#ec4899',
    warm: '#f59e0b',
  },

  // Semantic colors
  semantic: {
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#00d4ff',
  },

  // Border colors
  border: {
    default: 'rgba(255, 255, 255, 0.08)',
    hover: 'rgba(0, 212, 255, 0.3)',
    active: 'rgba(0, 212, 255, 0.5)',
    glass: 'rgba(255, 255, 255, 0.14)',
  },

  // Special effects
  glow: {
    cyan: 'rgba(0, 212, 255, 0.35)',
    teal: 'rgba(64, 224, 183, 0.35)',
    purple: 'rgba(168, 85, 247, 0.35)',
  },
} as const;

export const gradients = {
  primary: 'linear-gradient(135deg, #00d4ff 0%, #40e0b7 50%, #a855f7 100%)',
  warm: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
  cool: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
  success: 'linear-gradient(135deg, #10b981 0%, #40e0b7 100%)',
  danger: 'linear-gradient(135deg, #ef4444 0%, #ec4899 100%)',
  glass: 'linear-gradient(180deg, rgba(17, 26, 46, 0.8) 0%, rgba(11, 17, 32, 0.9) 100%)',
} as const;

export const typography = {
  fontFamily: {
    display: '"Space Grotesk", "Inter", system-ui, sans-serif',
    body: '"Inter", "Sora", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace',
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
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  '2xl': '28px',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 2px 4px rgba(0, 0, 0, 0.3)',
  md: '0 4px 12px rgba(0, 0, 0, 0.4)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
  xl: '0 16px 40px rgba(0, 0, 0, 0.6)',
  glass: '0 8px 32px rgba(0, 0, 0, 0.4)',
  glow: {
    cyan: '0 0 20px rgba(0, 212, 255, 0.4)',
    teal: '0 0 20px rgba(64, 224, 183, 0.4)',
    purple: '0 0 20px rgba(168, 85, 247, 0.4)',
  },
} as const;

export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  base: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '350ms cubic-bezier(0.4, 0, 0.2, 1)',
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
  dropdown: 100,
  sticky: 200,
  modal: 300,
  popover: 400,
  toast: 500,
  tooltip: 600,
  modalOverlay: 700,
  top: 9999,
} as const;

// CSS Variables for runtime use
export const cssVariables = `
:root {
  /* Colors */
  --bg-primary: ${colors.bg.primary};
  --bg-secondary: ${colors.bg.secondary};
  --bg-tertiary: ${colors.bg.tertiary};
  --bg-elevated: ${colors.bg.elevated};
  --bg-glass: ${colors.bg.glass};
  --bg-glass-hover: ${colors.bg.glassHover};

  --ink-primary: ${colors.ink.primary};
  --ink-secondary: ${colors.ink.secondary};
  --ink-muted: ${colors.ink.muted};
  --ink-inverse: ${colors.ink.inverse};

  --accent-cyan: ${colors.accent.cyan};
  --accent-teal: ${colors.accent.teal};
  --accent-purple: ${colors.accent.purple};
  --accent-pink: ${colors.accent.pink};
  --accent-warm: ${colors.accent.warm};

  --success: ${colors.semantic.success};
  --warning: ${colors.semantic.warning};
  --danger: ${colors.semantic.danger};
  --info: ${colors.semantic.info};

  --border-default: ${colors.border.default};
  --border-hover: ${colors.border.hover};
  --border-active: ${colors.border.active};
  --border-glass: ${colors.border.glass};

  --glow-cyan: ${colors.glow.cyan};
  --glow-teal: ${colors.glow.teal};
  --glow-purple: ${colors.glow.purple};

  /* Gradients */
  --gradient-primary: ${gradients.primary};
  --gradient-warm: ${gradients.warm};
  --gradient-cool: ${gradients.cool};
  --gradient-success: ${gradients.success};
  --gradient-danger: ${gradients.danger};

  /* Typography */
  --font-display: ${typography.fontFamily.display};
  --font-body: ${typography.fontFamily.body};
  --font-mono: ${typography.fontFamily.mono};

  /* Spacing */
  --space-1: ${spacing[1]};
  --space-2: ${spacing[2]};
  --space-3: ${spacing[3]};
  --space-4: ${spacing[4]};
  --space-5: ${spacing[5]};
  --space-6: ${spacing[6]};
  --space-8: ${spacing[8]};
  --space-10: ${spacing[10]};
  --space-12: ${spacing[12]};

  /* Border Radius */
  --radius-sm: ${borderRadius.sm};
  --radius-md: ${borderRadius.md};
  --radius-lg: ${borderRadius.lg};
  --radius-xl: ${borderRadius.xl};
  --radius-full: ${borderRadius.full};

  /* Shadows */
  --shadow-sm: ${shadows.sm};
  --shadow-md: ${shadows.md};
  --shadow-lg: ${shadows.lg};
  --shadow-xl: ${shadows.xl};
  --shadow-glass: ${shadows.glass};
  --shadow-glow-cyan: ${shadows.glow.cyan};
  --shadow-glow-teal: ${shadows.glow.teal};

  /* Transitions */
  --transition-fast: ${transitions.fast};
  --transition-base: ${transitions.base};
  --transition-slow: ${transitions.slow};
  --transition-spring: ${transitions.spring};

  /* Z-Index */
  --z-dropdown: ${zIndex.dropdown};
  --z-sticky: ${zIndex.sticky};
  --z-modal: ${zIndex.modal};
  --z-popover: ${zIndex.popover};
  --z-toast: ${zIndex.toast};
  --z-tooltip: ${zIndex.tooltip};
}
`;

export type ColorVariant = keyof typeof colors.semantic | 'cyan' | 'teal' | 'purple' | 'pink' | 'warm';
export type Size = 'sm' | 'md' | 'lg' | 'xl';
export type Radius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
