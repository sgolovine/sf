If `requires_review_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-review/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story and its `pr_url` as the input. Do not change code.

Then act on the verdict, using the sf commands above:

- **Approve:** confirm the PR head is still the SHA you reviewed, then merge with `gh pr merge <number> --merge` and delete the remote branch with `git push origin --delete sf/<KEY>`. Run `--field requires_review_hil=false --field review_hil_comment=`, then Move the Story to `done`.
- **Changes Needed:** let `n` be `review_rounds` plus 1 (an empty value counts as 0).
  - If `n` is less than 3, set `--field review_rounds=<n>`, then Move the Story to `in_progress`.
  - If `n` is 3 or more, set `--field requires_dev_hil=true --field dev_hil_comment="Review sent this back 3 times; see <PR URL>. <one-line summary>" --field validation_rounds=0 --field review_rounds=0`, then Move the Story to `in_progress`.
- **Blocked**, or the merge fails: set `--field requires_review_hil=true --field review_hil_comment="<exact reason or error>"`, then release the Claim. Do not Move the Story.
