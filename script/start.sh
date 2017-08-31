#!/bin/bash

pulp --watch --then "clear && script/quicktype $@" build
