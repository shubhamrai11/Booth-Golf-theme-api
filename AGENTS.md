# Working in this repository

## Commit completed work automatically

The user wants changes committed after each completed coding task. Treat that as
standing authorization to create a local Git commit without asking again.

1. Inspect the Git status before making changes. Preserve existing work and
   include only changes belonging to the current task.
2. Complete the requested work and run checks appropriate to the change. For
   application changes, run `npm test` and `npm run build`; for documentation
   changes, inspect the text and run `git diff --check`.
3. Review the final diff and staged file list. Keep actual API keys, `.env`
   values, `api-key.local.mjs`, encrypted credentials, guest photos, `data/`,
   licensed Canon SDK files and generated builds out of every commit.
4. If the checks pass, stage the task's files explicitly and commit with a
   concise description of the resulting change. Do not create empty commits,
   amend existing commits or rewrite history unless the user requests it.
5. Report the commit ID and checks run. If a required check fails, fix it when
   possible; otherwise leave the work uncommitted and explain the blocker.

Commit only after the task is complete and validated. Do not run a background
timer or commit intermediate file saves. Pushing is a separate action: push
when the current user request or ongoing task authorizes publishing to GitHub.

User instructions override this file, including a request to leave a particular
task uncommitted. This policy applies to assistants that read `AGENTS.md`; it
does not install a Git hook or Windows background service.
