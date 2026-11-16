# Question patterns

Map the question to the step 3 delegations of the root workflow. When a question mixes types, run the delegations it
needs, in this order: extraction, then questions and passages, then conflicts.

| The user asks | Step 3 delegation | What the answer must contain |
|---|---|---|
| "What did we decide about X?" | decisions extraction, then conflicts | each decision with source and date; later decisions that change it |
| "Who owns X?" / "What is still open?" | tasks extraction | task, owner or "owner not stated", status if written, source |
| "When is X due?" / "What are the deadlines?" | tasks extraction | date as written, source; "no date stated" when missing |
| "What are the requirements for X?" | requirements extraction | each requirement quoted with source; duplicates merged with all sources |
| "What are the risks?" | risks extraction | each risk with source; no new risks added by the assistant |
| "How did the project evolve?" / "Give me a timeline" | extraction, then conflicts | dated entries in order, undated entries listed apart (see answer format) |
| "Do the documents disagree about X?" | conflicts | both statements, both sources and dates, or "no conflict found" |
| "Where exactly is X written?" | questions and exact passages | file path, page or section, quoted sentence |
| "Summarize the project" | questions and exact passages, then decisions extraction | short summary where each sentence is traceable to a source |

## Questions this Skill does not answer

- Facts that are not in the authorized project folder, for example "what does the client think?" without a document
  saying so. Answer that it is not stated in the documents read.
- Changes to project files: renaming, moving, deleting or editing. This Skill is read-only, apart from the optional new
  note in step 5.
- Monitoring folders over time or alerting on new documents. No such capability exists in the public catalog.
