If `requires_validation_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-validate/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input and your Story Worktree as the workspace. Do not change code.

Then act on the verdict, using the sf commands above:

- **Pass:** run `--field pr_url=<PR URL> --field requires_validation_hil=false --field validation_hil_comment=`, then Move the Story to `in_review`.
- **Fail:** set `--field pr_url=<PR URL>`. Let `n` be `validation_rounds` plus 1 (an empty value counts as 0).
  - If `n` is less than 3, set `--field validation_rounds=<n>`, then Move the Story to `in_progress`.
  - If `n` is 3 or more, set `--field requires_dev_hil=true --field dev_hil_comment="Validation failed 3 times; see <PR URL>. <one-line summary>" --field validation_rounds=0 --field review_rounds=0`, then Move the Story to `in_progress`.
- **Blocked**, or anything else that stops you: set `--field requires_validation_hil=true --field validation_hil_comment="<exact command and error>"`, plus `pr_url` if a PR exists, then release the Claim. Do not Move the Story.
