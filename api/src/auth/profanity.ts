import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

// Real names that contain a blocked word. The library already allows most of these (Cassandra,
// Hancock, Scunthorpe…); these are the ones it would otherwise block.
const ALLOWED_NAMES = ["dickson", "dickens", "dickinson", "analise", "annalise", "analisa"];

const { blacklistedTerms, whitelistedTerms } = englishDataset.build();
const matcher = new RegExpMatcher({
  blacklistedTerms,
  whitelistedTerms: [...(whitelistedTerms ?? []), ...ALLOWED_NAMES],
  ...englishRecommendedTransformers,
});

const SEPARATORS = /[\s._\-*~]+/g;

// "f u c k" or "f.u.c.k" → "fuck": joins runs of single letters split by spaces or punctuation.
function joinSpacedLetters(text: string): string {
  return text.replace(/\b\w(?:[\s._\-*~]+\w\b)+/g, (run) => run.replace(SEPARATORS, ""));
}

// True if the text contains a swear word or slur, including disguised spellings like "sh1t".
export function isProfane(text: string): boolean {
  return matcher.hasMatch(text) || matcher.hasMatch(joinSpacedLetters(text));
}
