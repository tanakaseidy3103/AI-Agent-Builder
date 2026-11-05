---
name: api-test-planner
description: "Turns an OpenAPI 3 document into a concrete API test plan: happy path, missing required body fields, unknown path ids and missing authentication for every operation, plus contract warnings. Use before writing or reviewing API tests."
---

# API Test Planner

Use when the user wants API tests planned or reviewed and an OpenAPI 3 (JSON) document exists.

1. Build the input and run, from this Skill's directory:

```bash
python -c "import json,sys; print(json.dumps({'openapi': json.load(open(sys.argv[1]))}))" <openapi.json> > input.json
python scripts/cli.py input.json
```

2. Output JSON: `tests` (id, method, path, case, expect_status, request), `count`, `warnings`.
3. Turn the plan into tests in the user's framework (pytest+httpx, Jest+supertest, Postman…). Keep the `id`s so
   failures map back to the plan.
4. Report `warnings` (operations without a 2xx response, without operationId, required body without schema).

Cases per operation: `happy-path`; `missing-required-field` (when the JSON body has required properties);
`unknown-id` (when the path has parameters); `no-auth` (when security applies). YAML input must be converted to JSON first.
