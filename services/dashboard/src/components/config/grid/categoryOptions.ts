import type { CategoryItem } from "@/lib/reference-data";
import type { ChipOption } from "./ChipMultiSelect";

/**
 * Aggregator taxonomy → chip options, ordered main category then its subcategories (grouped under
 * the main category's name). Stored values are category names, matched case-insensitively by the
 * site-worker against each story's categories.
 */
export function categoryOptions(categories: CategoryItem[]): ChipOption[] {
  const byName = (a: CategoryItem, b: CategoryItem): number => a.name.localeCompare(b.name);
  const out: ChipOption[] = [];
  for (const top of categories.filter((c) => !c.parent_id).sort(byName)) {
    out.push({ value: top.name, label: top.name });
    for (const sub of categories.filter((c) => c.parent_id === top.id).sort(byName)) {
      out.push({ value: sub.name, label: sub.name, group: top.name });
    }
  }
  return out;
}
