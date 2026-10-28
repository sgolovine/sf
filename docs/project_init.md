## Goal

Your goal is to build out a basic project based on the specs below. 

## Project Components

This project must ship with a CLI, a Web Interface and a Skill.

## Global

- Use Typescript


### CLI

The primary purpose of the CLI is to install the agent skills required by `sf`. The CLI will have one primary command called `setup`. This will do the following:

- Install the primary agent skill for the users agents (claude code, codex, etc).

- Install other optional skills (skills to be defined later).

The CLI should use something like `clack-prompts` for prompting and also allow passing flags (`--some-flag someValue`) when an agent is used to run this command.

### Skill

The primary skill should be called `sf-factory`. This skill will do the following items:

- Check capabilities. What agent and model is running, and whether the harness can spawn other threads, sub-agents, etc.

- Watch files for changes

- Start the web interface


### Web Interface

The web interface will communicate with the skill and direct it to start new work.

- Build in React, Tanstack Query
- Any backend must use Expess
- Provide clear API's for sending messages back to the host thread. Provide helpers for how we can send commands like "spawn a new thread with this prompt <prompt>
- UI and rest of the app are out of scope.




## Project Build

- In development mode, can run web interface as a seperate component
- Build will build the UI and bundle it with the primary skill. In production the skill will start a server that will start the web interface

## References

Refer to how this skill has a web interface and does communication between skill and UI

https://github.com/sgolovine/agent-skills/tree/main/skills/grill-with-docs-ui


