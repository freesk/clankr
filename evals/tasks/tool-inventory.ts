// The v1 tool inventory (PRD Appendix B). Golden tasks may only require these
// tools, and the PERM-6 check runs against this list until the real registry
// exists. When Appendix B changes, change this list in the same commit.

export const plannedToolNames = [
  "find_files",
  "search_content",
  "list_dir",
  "read_file",
  "read_result",
  "write_file",
  "edit_file",
  "make_dir",
  "move",
  "copy",
  "delete",
  "delegate",
  "view_image",
  "inspect_data",
  "query_sql",
  "run_js",
  "make_chart",
  "export_table",
] as const;
