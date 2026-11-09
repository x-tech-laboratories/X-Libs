# X-Libs and Halon to-do

Work for a later pass, written down so another agent can pick it up. Check each item against current `main` first, since the libraries have moved on since this was logged.

## X-Tasks look differences (Halon and X-Libs)

Found when Halon 0.5 and X-Libs 0.11 were compared with the X-Tasks look at 9d524aa.

1. PageHeading stacks the title, the "N left" count and the actions in three rows instead of one baseline row. Fix in X-Libs.
2. Field labels were uppercase, 11px and tracked. They are now sentence case. Restore the caps in Halon.
3. Table header column separators are gone. Restore them in Halon.
4. The brand moved into the top bar and search no longer spans the full width. Fix in the X-Libs Shell; it affects every app.
5. The tree toggle glyph is a down triangle instead of the old chevron.

## Candidates for the next X-Libs and Halon round

- From X-Music: facet pane, entity merge grid, outcome log, Cover, and the page-view tabs clipped under the header on first open.
- From CODEX: Electron autostart, tray and sidecar; reducer/effects store; NumberField; caption heading; the data-empty pattern; force_graph wrapper; StepLog; a scrollIntoView stub; adopt use_shortcuts; a yes/no-with-note dialog.
- From X-Stream: metadata cache with TTL, refresher, image-to-data-URI, parseViewCount and parseRelativeAge, loading overlay, sidebar entity list, threaded comments.
- From X-Nix: forge webhook verification, Wake-on-LAN magic packets, EventsList, a state-to-tone badge.
- From X-Backups: fall back to a column id for an empty column label in web/tables.ts (DataTable throws on an empty label); Suggestions empty slot and source_delay_ms; FollowingOutput aria-label and tabIndex; guard extra paths such as /metrics; state badges, DurationBar and the live.ts client; an `extra` hook on register_error_replies.

## Unrelated, for the owner

- The X-Backups health check reports critical because the two Odin Borgmatic repositories (on-disk and Ragnarok) have a failed or overdue check and a failing poll. The Ragnarok repository needs `borg check --repair` run with Heimdall's credentials.
