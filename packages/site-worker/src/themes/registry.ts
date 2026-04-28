export interface ThemeVariant {
  id: string;
  label: string;
  enabled: boolean;
}

export const THEME_REGISTRY: Readonly<ThemeVariant[]> = [
  { id: 'modern',    label: 'Modern',    enabled: true  },
  { id: 'editorial', label: 'Editorial', enabled: false },
  { id: 'bold',      label: 'Bold',      enabled: false },
  { id: 'classic',   label: 'Classic',   enabled: false },
] as const;

export function isEnabledTheme(id: string): boolean {
  return THEME_REGISTRY.some((t) => t.id === id && t.enabled);
}
