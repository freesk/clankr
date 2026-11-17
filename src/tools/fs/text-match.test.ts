import { describe, expect, it } from "vitest";
import { ToolError } from "../../contracts/index.ts";
import { planReplacement } from "./text-match.ts";

function replace(text: string, oldText: string, newText: string, replaceAll = false) {
  return planReplacement({ text, oldText, newText, replaceAll, displayName: "a.txt" });
}

describe("planReplacement", () => {
  it("replaces a single exact match and reports its line", () => {
    const result = replace("one\ntwo\nthree\n", "two", "2");
    expect(result).toEqual({
      text: "one\n2\nthree\n",
      matchCount: 1,
      whitespaceTolerant: false,
      firstLine: 2,
    });
  });

  it("refuses several matches and suggests a longer old or replace_all", () => {
    expect(() => replace("x = 1\nx = 1\n", "x = 1", "x = 2")).toThrow(
      /found 2 times in a\.txt.*replace_all/,
    );
  });

  it("replaces every match with replace_all", () => {
    const result = replace("x = 1\ny\nx = 1\n", "x = 1", "x = 2", true);
    expect(result.text).toBe("x = 2\ny\nx = 2\n");
    expect(result.matchCount).toBe(2);
    expect(result.firstLine).toBe(1);
  });

  it("explains a missing match and points at read_file", () => {
    const error = captureError(() => replace("alpha\n", "beta", "gamma"));
    expect(error).toBeInstanceOf(ToolError);
    expect(error.message).toMatch(/not found in a\.txt.*read_file/);
  });

  it("refuses an empty old and an edit that changes nothing", () => {
    expect(() => replace("a", "", "b")).toThrow(/old is empty/);
    expect(() => replace("a", "a", "a")).toThrow(/the same/);
  });

  it("falls back to whitespace-tolerant matching and keeps the file's indentation", () => {
    const file = "def f():\n    if x:\n        return 1\n    return 2\n";
    // The model dropped the indentation of both old and new.
    const result = replace(file, "if x:\n    return 1", "if y:\n    return 3");
    expect(result.whitespaceTolerant).toBe(true);
    expect(result.firstLine).toBe(2);
    expect(result.text).toBe("def f():\n    if y:\n        return 3\n    return 2\n");
  });

  it("tolerates trailing spaces, inner runs of spaces, and blank lines around old", () => {
    const file = "port:   8080  \nhost: local\n";
    const result = replace(file, "\nport: 8080\n", "port: 9090");
    expect(result.text).toBe("port: 9090\nhost: local\n");
  });

  it("refuses a whitespace-tolerant match that is ambiguous", () => {
    const file = "  a()\nb\n    a()\n";
    expect(() => replace(file, "a()\t", "c()")).toThrow(/ignoring whitespace it matches 2 places/);
  });

  it("matches part of a line exactly without the fallback", () => {
    const result = replace("let a = 1;\n", "a = 1", "a = 2");
    expect(result.whitespaceTolerant).toBe(false);
    expect(result.text).toBe("let a = 2;\n");
  });
});

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected an error");
}
