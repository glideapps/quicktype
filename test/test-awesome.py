#!/usr/bin/env python3

from urllib.request import urlopen
from urllib.error import URLError
import hashlib
import os
import json
import subprocess

test_dir = os.path.dirname(os.path.realpath(__file__))
list_file = os.path.join(test_dir, "awesome-json-datasets")
outdir = os.path.join(test_dir, "awesome-json-results")

os.chdir(os.path.join(test_dir, ".."))

with open(list_file) as f:
    urls = [u.rstrip() for u in f.readlines()]

if not os.path.exists(outdir):
    os.makedirs(outdir)

for url in urls:
    digest = hashlib.new("sha1")
    digest.update(url.encode("utf-8"))
    filename = os.path.join(outdir, digest.hexdigest() + ".json")
    if os.path.exists(filename):
        continue

    try:
        resp = urlopen(url)
        content_type = resp.getheader("Content-Type")
        if not (content_type == "application/json" or content_type.startswith("application/json;") or content_type == "text/plain"):
            print("%s: wrong content type %s" % (url, content_type))
            continue
        data = resp.read()
    except:
        print("%s: could not fetch - skipping" % url)
        continue
    try:
        json.loads(data)
    except:
        print("%s: not valid JSON - skipping" % url)
    with open(filename, 'wb') as f:
        f.write(data)
    print("%s: %d bytes" % (filename, len(data)))

subprocess.call(["node", "bin/test.js", "test/awesome-json-results"])
