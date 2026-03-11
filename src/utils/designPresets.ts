/**
 * Shared design system and framework presets used by both
 * Direct Generate (Flow 1) and Advanced Generate (Flow 2) commands.
 */

export const FRAMEWORKS = [
  { label: "React", value: "React 18+ with TypeScript", description: "Component-based SPA", sessionValue: "react" as const },
  { label: "Vue.js", value: "Vue 3 with Composition API and TypeScript", description: "Progressive framework", sessionValue: "vue" as const },
  { label: "Angular", value: "Angular 17+ with TypeScript", description: "Full-featured platform", sessionValue: "angular" as const },
  { label: "Svelte", value: "SvelteKit with TypeScript", description: "Compiler-based framework", sessionValue: "react" as const },
  { label: "Next.js", value: "Next.js 14+ App Router with TypeScript", description: "React meta-framework", sessionValue: "react" as const },
] as const;

export const DESIGN_SYSTEMS = [
  {
    label: "MUI (Material UI)",
    value: "Material UI (MUI) v5",
    cssStrategy: "css-modules" as const,
    preset: {
      name: "Material UI",
      colors: { primary: "#1976d2", secondary: "#dc004e", background: "#ffffff" },
      typography: { fontFamily: "Roboto, sans-serif", headingFont: "Roboto, sans-serif" },
      spacing: { unit: 8 },
      borderRadius: "4px",
    },
  },
  {
    label: "Ant Design (AntD)",
    value: "Ant Design (AntD) v5",
    cssStrategy: "css-modules" as const,
    preset: {
      name: "Ant Design",
      colors: { primary: "#1890ff", secondary: "#722ed1", background: "#ffffff" },
      typography: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", headingFont: "inherit" },
      spacing: { unit: 8 },
      borderRadius: "6px",
    },
  },
  {
    label: "shadcn/ui",
    value: "shadcn/ui with Tailwind CSS",
    cssStrategy: "tailwind" as const,
    preset: {
      name: "shadcn/ui",
      colors: { primary: "#18181b", secondary: "#71717a", background: "#ffffff" },
      typography: { fontFamily: "Inter, sans-serif", headingFont: "Inter, sans-serif" },
      spacing: { unit: 4 },
      borderRadius: "8px",
    },
  },
  {
    label: "Tailwind CSS",
    value: "Tailwind CSS v3 (utility-first)",
    cssStrategy: "tailwind" as const,
    preset: {
      name: "Tailwind CSS",
      colors: { primary: "#3b82f6", secondary: "#8b5cf6", background: "#ffffff" },
      typography: { fontFamily: "ui-sans-serif, system-ui, sans-serif", headingFont: "inherit" },
      spacing: { unit: 4 },
      borderRadius: "8px",
    },
  },
  {
    label: "Chakra UI",
    value: "Chakra UI v2",
    cssStrategy: "styled-components" as const,
    preset: {
      name: "Chakra UI",
      colors: { primary: "#319795", secondary: "#805AD5", background: "#ffffff" },
      typography: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", headingFont: "inherit" },
      spacing: { unit: 4 },
      borderRadius: "6px",
    },
  },
  {
    label: "None (minimal)",
    value: "",
    cssStrategy: "tailwind" as const,
    preset: {
      name: "Minimal",
      colors: { primary: "#000000", secondary: "#666666", background: "#ffffff" },
      typography: { fontFamily: "system-ui, sans-serif", headingFont: "inherit" },
      spacing: { unit: 4 },
      borderRadius: "4px",
    },
  },
] as const;

export const AI_PROVIDERS = [
  { label: "Gemini", value: "gemini" as const, description: "Google AI" },
  { label: "OpenAI", value: "openai" as const, description: "OpenAI API" },
] as const;

/**
 * Build the DESIGN_SYSTEM document content from a selected preset.
 */
export function buildDesignSystemContent(preset: typeof DESIGN_SYSTEMS[number]): string {
  return JSON.stringify(preset.preset, null, 2);
}
