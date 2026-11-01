import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { BoardSnapshot } from "#model/project";
import { setupProject, tempDir, user } from "./helpers.ts";

// Bundle the web component with its JSX/alias configuration for the Node test runner.
test("configured Stages have named creation buttons after cards; Unknown Stage does not", async () => {
  const outfile = path.join(tempDir(), "board-view.cjs");
  await build({
    stdin: {
      contents: `import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { BoardView } from "./src/web/components/BoardView.tsx";
        export const render = (props) => renderToStaticMarkup(createElement(BoardView, props));`,
      resolveDir: process.cwd(),
    },
    tsconfig: "src/web/tsconfig.json",
    jsx: "automatic",
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    plugins: [
      {
        name: "stub-browser-client",
        setup(builder) {
          builder.onLoad({ filter: /web\/api\/client\.ts$/ }, () => ({ contents: "export const sfApi = {};" }));
        },
      },
    ],
  });
  const { render } = await import(pathToFileURL(outfile).href);
  const { svc } = await setupProject();
  await svc.updateStage("DEV", "todo", { name: "Ready for Development" });
  await svc.createStory("DEV", { title: "Existing card" }, user);
  const snapshot = svc.snapshot();
  assert.ok(snapshot);
  const board: BoardSnapshot = snapshot.boards[0]!;
  board.stories.push({ key: "DEV-999", board: board.id, title: "Orphan", stage: "unknown", fields: {}, body: "" });
  const html: string = render({
    board,
    runtime: snapshot.runtime,
    act: async () => true,
    onOpenStory: () => {},
    onOpenStages: () => {},
    onCreateStory: () => {},
  });
  assert.equal((html.match(/aria-label="New Story in /g) ?? []).length, board.config.stages.length);
  for (const stage of board.config.stages) {
    assert.ok(html.includes(`aria-label="New Story in ${stage.name}"`));
  }
  assert.ok(html.indexOf("Existing card") < html.indexOf('aria-label="New Story in Backlog"'));
  // Every column, including Unknown Stage, scrolls its cards in a region that ends before the creation button.
  assert.equal((html.match(/overflow-y-auto/g) ?? []).length, board.config.stages.length + 1);
  const backlog = html.slice(0, html.indexOf('aria-label="New Story in Backlog"'));
  assert.ok(backlog.lastIndexOf("</div>") > backlog.indexOf("Existing card"));
  assert.ok(html.includes("Unknown Stage"));
  assert.doesNotMatch(html.slice(html.indexOf("Unknown Stage")), /New Story/);
});
