export interface FontEntry {
  id: string;
  family: string;
  category: 'sans-serif' | 'serif' | 'display';
  weights: number[];
}

export const FONT_REGISTRY: readonly FontEntry[] = [
  { id: 'inter',         family: 'Inter',            category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'poppins',       family: 'Poppins',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'manrope',       family: 'Manrope',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'dm-sans',       family: 'DM Sans',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'ibm-plex-sans', family: 'IBM Plex Sans',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'source-sans-3', family: 'Source Sans 3',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'roboto',        family: 'Roboto',           category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'space-grotesk', family: 'Space Grotesk',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'lora',          family: 'Lora',             category: 'serif',      weights: [400, 500, 600, 700] },
  { id: 'merriweather',  family: 'Merriweather',     category: 'serif',      weights: [400, 700] },
  { id: 'playfair',      family: 'Playfair Display', category: 'serif',      weights: [400, 500, 600, 700] },
  { id: 'bebas-neue',    family: 'Bebas Neue',       category: 'display',    weights: [400] },
] as const;

export function findFontByFamily(family: string): FontEntry | undefined {
  const norm = family.trim().toLowerCase();
  return FONT_REGISTRY.find((f) => f.family.toLowerCase() === norm);
}
