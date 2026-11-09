# Design benchmark: hackathon winners, student projects, developer tools

Researched 2026-11-09. **Facts** come only from the linked pages (short quotes). **Analysis** is our own reading of
what to apply; it is not a claim about the projects. Pages that did not describe a project's UI are marked
"not stated" rather than filled in.

## Hackathon winners (AI / agents)

| Project | Event and award (fact) | What it does (fact) | Stated about UX / demo (fact) |
|---|---|---|---|
| LORE | GitLab AI Hackathon 2026, Grand Prize | eight agents with a router plus a knowledge graph; "a visual dashboard" | the CLI "ships with 43 tests" |
| GraphDev | GitLab AI Hackathon 2026, Anthropic Grand Prize | maps code links and shows how systems change over time | judge: "Loved the demo and UX, super useful for understanding how the system evolved" |
| Launch Control | GitLab AI Hackathon 2026, Easiest to Use | not stated in detail | "polished UX and solid infrastructure" |
| DocSync | GitLab AI Hackathon 2026, Anthropic Runner Up | three agents (Detector, Writer, Reviewer); opens a code review if confident, otherwise an issue | not stated |
| SalesShortcut | Google Cloud ADK Hackathon (2025), Grand Prize | multi-agent AI SDR: lead generation, research, proposals, outreach | not stated |
| Edu.AI | ADK Hackathon, Latin America winner | agents that evaluate essays, make study plans and mock exams | not stated |
| Jayu | Gemini API Developer Competition (2024), Best Overall App | AI personal assistant integrated with browsers, editors, music, games | each winner links a demo video; content not described |
| Vite Vere | Gemini API Developer Competition, Most Impactful & People's Choice | step-by-step guidance for people with cognitive disabilities | "promoting self-reliance and skill development" |

Sources: [GitLab AI Hackathon 2026 winners](https://about.gitlab.com/blog/gitlab-ai-hackathon-2026-meet-the-winners/) ·
[ADK Hackathon results](https://cloud.google.com/blog/products/ai-machine-learning/adk-hackathon-results-winners-and-highlights) ·
[Gemini API Developer Competition winners](https://developers.googleblog.com/en/announcing-the-winners-of-the-gemini-api-developer-competition/)

## Student / graduation projects (HAL)

| Project | School, year, award (fact) | What it is (fact) | Stated about design / UX (fact) |
|---|---|---|---|
| ヒトコエ | HAL名古屋 team 「m×」, U-22 プログラミング・コンテスト 2021, 経済産業大臣賞（プロダクト） | Web app, 「新しいヘルプマークのかたち」: a button sends a message to emergency contacts or nearby helpers | refined through 「利用対象者などからのヒアリング」 (interviews with intended users) |
| Bite the Bullet | HAL東京, 未来創造展2022, 4年制 HAL大賞 | CG video work by a 10-person team | not stated |
| 甲殻機動 -Swim in the sky- | HAL大阪, 未来創造展2026, カプコン賞 | game: become an armed sea creature and conquer the ocean | only 「超美麗なグラフィック」 |

Sources: [BCN+R, U-22 2021 final](https://www.bcnretail.com/topics_detail8/20211124_254199.html) ·
[HAL東京 works 36397](https://www.hal.ac.jp/tokyo/mind/works/36397) · [HAL大阪 works 102489](https://www.hal.ac.jp/osaka/mind/works/102489)

**Limit:** no publicly documented HAL graduation project that is an AI agent tool could be verified, and the two
未来創造展 pages describe award and theme only, not their interfaces. Nothing about their UI is claimed here.

## Developer tools

Vercel's Geist is the design system behind Vercel's products (colors, typography, materials, grid, components):
[vercel.com/geist](https://vercel.com/geist). Its official pages list foundations but no named principles; the
"clarity and information density over decoration" summaries we found are third-party and are not cited as fact.

## What we applied (analysis)

| Principle | Taken from | Applied in AI Agent Builder |
|---|---|---|
| Show how the system evolved | GraphDev judge quote | Evaluations: "Did refining help?" chart, one bar per real version |
| Lead with evidence (tests, not claims) | LORE ("ships with 43 tests") | Evidence ladder Generated → Statically validated → Tested → Verified on every agent; verified only from the backend |
| Be honest about confidence | DocSync (review if confident, issue otherwise) | "Validated · not verified" is amber, never green; failed agents get "See what failed", never a download |
| Ease of use is judged on its own | Launch Control ("Easiest to Use") | One user path, Describe → Create → Test → Review → Export → Use, driven by the real run |
| Design with the people who will use it | ヒトコエ (user interviews) | Not done yet: our persona journeys are automated. Human tests are the top recommendation |
| Accessibility is product quality | Gemini winners (Vite Vere, Gaze Link, Viddyscribe) | WCAG contrast, 24 px targets, keyboard path, status never by colour alone, checked at 5 widths |
