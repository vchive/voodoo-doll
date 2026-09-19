# Repository working agreement

This project uses specification-driven development (SDD). Product and handoff documents are written in Chinese.

## Read first

1. `docs/HANDOFF.md` for the actual repository/deployment state and latest user intent.
2. `docs/specs/001-mobile-relationship-theater/spec.md` for requirements.
3. `plan.md`, `tasks.md`, and `acceptance.md` in the same directory for implementation and verification.

## Workflow

- Identify the assigned task IDs, requirement IDs, acceptance IDs, dependencies, and files before editing.
- Implement the user's assigned scope. The latest user request takes precedence over this agreement.
- Update the affected specification and decision notes when behavior changes; distinguish user-confirmed requirements from proposed implementation defaults.
- Keep task status accurate: a requirement is complete only with matching evidence, not merely because code was written or a build passed.
- For multiplayer-in-one-device work, preserve the existing single-doll save through an explicit migration.
- Keep current interactions responsive without model/network availability. Use server-side model credentials only.
- Preserve existing work and saved user data. Coordinate file ownership when multiple agents work concurrently.
- Verify mobile layouts and the relevant behaviors. Report real-device WeChat coverage separately from desktop emulation.
- Do not claim deployment until HTTP requests succeed from outside the server and the application assets/flows are verified.
- Maintain `docs/HANDOFF.md` and task/acceptance evidence at handoff. Do not commit credentials or infer server access on another agent's host.

## Current commands

- `npm ci`
- `npm run dev`
- `node --check app.js`
- `npm run build`
- `npm run preview`

Production start scripts and automated tests are planned, not present in the handoff baseline. Inspect `package.json` before claiming otherwise.
