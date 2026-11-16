import unittest

from main import run

SPEC = {
    "openapi": "3.0.3",
    "security": [{"bearer": []}],
    "paths": {
        "/items": {"post": {"operationId": "createItem",
                            "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Item"}}}},
                            "responses": {"201": {}, "422": {}}}},
        "/items/{id}": {"get": {"operationId": "getItem", "responses": {"200": {}}},
                        "delete": {"security": [], "responses": {"204": {}}}},
    },
    "components": {"schemas": {"Item": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}, "qty": {"type": "integer"}}}}},
}


class TestPlanner(unittest.TestCase):
    def setUp(self):
        self.out = run({"openapi": SPEC})
        self.ids = [t["id"] for t in self.out["tests"]]

    def test_happy_path_uses_declared_2xx_and_ref_body(self):
        t = next(t for t in self.out["tests"] if t["id"] == "createItem:happy-path")
        self.assertEqual(t["expect_status"], "201")
        self.assertEqual(t["request"]["body"], {"name": "example", "qty": 1})

    def test_missing_required_field_prefers_422(self):
        t = next(t for t in self.out["tests"] if t["id"] == "createItem:missing-required-field")
        self.assertEqual((t["expect_status"], t["request"]["omitted"]), ("422", "name"))

    def test_security_inheritance_and_override(self):
        by_id = {t["id"]: t for t in self.out["tests"]}
        self.assertEqual(by_id["getItem:no-auth"]["expect_status"], "401")  # inherits the global security
        # `security: []` makes DELETE public: without credentials it must succeed with its own 2xx (204), not 401
        self.assertEqual(by_id["delete-items-id:no-auth"]["expect_status"], "204")

    def test_warnings_for_missing_operation_id(self):
        self.assertIn("DELETE /items/{id}: no operationId", self.out["warnings"])

    def test_not_openapi3(self):
        self.assertTrue(run({"openapi": {"swagger": "2.0"}})["warnings"][0].startswith("not an OpenAPI 3"))
