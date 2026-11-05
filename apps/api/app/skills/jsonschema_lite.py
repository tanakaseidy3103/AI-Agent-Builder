"""Minimal JSON Schema validator (subset): type, properties, required, items, enum, additionalProperties.

shortcut: no $ref/oneOf/anyOf/format/pattern; switch to the `jsonschema` package if Skills need them.
"""

_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool,
          "object": dict, "array": list, "null": type(None)}


def _is(value, t: str) -> bool:
    if t not in _TYPES:
        return True  # unknown type keyword: do not fail closed on vocabulary we don't implement
    if t in ("integer", "number") and isinstance(value, bool):
        return False
    return isinstance(value, _TYPES[t])


def validate(schema: object, value: object, path: str = "$") -> list[str]:
    if not isinstance(schema, dict):
        return []
    errors: list[str] = []
    t = schema.get("type")
    types = t if isinstance(t, list) else [t] if t else []
    if types and not any(_is(value, x) for x in types):
        return [f"{path}: expected {'/'.join(types)}, got {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in enum")
    if isinstance(value, dict):
        props = schema.get("properties", {}) if isinstance(schema.get("properties"), dict) else {}
        for k in schema.get("required", []) or []:
            if k not in value:
                errors.append(f"{path}: missing required '{k}'")
        extra = schema.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                errors += validate(props[k], v, f"{path}.{k}")
            elif extra is False:
                errors.append(f"{path}: unexpected property '{k}'")
            elif isinstance(extra, dict):
                errors += validate(extra, v, f"{path}.{k}")
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for i, v in enumerate(value[:200]):
            errors += validate(schema["items"], v, f"{path}[{i}]")
    return errors


def contains(expected: object, actual: object) -> bool:
    """Recursive subset match: dict keys must match; each expected list item must match some actual item."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and contains(v, actual[k]) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and all(any(contains(e, a) for a in actual) for e in expected)
    return expected == actual
