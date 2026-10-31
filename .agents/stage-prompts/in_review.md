If `requires_review_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-review/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story and its `pr_url` as the input. Do not change code.

First show this Story again and recheck its dependencies and delivered changes. Reconcile this Stage's work before advancing; dependency completion is not automatic advancement.

Then act on the verdict, using the sf commands above:

- **Waiting on dependencies:** save your work (commit and push code if applicable), then run `story wait <KEY> --depends-on <KEY,KEY>` with the Worker and Project arguments from the brief. This atomically records the complete dependency list and releases the Claim. Stay in this Stage. Do not set HIL for observable Story dependencies. If all prerequisites are already Done, sf can resume this Stage immediately.
HIL is only for a specific human decision or action, such as granting access, choosing scope, or providing configuration. Preserve separate dependencies and existing human requests. Resolving dependencies never clears HIL.

- **Approve:** confirm the PR head is still the SHA you reviewed, then merge with `gh pr merge <number> --merge` and delete the remote branch with `git push origin --delete sf/<KEY>`. Run `--field requires_review_hil=false --field review_hil_comment=`, then Move the Story to `done`.
- **Changes Needed:** let `n` be `review_rounds` plus 1 (an empty value counts as 0).
  - If `n` is less than 3, set `--field review_rounds=<n>`, then Move the Story to `in_progress`.
  - If `n` is 3 or more, set `--field requires_dev_hil=true --field dev_hil_comment="Review sent this back 3 times; see <PR URL>. <one-line summary>" --field validation_rounds=0 --field review_rounds=0`, then Move the Story to `in_progress`.
- **Needs human input** (including a merge failure requiring human action): set `--field requires_review_hil=true --field review_hil_comment="<exact reason or error>"`, then release the Claim. Do not Move the Story.
