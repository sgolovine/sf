If `requires_refinement_hil` is true, a human has not cleared this Story yet: release the Claim and stop.

Otherwise, read `.agents/skills/sf-refine/SKILL.md` in the Project (the Supervisor's checkout named above) and follow it, using this Story as the input.

First show this Story again and recheck its dependencies and delivered changes. Reconcile this Stage's work before advancing; dependency completion is not automatic advancement.

Then act on the verdict, using the sf commands above:

- **Waiting on dependencies:** save your work (commit and push code if applicable), then run `story wait <KEY> --depends-on <KEY,KEY>` with the Worker and Project arguments from the brief. This atomically records the complete dependency list and releases the Claim. Stay in this Stage. Do not set HIL for observable Story dependencies. If all prerequisites are already Done, sf can resume this Stage immediately.
HIL is only for a specific human decision or action, such as granting access, choosing scope, or providing configuration. Preserve separate dependencies and existing human requests. Resolving dependencies never clears HIL.

- **Ready:** run `--field requires_refinement_hil=false --field refinement_hil_comment=`, then Move the Story to `in_progress`.
- **Needs human input** (or **Blocked** for an error requiring human action): set `--field requires_refinement_hil=true --field refinement_hil_comment="<question or error, options, recommendation>"`, then release the Claim. Do not Move the Story.
