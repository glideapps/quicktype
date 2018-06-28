import quicktype
import json
import sys

obj = quicktype.TopLevel(json.load(sys.stdin))
print(obj)
