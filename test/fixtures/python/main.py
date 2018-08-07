import quicktype
import json
import sys
import io

f = io.open(sys.argv[1], mode="r", encoding="utf-8")
obj = quicktype.top_level_from_dict(json.load(f))
print(json.dumps(quicktype.top_level_to_dict(obj)))
