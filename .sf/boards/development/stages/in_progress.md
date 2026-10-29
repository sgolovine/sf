If `requires_dev_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-develop/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input and your Story Worktree as the workspace. If `pr_url` is set, the Story came back from In Validation or In Review: the findings on that pull request are the work.

Then act on the verdict, using the sf commands above:

- **Done:** run `--field requires_dev_hil=false --field dev_hil_comment=`, then Move the Story to `in_validation`.
- **Blocked**, or anything else that stops you: commit and push what is finished, set `--field requires_dev_hil=true --field dev_hil_comment="<what stopped you, what you tried, what a human must do>"`, then release the Claim. Do not Move the Story.
