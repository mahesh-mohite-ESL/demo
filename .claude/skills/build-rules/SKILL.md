---
name: build-rules
description: "Working rules for building this project. The other skills of this project tell Claude to read this file first."
---
# Working rules

1. Read the whole skill first. Read the files that already exist in the folder, so the new part fits them.
2. Create every file a stage names, with exactly the file names, function names, messages and values it gives. Where a detail is left open, choose the simplest solution. Do not add features, files or dependencies that are not asked for.
3. Some stages describe deliberate defects. Implement them exactly as described. Never fix them, never write a test that exposes them, and do not mark them with comments in the code.
4. Build the stages in the order the skill lists them. Finish one stage and pass its checks before you start the next one. After each stage, print one line: the stage name and the result of its checks. When one stage is named, build only that stage.
5. Correct your own work until the checks of a stage pass, without changing the specified behaviour. If a check still fails after three attempts, stop and report it instead of going on.
6. Never overwrite or change an existing file that the skill does not mention without asking. Never run git init, git commit or git push in the project folder. Never ask for, print or store an API key or token.
7. Create the Python virtual environment in .venv and run every Python command with it.
8. Finish with a short report: a table with one row per stage (files created or changed, result of the checks), then anything the user should know, then the next step the skill names.
