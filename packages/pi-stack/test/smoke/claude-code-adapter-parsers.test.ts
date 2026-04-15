import { describe, expect, it } from "vitest";
import { parseWhichLikeOutput } from "../../extensions/claude-code-adapter";

describe("claude-code adapter parsers", () => {
  it("parseWhichLikeOutput retorna primeira linha válida", () => {
    expect(parseWhichLikeOutput("C:/tools/claude.exe\nC:/other/claude.exe\n")).toBe("C:/tools/claude.exe");
    expect(parseWhichLikeOutput("\n\n")).toBeUndefined();
  });
});
