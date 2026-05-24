# Latest changes same-file merge design

## Goal

Keep the chat transcript as a full operation log, but make the "latest changes" panel easier to scan by merging repeated edits to the same file into a single top-level entry.

## User-facing behavior

- The chat transcript continues to show every `Edit`, `Write`, and `MultiEdit` tool call separately.
- The "latest changes" panel shows one top-level item per file.
- If the same file is changed multiple times in one session, the top-level item represents the latest state of that file.
- Each top-level item can be expanded to reveal the file's change history within the current session.
- Each history entry shows the tool type, time label, and an "Open Diff" action.
- Accept / Reject continue to apply to the file's current final state, not to individual history entries.

## Data model

Keep the existing top-level latest-change record, but extend it with a `history` array.

Each history entry should store:

- a stable entry key
- tool name
- time label
- old content
- new content
- before-exists flag
- updated timestamp
- optional tool-use identifier

The top-level item continues to store the current final file state used by accept / reject.

## Backend changes

In `src/extension.ts`:

- Keep chat-side tool event capture unchanged.
- When a tool-produced file change is recorded, look up the existing latest-change item by session + file path.
- If no item exists, create a new top-level item with one history entry.
- If an item already exists, update the top-level final-state fields and append a new history entry instead of replacing the whole item.
- Apply the same merge-by-file behavior to the request file watcher finalization path so both capture paths behave consistently.
- When accepting or rejecting a top-level item, continue to operate on the final-state fields only.

## Frontend changes

In `src/script.ts`:

- Keep the chat transcript rendering unchanged.
- Update latest-changes rendering so each item can show a collapsed summary with change count.
- Add a toggle to expand or collapse the per-file history list.
- In expanded state, render each history entry with tool name, time, and an "Open Diff" button.
- The top-level Accept / Reject buttons remain on the summary row only.

## Edge cases

- A file created and then modified multiple times still appears as one top-level item with multiple history entries.
- A file changed repeatedly by mixed tool types (`Edit`, `Write`, `MultiEdit`) still stays grouped by file.
- If a change path already existed before this feature, items without history should continue to render as a single-entry history.
- Reject should restore the file to the top-level original baseline, not step backward entry by entry.

## Testing

Add regression coverage for:

- same-file repeated changes produce one top-level latest-change item
- that top-level item keeps multiple history entries in order
- final-state accept / reject still uses the overall file baseline
- mixed tool types for the same file still merge into one panel item
- single-change files still render correctly without special handling

## Non-goals

- Do not merge chat transcript entries.
- Do not add per-history-entry accept / reject.
- Do not persist cross-session history beyond the existing latest-changes session state.
