/**
 * ORA OS design tokens.
 *
 * The default export `theme` is the dark palette (the primary brand experience,
 * matching the supplied screenshots). For light-theme support, screens that
 * need to be theme-reactive should call `useColors()` from `@/src/auth`
 * (returns the active palette) instead of using `theme.color.*` directly.
 *
 * Constants like spacing / radius / font are shared across both themes.
 */

export const darkColors = {
  surface: "#0a0a0c",
  onSurface: "#F7F7F8",
  surfaceSecondary: "#151518",
  onSurfaceSecondary: "#B4B4B8",
  surfaceTertiary: "#1C1C20",
  onSurfaceTertiary: "#E2E2E4",
  brand: "#E1B168",
  brandSecondary: "#C99645",
  brandTertiary: "#291F11",
  onBrand: "#1A1104",
  border: "#222226",
  borderStrong: "#333338",
  divider: "#1F1F23",
  error: "#8B3A3A",
  success: "#4A7A59",
};

// Carefully tuned for AA contrast against the warm gold accent.
// Light surfaces stay warm-white, text stays near-black for readability,
// brand colour shifts a touch darker so it reads against bright surfaces.
export const lightColors = {
  surface: "#FAF8F4",          // warm off-white page bg
  onSurface: "#16161A",        // near-black body text
  surfaceSecondary: "#FFFFFF", // card bg
  onSurfaceSecondary: "#5B5B62",
  surfaceTertiary: "#F1ECE2",
  onSurfaceTertiary: "#22222A",
  brand: "#B7833F",            // darker gold for contrast on white
  brandSecondary: "#8C5F26",
  brandTertiary: "#F6E9CF",    // pale gold tint for icon backgrounds
  onBrand: "#FFFFFF",
  border: "#E6E1D6",
  borderStrong: "#D2CCBC",
  divider: "#EFEAE0",
  error: "#B83A3A",
  success: "#2F7A59",
};

export type ColorPalette = typeof darkColors;

export const theme = {
  color: darkColors,
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    display: "Fraunces",
    text: "Satoshi",
  },
  size: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
};

export const palettes = { light: lightColors, dark: darkColors } as const;
