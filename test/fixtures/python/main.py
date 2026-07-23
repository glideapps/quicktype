import quicktype
import datetime
import json
import sys
import io

f = io.open(sys.argv[1], mode="r", encoding="utf-8")
input_obj = json.load(f)
obj = quicktype.top_level_from_dict(input_obj)

if isinstance(input_obj, dict) and {"date", "time", "date-time"} <= input_obj.keys():
    assert type(obj.date) is datetime.date
    assert type(obj.time) is datetime.time
    assert type(obj.date_time) is datetime.datetime

print(json.dumps(quicktype.top_level_to_dict(obj)))
