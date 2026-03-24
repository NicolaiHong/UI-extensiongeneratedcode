/**
 * Skill Loader - Load and apply skills from GitHub repositories
 *
 * Skills enhance prompts for better UI/UX generation.
 * Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
 */

import * as vscode from "vscode";

export interface Skill {
  name: string;
  description: string;
  actionsEnhancer?: string;
  designEnhancer?: string;
  templates?: {
    actions?: string[];
    design?: string[];
  };
}

export interface SkillConfig {
  name: string;
  repoUrl: string;
  branch?: string;
}

// Default skill configuration
export const UI_UX_PRO_MAX_SKILL: SkillConfig = {
  name: "ui-ux-pro-max",
  repoUrl: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
  branch: "main",
};

// Cached skills
const skillCache = new Map<string, Skill>();

/**
 * Load skill from GitHub repository
 */
export async function loadSkill(config: SkillConfig): Promise<Skill | null> {
  const cacheKey = `${config.repoUrl}:${config.branch || "main"}`;

  // Check cache first
  if (skillCache.has(cacheKey)) {
    return skillCache.get(cacheKey)!;
  }

  try {
    // Try to fetch skill.json from the repo
    const branch = config.branch || "main";
    const rawUrl = config.repoUrl
      .replace("github.com", "raw.githubusercontent.com")
      .replace(/\/$/, "");
    const skillJsonUrl = `${rawUrl}/${branch}/skill.json`;

    const response = await fetch(skillJsonUrl);
    if (!response.ok) {
      console.warn(`[SkillLoader] Failed to fetch skill from ${skillJsonUrl}`);
      return getDefaultSkill(config.name);
    }

    const skill = (await response.json()) as Skill;
    skillCache.set(cacheKey, skill);
    return skill;
  } catch (error) {
    console.warn(`[SkillLoader] Error loading skill: ${error}`);
    return getDefaultSkill(config.name);
  }
}

/**
 * Get default skill when remote fetch fails
 */
function getDefaultSkill(name: string): Skill {
  return {
    name,
    description:
      "UI/UX Pro Max Skill - Enhance prompts for better UI generation",
    actionsEnhancer: `
You are a UI/UX expert. Enhance the user's action requirements to be more specific and actionable.
Consider:
- User flows and interactions
- Error states and edge cases
- Loading and empty states
- Accessibility requirements
- Mobile responsiveness
`,
    designEnhancer: `
You are a UI/UX designer. Enhance the user's design preferences to create a cohesive design system.
Consider:
- Color palette with primary, secondary, accent colors
- Typography hierarchy
- Spacing and layout system
- Component variants (buttons, inputs, cards)
- Dark/light mode support
- Micro-interactions and animations
`,
    templates: {
      actions: [
        "CRUD operations with optimistic updates",
        "Search with debouncing and filters",
        "Pagination with infinite scroll option",
        "Form validation with real-time feedback",
        "Toast notifications for actions",
      ],
      design: [
        "Modern minimalist with subtle shadows",
        "Dark mode with vibrant accents",
        "Glassmorphism with blur effects",
        "Neumorphism soft UI",
        "Material Design 3 principles",
      ],
    },
  };
}

/**
 * Enhance actions prompt using skill
 */
export function enhanceActionsPrompt(
  originalPrompt: string,
  skill: Skill,
): string {
  if (!skill.actionsEnhancer) {
    return originalPrompt;
  }

  const enhanced = `
${skill.actionsEnhancer}

User's requirements:
${originalPrompt || "Auto-detect from API endpoints"}

Enhanced requirements:
- Implement the requested features with proper error handling
- Add loading states for async operations
- Include empty states when no data
- Ensure mobile-responsive layout
- Add keyboard navigation support
`;

  return enhanced.trim();
}

/**
 * Enhance design prompt using skill
 */
export function enhanceDesignPrompt(
  originalPrompt: string,
  skill: Skill,
): string {
  if (!skill.designEnhancer) {
    return originalPrompt;
  }

  const enhanced = `
${skill.designEnhancer}

User's preferences:
${originalPrompt || "Modern, clean design"}

Enhanced design specifications:
- Use a consistent color palette throughout
- Implement responsive typography scale
- Add subtle micro-interactions
- Ensure WCAG 2.1 AA contrast compliance
- Include hover/focus states for all interactive elements
`;

  return enhanced.trim();
}

/**
 * Show skill picker dialog
 */
export async function pickSkillOption(): Promise<
  { useSkill: boolean; enhance: boolean } | undefined
> {
  const option = await vscode.window.showQuickPick(
    [
      {
        label: "$(sparkle) Use Skill: ui-ux-pro-max",
        description: "Enhance prompts with UI/UX best practices",
        value: "skill",
      },
      {
        label: "$(edit) Manual + Enhance",
        description: "Write prompt manually, then enhance with skill",
        value: "enhance",
      },
      {
        label: "$(pencil) Manual only",
        description: "Write prompt manually without enhancement",
        value: "manual",
      },
    ],
    {
      title: "Prompt Enhancement",
      placeHolder: "How do you want to create your prompts?",
    },
  );

  if (!option) {
    return undefined;
  }

  return {
    useSkill: option.value === "skill",
    enhance: option.value === "skill" || option.value === "enhance",
  };
}

/**
 * Show design templates from skill
 */
export async function pickDesignTemplate(
  skill: Skill,
): Promise<string | undefined> {
  const templates = skill.templates?.design || [];
  if (templates.length === 0) {
    return undefined;
  }

  const items = [
    {
      label: "$(edit) Custom",
      description: "Enter custom design preferences",
      value: "",
    },
    ...templates.map((t) => ({
      label: `$(paintcan) ${t}`,
      description: "",
      value: t,
    })),
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: "Design Template",
    placeHolder: "Choose a design style or enter custom",
  });

  return pick?.value;
}

/**
 * Show actions templates from skill
 */
export async function pickActionsTemplate(
  skill: Skill,
): Promise<string | undefined> {
  const templates = skill.templates?.actions || [];
  if (templates.length === 0) {
    return undefined;
  }

  const items = [
    {
      label: "$(edit) Custom",
      description: "Enter custom action requirements",
      value: "",
    },
    ...templates.map((t) => ({
      label: `$(zap) ${t}`,
      description: "",
      value: t,
    })),
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: "Actions Template",
    placeHolder: "Choose an action template or enter custom",
  });

  return pick?.value;
}
