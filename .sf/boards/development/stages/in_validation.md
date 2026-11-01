If `requires_validation_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-validate/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input and your Story Worktree as the workspace. Do not change code.

First show this Story again and recheck its dependencies and delivered changes. Reconcile this Stage's work before advancing; dependency completion is not automatic advancement.

Then act on the verdict, using the sf commands above:

- **Waiting on dependencies:** save your work (commit and push code if applicable), then run `story wait <KEY> --depends-on <KEY,KEY>` with the Worker and Project arguments from the brief. This atomically records the complete dependency list and releases the Claim. Stay in this Stage. Do not set HIL for observable Story dependencies. If all prerequisites are already Done, sf can resume this Stage immediately.
HIL is only for a specific human decision or action, such as granting access, choosing scope, or providing configuration. Preserve separate dependencies and existing human requests. Resolving dependencies never clears HIL.

- **Pass:** run `--field pr_url=<PR URL> --field requires_validation_hil=false --field validation_hil_comment=`, then Move the Story to `in_review`.
- **Fail:** set `--field pr_url=<PR URL>`. Let `n` be `validation_rounds` plus 1 (an empty value counts as 0).
  - If `n` is less than 3, set `--field validation_rounds=<n>`, then Move the Story to `in_progress`.
  - If `n` is 3 or more, set `--field requires_dev_hil=true --field dev_hil_comment="Validation failed 3 times; see <PR URL>. <one-line summary>" --field validation_rounds=0 --field review_rounds=0`, then Move the Story to `in_progress`.
- **Needs human input** (or **Blocked** for an error requiring human action): set `--field requires_validation_hil=true --field validation_hil_comment="<exact command and error>"`, plus `pr_url` if a PR exists, then release the Claim. Do not Move the Story.
