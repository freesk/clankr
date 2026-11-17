// A small glob matcher for file names and single path segments.
// Supports `*`, `?`, `[abc]`, and `{a,b}`. Matching ignores case, as the default
// macOS volume does, so a model asking for "*.PDF" still finds "report.pdf".

const globCharacters = /[*?[\]{}]/;

export function hasGlobCharacters(pattern: string): boolean {
  return globCharacters.test(pattern);
}

/** Matches a whole name against a glob. A name pattern never crosses a `/`. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index] as string;
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else if (character === "[") {
      const closing = glob.indexOf("]", index + 1);
      if (closing === -1) {
        source += "\\[";
      } else {
        const body = glob.slice(index + 1, closing).replace(/^!/, "^");
        source += `[${body.replace(/\\/g, "\\\\")}]`;
        index = closing;
      }
    } else if (character === "{") {
      braceDepth++;
      source += "(?:";
    } else if (character === "}" && braceDepth > 0) {
      braceDepth--;
      source += ")";
    } else if (character === "," && braceDepth > 0) source += "|";
    else source += escapeRegExp(character);
  }
  // An unclosed brace would leave the expression invalid; treat the rest literally instead.
  if (braceDepth > 0) return new RegExp(`^${escapeRegExp(glob)}$`, "i");
  return new RegExp(`^${source}$`, "i");
}

/**
 * Builds the name test for `find_files`. Plain text with no wildcard means
 * "the name contains this", which is what a person usually means by "find invoice".
 */
export function nameMatcher(pattern: string): (name: string) => boolean {
  if (hasGlobCharacters(pattern)) {
    const expression = globToRegExp(pattern);
    return (name) => expression.test(name);
  }
  const needle = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

/** Expands `{a,b}` groups, so a backend without brace support can run one query per variant. */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  const close = open === -1 ? -1 : pattern.indexOf("}", open);
  if (open === -1 || close === -1) return [pattern];
  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  const options = pattern.slice(open + 1, close).split(",");
  return options.flatMap((option) => expandBraces(head + option + tail));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
