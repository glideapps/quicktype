#!/bin/sh

./keywords.py >./inputs/json/priority/keywords.json
./keywords.py --enums >./inputs/schema/keyword-enum.schema
./keywords.py --unions >./inputs/schema/keyword-unions.schema
