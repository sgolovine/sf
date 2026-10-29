If `requires_refinement_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-refine/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input.

Then act on the verdict, using the sf commands above:

- **Ready:** run `--field requires_refinement_hil=false --field refinement_hil_comment=`, then Move the Story to `in_progress`.
- **Blocked**, or anything else that stops you: set `--field requires_refinement_hil=true --field refinement_hil_comment="<question or error, options, recommendation>"`, then release the Claim. Do not Move the Story.
