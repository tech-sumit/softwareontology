# UI Audit — 2026-06-10

Live screenshot audit of all 20 surfaces (login → 8 project pages → 11 console pages). Categorized findings; ✅ = fixed by Plans 61–64.

## A. Systemic
1. **Broken form-row layout** — Login, Upload & model, Ask (AIP), Admin→New user lay labels/inputs in one horizontal flex row; labels float beside the wrong field. → Plan 61
2. **Free-text where a picker belongs** — Pipeline inputs, automation trigger/then actions, dashboard group-by, governance dataset picks. → Plan 62
3. **Add-only management** — no edit/delete for users, roles, connectors, pipelines, automations, applied markings/clearances, merged branches. → Plan 62
4. **No pagination / list search** — Data list, audit log, type lists, governance dropdowns; Data list shows ~13 rows while the Overview KPI says 1888 (count mismatch). → Plan 63
5. **Prefilled dev defaults** — login credentials, sample CSV, ask questions arrive pre-populated. → Plan 61
6. **Accessibility** — inputs lack proper labels; no loading indicators. → Plan 61 (labels) / backlog (spinners)
7. **No responsive design** — fixed rail + multi-panel layouts crowd small viewports. → backlog

## B. Per-page layout
8. **Login** — top-pinned card, dead right half, no branding. → Plan 61
9. **Rail overflow** — 9+ project avatars, no scroll handling. → Plan 61
10. **Connectors** — create form wedged between list rows; looks like editing. → Plan 61
11. **Apps** — thin empty state, action disconnected. → Plan 61
12. **Console project cards** — no description/stats/affordances. → Plan 61

## C. Feature depth
13. **Lineage is plain text** — not a graph; items not clickable. → Plan 64
14. **Dashboards aren't dashboards** — one-off count-only bar list; nothing saved. → Plan 64
15. **Upload has no file upload** — paste-only textarea; opaque auto-mapping, no PK choice. → Plan 64
16. **Ask dead out-of-box** — echo provider; three overlapping ask paradigms; manual Index step. → Plan 64
17. **API & SDK static** — no descriptions/try-it/curl; no API tokens for programmatic auth. → Plan 64
18. **Governance write-only** — no read-back of applied markings/clearances; no revoke. → Plan 62
19. **SQL editor is a bare textarea** — no highlighting/completion. → Plan 64

## D. Affordances
20. **Non-obvious clickability** — pipeline/data/object rows give no hover/cursor cues. → Plan 61
21. **Object detail hides Actions/Links sections** when empty — not discoverable. → Plan 61
22. **Branches table** — merged branches linger; no created/by/count columns; active branch not highlighted; `main` status reads "main". → Plan 62

## E. Data presentation
23. **Catalog** — raw ISO timestamps; actor shows internal ids not emails; no pagination/filters. → Plan 63
24. **Duplicate dataset names** undisambiguated (no id/date columns). → Plan 63
25. **Branch switcher shows on non-branch surfaces** (Console Home, project pages). → Plan 61

## Good (keep)
Project Settings/Members, New-project modal, Help panels, toasts, Object Explorer browse→detail, governance clearance table, branch create/diff/merge flow, masked password inputs.
