"use strict";

export type Json = object;

export type TopLevelConfig = { name: string; samples: number[] } | { name: string; schema: Json };
