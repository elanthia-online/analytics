# Open questions

Things that need a decision or a check this repo can't do on its own. Move an item to
[decisions.md](decisions.md) when it's settled.

## Needs a person to check

1. **Safari and the live source.** Does Safari (macOS, current) let an https page fetch
   `http://127.0.0.1:8080`, or block it as mixed content? Chromium and Firefox treat
   loopback as potentially trustworthy. This is untested on Safari. If it's blocked,
   Safari users have the file source only, and the source chooser should say so.
2. **Chromium's Local Network Access prompt.** Check the wording and when it appears:
   the first connect from the Pages origin to `127.0.0.1`. The e2e check runs the page
   from `localhost`, which is itself local, so it never sees the prompt. Partly checked:
   with the permission not granted, headless Chromium refuses the fetch with "Permission
   was denied for this request to access the `loopback` address space", which the page can
   only see as a failed fetch, so its error now mentions the permission. The guide
   (`#connect`) tells players to choose Allow. Still to see: the prompt itself, on the
   published site.
3. **Folder source on Windows** with Lich running. The design expects reads to work
   while SQLite holds its locks: Windows byte-range locks sit at the 1 GB offset, which a
   smaller file doesn't reach, and WAL-mode locks live in `-shm`, which the page never
   reads. Not yet tried on a real Windows install.
4. **`serialize` on every Lich platform.** Verified with sqlite3 gem 2.10.2 on Linux.
   Check that the Windows and macOS Lich installers ship a gem with
   `SQLite3::Database#serialize`. Without it the script
   already falls back to `VACUUM INTO` a temporary file (`image_of`), so this only decides
   which path a platform takes ([script-changes.md](script-changes.md) §1).

## Needs a decision

5. **License.** The repo has no license yet, so by default nobody may reuse it.
   elanthia-online/lich-5 is GPL-2.0; elanthia-online/scripts has no license file at the
   root. The vendored sql.js is MIT, and its license ships beside it either way.
6. ~~LAN mode~~: settled, see decisions.md (dropped).
7. ~~Shared `elanthia-online.github.io` origin~~: settled, see decisions.md (own domain).
8. **Database size.** `/api/db` re-sends the whole database after every change, which
   while hunting can mean every few seconds. 0.4 MB is nothing; at 50 MB on localhost it's
   still fast but wasteful. Two ways to go past that:
   - a retention policy (on the [roadmap](roadmap.md))
   - an incremental API (`/api/rows?table=…&since=…`, append-only tables only).

   Measure real databases first. Ask a heavy user for `;analytics maintenance stats`.
9. **Move aggregation into a Web Worker?** Building both views on the fixture takes a few
   milliseconds. A database many times larger might stall the page every 5 seconds. Not
   needed yet; `buildViews` in `aggregate/index.js` is already worker-ready.
10. **Text reports.** `;analytics report ...` still computes its own figures in Ruby. Two
    copies of similar logic (exp per hour, silver per hour) can drift. Accept it, or have
    the page show the same reports and retire them from the script later.
11. **A file's "as of" time.** A picked file is shown as of its last-modified time. That's
    right for the player's own file or a `maintenance backup`. But a copy that was
    downloaded (e.g. sent over Discord) gets the download time, so it reads as "today"
    with everyone offline. Options:
    - use the newest timestamp inside the database instead
    - let the player pick the moment
    - have the script write the snapshot time into `metadata` when it makes a backup
