// When `search_meaning` is offered (D90): only while at least one index exists. The fixed
// prompt overhead is already over its budget (CTX-5), so a tool that could only answer
// "nothing is indexed" must not cost tokens on every request.

import type { ToolGroup } from "../contracts/index.ts";
import { hasSearchIndex } from "./index-location.ts";

/** One directory listing, no DuckDB: cheap enough to ask at the start of every turn. */
export async function searchToolGroups(indexDirectory: string): Promise<ToolGroup[]> {
  return (await hasSearchIndex(indexDirectory)) ? ["semantic"] : [];
}
