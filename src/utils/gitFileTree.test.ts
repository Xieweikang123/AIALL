import { describe, expect, it } from "vitest";
import { buildGitFileTree, collectGitFolderPaths } from "./gitFileTree";

describe("buildGitFileTree", () => {
  it("groups files by folder and sorts dirs before files", () => {
    const tree = buildGitFileTree([
      { path: "Program.cs", status: "M", staged: false },
      { path: "Services/DataSyncService.cs", status: "A", staged: false },
      { path: "appsettings.json", status: "M", staged: false },
    ]);

    expect(tree.map((n) => n.name)).toEqual(["Services", "appsettings.json", "Program.cs"]);
    expect(tree[0].isDirectory).toBe(true);
    expect(tree[0].children?.map((n) => n.name)).toEqual(["DataSyncService.cs"]);
    expect(tree[0].children?.[0].file?.path).toBe("Services/DataSyncService.cs");
  });

  it("nests multiple levels", () => {
    const tree = buildGitFileTree([
      { path: "src/a.ts", status: "M", staged: false },
      { path: "src/lib/b.ts", status: "M", staged: false },
    ]);

    expect(tree[0].name).toBe("src");
    expect(tree[0].children?.map((n) => n.name)).toEqual(["lib", "a.ts"]);
    expect(tree[0].children?.[0].children?.[0].name).toBe("b.ts");
  });

  it("collectGitFolderPaths returns all directory paths", () => {
    const tree = buildGitFileTree([
      { path: "src/lib/b.ts", status: "M", staged: false },
    ]);
    expect(collectGitFolderPaths(tree)).toEqual(["src", "src/lib"]);
  });
});
