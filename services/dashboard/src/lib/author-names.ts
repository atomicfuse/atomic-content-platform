/**
 * Curated name lists for generating realistic author pen names.
 * ~30 first names x ~30 last names = ~900 unique combinations.
 */
const FIRST_NAMES = [
  "James", "Sarah", "Michael", "Elena", "David",
  "Olivia", "Daniel", "Sophia", "Andrew", "Maya",
  "Nathan", "Rachel", "Marcus", "Ava", "Ethan",
  "Lily", "Ryan", "Chloe", "Lucas", "Emma",
  "Alex", "Zoe", "Ben", "Mia", "Sam",
  "Julia", "Leo", "Hannah", "Max", "Nora",
];

const LAST_NAMES = [
  "Mitchell", "Carter", "Rodriguez", "Chen", "Bennett",
  "Brooks", "Sullivan", "Kim", "Parker", "Hayes",
  "Foster", "Reed", "Morgan", "Torres", "Cooper",
  "Bell", "Ward", "Rivera", "Gray", "Scott",
  "Adams", "Murphy", "Price", "Ross", "Perry",
  "Powell", "Long", "Hughes", "Sanders", "West",
];

export function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
