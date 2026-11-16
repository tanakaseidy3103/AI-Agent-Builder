# Disclosure

## Developed for this Hackathon

The whole Skill was written during UGREEN Hackathon 2026 on AI NAS, starting 2026-11-12:

- the root workflow in `SKILL.md`: scoped document discovery, cited evidence collection, question-specific analysis,
  an answer that separates confirmed, inferred and unknown information, conflict and superseded-statement reporting,
  and an optional note saved only with user approval;
- the references: answer format, untrusted documents, question patterns, setup and testing, and this disclosure.

The author's earlier project, AI Agent Builder, is not part of this package. Its idea of checking Skills against
explicit evidence inspired the design; none of its code, runtime or files is included or required.

## Third-party components, sources and licenses

This package contains only original Markdown. It includes no third-party code, libraries, scripts, binaries, data,
images or fonts.

At run time the Skill delegates to experts provided by the UGREEN AI NAS platform (`file-agent`, `knowledge-agent`,
`document-agent`), as listed in the public capability catalog 2.0.0 of the official Uliya Skill Kit 0.7.3. They are
platform components under UGREEN's terms and are not distributed with this Skill.

Used during development only, not included: the official Uliya Skill Kit 0.7.3 (standard, catalog and static checker,
under UGREEN's terms), Node.js to run the checker, the Python standard library for local package tests, and Playwright
Chromium (Apache-2.0) to render the proposal PDF.

## AI tools used

- Claude Code (Anthropic): helped draft and review `SKILL.md` and the references, write the local test scripts, and
  check every capability and expert name against the official catalog. Its output was checked with the official
  static checker and local tests; the author decides what is submitted.
- At run time the Skill uses whatever models the UGREEN platform experts use. The Skill does not select or ship a
  model.
