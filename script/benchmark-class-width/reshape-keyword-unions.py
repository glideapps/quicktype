#!/usr/bin/env python3
"""Nest keyword-unions.schema's flat property map under N group objects.

keyword-unions.schema is one object with 277 properties, which quicktype turns
into a single 277-field class.  This nests the same keyword properties under
`group1`..`groupN` so no single class is wide, leaving each keyword's `oneOf`
body byte-identical.

`dummy` stays at the top level so the root object is still heterogeneous.

Usage:
    reshape-keyword-unions.py N [input.schema] > output.schema
"""

import json
import sys

DEFAULT_INPUT = "test/inputs/schema/keyword-unions.schema"


def reshape(src, n):
    props = dict(src["properties"])
    dummy = props.pop("dummy")
    keys = list(props)

    grouped = {}
    for i in range(n):
        chunk = keys[i * len(keys) // n : (i + 1) * len(keys) // n]
        name = f"group{i + 1}"
        grouped[name] = {
            "type": "object",
            "title": name,
            "properties": {k: props[k] for k in chunk},
        }
    grouped["dummy"] = dummy

    return {"type": "object", "properties": grouped}


def group_of(src, n, keyword):
    """Which group a given keyword lands in (1-based), or None."""
    props = dict(src["properties"])
    props.pop("dummy", None)
    keys = list(props)
    for i in range(n):
        if keyword in keys[i * len(keys) // n : (i + 1) * len(keys) // n]:
            return i + 1
    return None


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    n = int(sys.argv[1])
    path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_INPUT
    with open(path) as f:
        src = json.load(f)
    print(json.dumps(reshape(src, n), indent=4))


if __name__ == "__main__":
    main()
