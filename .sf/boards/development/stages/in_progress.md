If `requires_dev_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-develop/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input and your Story Worktree as the workspace. If `pr_url` is set, the Story came back from In Validation or In Review: the findings on that pull request are the work.

First show this Story again and recheck its dependencies and delivered changes. Reconcile this Stage's work before advancing; dependency completion is not automatic advancement.

Then act on the verdict, using the sf commands above:

- **Waiting on dependencies:** save your work (commit and push code if applicable), then run `story wait <KEY> --depends-on <KEY,KEY>` with the Worker and Project arguments from the brief. This atomically records the complete dependency list and releases the Claim. Stay in this Stage. Do not set HIL for observable Story dependencies. If all prerequisites are already Done, sf can resume this Stage immediately.
HIL is only for a specific human decision or action, such as granting access, choosing scope, or providing configuration. Preserve separate dependencies and existing human requests. Resolving dependencies never clears HIL.

- **Done:** run `--field requires_dev_hil=false --field dev_hil_comment=`, then Move the Story to `in_validation`.
- **Needs human input** (or **Blocked** for an error requiring human action): commit and push what is finished, set `--field requires_dev_hil=true --field dev_hil_comment="<what stopped you, what you tried, what a human must do>"`, then release the Claim. Do not Move the Story.
