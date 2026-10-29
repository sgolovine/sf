# Screenshots

Screenshots are evidence for changes to the sf web UI (`src/web`). Other changes skip them; the PR's `## Screenshots` section then says why in one line.

§1–§3 cover capture for any workflow. §4 covers uploading into a GitHub PR body. `<r>` is `sgolovine/sf`.

## 1. Plan scenarios

For each scenario record the route or command, state, viewport or window size, and color scheme. UI changes get comparable Before/After pairs. Docs, CLI, and API changes get the rendered output, with a Before when it shows the change. Choose the smallest set that shows every visible change.

Keep all captures in a run directory outside every checkout, such as `${TMPDIR:-/tmp}/screenshots/<repo>/<slug-or-pr-n>/`. Name files `NN-before-<scenario>.png` and `NN-after-<scenario>.png`.

## 2. Runtime

Never use the Project's running sf server or its `.sf`; start your own against a temporary Project.

1. Seed a temporary Project with the Boards and Stories that each scenario needs:
   ```sh
   tmp=$(mktemp -d)
   pnpm sf:dev board create Demo --key DEMO --project "$tmp"
   pnpm sf:dev story create DEMO --title "Example" --stage todo --project "$tmp"
   ```
2. From the Story Worktree, start sf as a background process of your thread. It prints `sf ready: <url>`; use that URL, which includes the auth token:
   ```sh
   pnpm sf:dev start --project "$tmp" --no-open --agent <agent> --model <model> --app <app> \
     --can-spawn-threads false --can-spawn-subagents false
   ```
3. For Before images, add a detached worktree at the merge base and start a second server from it on its own temporary Project, seeded the same way:
   ```sh
   git worktree add --detach <run-dir>/base $(git merge-base origin/master HEAD)
   ```
4. When you are done, run `pnpm sf:dev stop --project "$tmp"` for each server you started (or stop its process), remove the base worktree with `git worktree remove <path>`, and delete the temporary Projects.

## 3. Capture

Pick the first available tool, in this order:

1. The harness's built-in browser (Codex app, Claude app, T3 Code preview tools, or similar).
2. A browser plugin or MCP server exposed by the harness.
3. A headless or scriptable browser: BetterWright, Playwright, Puppeteer, or another installed one.
4. System screenshot tools, when no browser is available or the target is not a webpage (native app, terminal, simulator, desktop).

### Browser capture

1. Open a tab or page you own and use it for every later step. Do not drive tabs you did not open.
2. Set the same viewport for every pair (1280×800 unless the scenario needs another). Set the color scheme when the scenario fixes one.
3. Navigate to the dev server port and route, or the public URL.
4. Reach the state, then wait for a stable element that proves it rendered.
5. Take the screenshot and save it into the run directory under its scenario name.

Docs, CLI, and API output:
- Pushed Markdown docs: open GitHub's rendered file view `https://github.com/<r>/blob/<sha>/<path>`.
- CLI or API output: write it, HTML-escaped, into a `<pre>` in an HTML file in the run directory and capture that page. If the browser cannot open `file://` URLs, serve it with `python3 -m http.server <port> --bind 127.0.0.1 --directory <run-dir>`.

### System capture

Capture only the target window or region, never the full desktop when it may show unrelated windows. Use whatever the platform provides, for example:

- Linux: `grim -g "$(slurp)"` (Wayland), `gnome-screenshot -w`, `spectacle -a -b -o`, `import -window <id>` or `scrot -u` (X11).
- macOS: `screencapture -l <window-id>` or `screencapture -R x,y,w,h`.
- Windows: PowerShell with `System.Drawing` / `CopyFromScreen`.
- iOS simulator: `xcrun simctl io booted screenshot <file>.png`. Android: `adb exec-out screencap -p > <file>.png`.
- Terminal UIs: run in a fixed-size terminal or `tmux` pane and capture that window, or render the output as in the CLI case above.

If no capture tool works and none can be installed without changing shared system state, treat it as a blocker (§5).

### Inspect

Check each image: fully rendered, right state and revision, comparable to its pair, no secrets, personal data, or unrelated windows. Retake bad captures.

## 4. Upload into the PR body

GitHub has no image-upload API. Use GitHub's own uploader in a browser signed in as the user: the harness browser, a browser plugin, or a persistent browser profile (such as BetterWright) that holds the user's GitHub session. The browser must be able to evaluate JavaScript in the page. A fresh headless browser without the user's session cannot upload; do not ask for or handle the user's credentials. Never invent upload endpoints or image URLs.

