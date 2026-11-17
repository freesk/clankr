// File kinds by extension. `find_files` filters by them, and `read_file` uses them to
// point the model at the right tool for a file it cannot read as text.
// The same extension lists drive both Spotlight and the walk, so the two return the same files.

import { extname } from "node:path";

export const fileKinds = [
  "file",
  "folder",
  "image",
  "pdf",
  "document",
  "spreadsheet",
  "presentation",
  "audio",
  "video",
  "archive",
  "code",
] as const;

export type FileKind = (typeof fileKinds)[number];

/** Kinds defined by extension. "file" and "folder" are defined by entry type instead. */
export const kindExtensions: Record<Exclude<FileKind, "file" | "folder">, readonly string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "tif", "tiff", "bmp", "svg", "dng"],
  pdf: ["pdf"],
  document: ["pdf", "doc", "docx", "pages", "rtf", "odt", "txt", "md"],
  spreadsheet: ["xlsx", "xls", "csv", "tsv", "numbers", "ods"],
  presentation: ["ppt", "pptx", "key", "odp"],
  audio: ["mp3", "m4a", "wav", "aac", "flac", "aiff", "ogg"],
  video: ["mp4", "mov", "m4v", "avi", "mkv", "webm"],
  archive: ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg"],
  code: [
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cpp",
    "cs",
    "php",
    "sh",
    "sql",
    "html",
    "css",
    "json",
    "yaml",
    "yml",
    "toml",
  ],
};

/** Lower-case extension without the dot, or "" when there is none. */
export function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase();
}

/** Whether an entry belongs to a kind. */
export function isOfKind(name: string, isDirectory: boolean, kind: FileKind): boolean {
  if (kind === "folder") return isDirectory;
  if (isDirectory) return false;
  if (kind === "file") return true;
  return kindExtensions[kind].includes(extensionOf(name));
}
