# Working docs

| Doc | What it's for |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit: sources, sql.js, aggregation, UI; time zones; security model |
| [api.md](api.md) | The local API analytics.lic serves to this page (the contract `tools/mock-server.js` implements) |
| [script-changes.md](script-changes.md) | What has to change in `analytics.lic` for this to work, section by section |
| [data-contract.md](data-contract.md) | Which tables and columns of `analytics.db` the figures depend on |
| [porting-notes.md](porting-notes.md) | How the Ruby figures were ported, the parity harness, and the Ruby-vs-JS traps |
| [decisions.md](decisions.md) | Decisions made, with the reasons and what was rejected |
| [open-questions.md](open-questions.md) | Unverified behaviour and decisions still to make |
| [roadmap.md](roadmap.md) | Ideas not built yet, script-side and site-side (the script's old TODO list) |

The player guide is not here: it's part of the site, `site/guide/index.html`
(https://analytics.elanthia.online/guide/). So is the player-facing changelog,
`site/guide/changes.html` (https://analytics.elanthia.online/guide/changes.html); see
AGENTS.md for when it gets an entry.

These are working documents. Update them in the same change as the code they describe.