1. Open the PR page in your tab. Confirm sign-in: evaluating `document.querySelector('meta[name="user-login"]')?.content` returns the user's login.
2. Find the new-comment composer from page state (list `textarea` elements with `id`, `name`, `aria-label`, `placeholder`). Note a selector that matches exactly one textarea (`#new_comment_field` on PR pages). Do not type into it.
3. For each PNG:
   1. Store the bytes in the repository as a blob wrapped in a parentless commit. Never create or update a ref:
      ```sh
      base64 -w0 <png> | jq -Rs '{encoding:"base64",content:.}' > <png>.json
      gh api repos/<r>/git/blobs --input <png>.json --jq .sha    # <blob sha>
      sha256sum <png>
      tree=$(jq -n --arg s '<blob sha>' '{tree:[{path:"<name>.png",mode:"100644",type:"blob",sha:$s}]}' \
        | gh api repos/<r>/git/trees --input - --jq .sha)
      jq -n --arg t "$tree" '{message:"screenshot transfer",tree:$t,parents:[]}' \
        | gh api repos/<r>/git/commits --input - --jq .sha    # <commit sha>
      ```
      On macOS, use `base64 -i <png>` and `shasum -a 256 <png>`.
   2. In one page evaluation, fetch the bytes through GitHub's same-origin raw route, check the hash, drop the file on the composer, wait for the upload, and clear the composer. **Never submit the comment.** Keep the default fetch credentials; `credentials:'include'` fails on the redirect to `raw.githubusercontent.com`. The route works on public repositories; on a private repository it is unconfirmed, so treat a non-OK status there as an upload blocker that names the status.
      ```js
      (async () => {
        const ta = document.querySelector('<composer selector>');
        const res = await fetch('/<r>/raw/<commit sha>/<name>.png');
        if (!res.ok) return { error: `fetch ${res.status} ${res.statusText}`, url: res.url };
        const bytes = new Uint8Array(await res.arrayBuffer());
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash !== '<sha256>') return { error: 'hash mismatch', hash, size: bytes.length };
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], '<NN-after-scenario>.png', { type: 'image/png' }));
        ta.focus();
        for (const type of ['dragenter', 'dragover', 'drop'])
          ta.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        let tag;
        for (let i = 0; i < 120 && !tag; i++) {
          await new Promise(r => setTimeout(r, 500));
          tag = ta.value.match(/<img [^>]*src="https:\/\/github\.com\/user-attachments\/assets\/[^"]+"[^>]*>|!\[[^\]]*\]\(https:\/\/github\.com\/user-attachments\/assets\/[^)]+\)/)?.[0];
        }
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return { tag, cleared: ta.value === '' };
      })()
      ```
      Uploads take about 1–2 s. An `Uploading` placeholder may never appear, so wait for the `user-attachments` URL. GitHub inserts an `<img width=".." height=".." alt=".." src="https://github.com/user-attachments/assets/<uuid>" />` tag; record it as returned. If `tag` is empty, retry with a `paste` event (`new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData: dt})`), then by setting `.files = dt.files` on the composer's `input[type=file]` and dispatching a bubbling `change` event. If the browser tool supports native file upload, setting the composer's file input from the local PNG also works and skips step 3.1. If the fetch fails or the hash differs, the upload is a blocker (§5).
4. Write the image tags into the body file's `## Screenshots` section and apply it with `gh pr edit <n> --repo <r> --body-file <file>`:
   ```markdown
   ## Screenshots

   <one sentence on what reviewers should notice>

   Captured at `<short head OID>`.

   ### <scenario>

   | Before | After |
   | --- | --- |
   | <before img tag> | <after img tag> |
   ```
   Use labeled images without a table for output that has no Before. The `Captured at` line names the commit the After images show; reviewers use it to detect stale screenshots.
5. Reload the PR page. Confirm the description renders every image (count loaded `img` elements in the PR body with `naturalWidth > 0`) and take a screenshot.

## 5. Failure and cleanup

If capture or upload fails, still open or keep the PR. Keep the captures. Write the exact blocker in `## Screenshots` or the report (what failed, at which step, what was tried). Report it. Do not post local paths.

Close every tab or browser you opened. Stop the processes you started and remove temporary worktrees.

The transfer in §4.3.1 leaves a blob, a tree, and a commit with no ref in the repository. The API cannot delete them. GitHub may garbage-collect them later, but until then anyone with read access can fetch them by SHA; on a public repository that is anyone. Upload only images you would post publicly, and name the transfer commit SHAs in the run notes so the user can ask GitHub Support to purge them.
