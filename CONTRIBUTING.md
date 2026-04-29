# Contributing to NanthAI Edge

Thank you for your interest in contributing to NanthAI Edge.

## Before You Contribute

Please read and understand the [LICENSE](./LICENSE) before contributing. By
submitting a contribution, you agree to the licensing terms described below.

## What's in Scope

This repository contains the **web client** and **Convex backend** for NanthAI
Edge. Native iOS and Android clients are developed separately and are not part
of this repository.

Contributions are welcome for:

- Bug fixes
- Performance improvements
- Accessibility improvements
- Internationalisation / localisation
- Documentation improvements
- New Convex backend features (queries, mutations, actions)
- New web UI features and components
- Test coverage improvements

## How to Contribute

1. **Open an issue first.** For anything beyond a trivial fix, open an issue
   describing what you'd like to change and why. This avoids wasted effort if
   the change doesn't align with the project direction.

2. **Fork the repository** and create a branch from `main`.

3. **Make your changes.** Follow the existing code style:
   - TypeScript for Convex backend and web frontend
   - React + Tailwind CSS for the web UI
   - Convex patterns: queries (read-only, reactive), mutations (atomic writes),
     actions (HTTP/streaming)
   - Run `npx tsc --noEmit --project convex/tsconfig.json` and `npm run convex:lint` for backend changes
   - Run `cd web && npx tsc --noEmit --project tsconfig.app.json` and `cd web && npm run lint` for web changes
   - Run `cd android && ./gradlew lintDebug` for Android changes
   - Run `npx tsx --test convex/tests/*.test.ts` to verify backend tests pass

4. **Submit a pull request** against `main` with a clear description of the
   change.

## Contribution Licensing

This project uses an **inbound = outbound** contribution model.

By submitting a pull request, patch, or any other contribution, you:

1. **Represent** that you have the right to make the contribution (it is your
   original work, or you have permission from the copyright holder).

2. **Grant** the author (Ferdinando Valsecchi) an irrevocable, worldwide,
   royalty-free, non-exclusive license to use, reproduce, modify, display,
   perform, sublicense, and distribute your contribution as part of the
   Software, under any license terms — including commercial terms.

3. **Acknowledge** that your contribution will be available to all users under
   the project's source-available license, and to Commercial License holders
   under their respective commercial terms.

**What this means in practice:** Your contribution helps everyone — personal
users, self-hosters, and commercial licensees. The author retains the ability
to include your contribution in commercially licensed versions of the software,
which is how the project is sustained.

**What this does NOT mean:** Contributing does not grant you a Commercial
License, nor does it transfer ownership of your contribution. You retain
copyright of your original work.

## Code of Conduct

Be respectful and constructive. We're building something useful — keep
discussions focused on the work, not the person.

## Questions?

Open an issue or email support@nanthai.tech.
