"use strict";

export type Json = object;

export type TopLevelConfig = { name: string; samples: number[] } | { name: string; schema: Json };

export interface Config {
    language: string;
    isInputJSONSchema: boolean;
    topLevels: TopLevelConfig[];
    compressedJSON: object;
    inferMaps: boolean;
    inferEnums: boolean;
    combineClasses: boolean;
    doRender: boolean;
    rendererOptions: { [name: string]: any };
}
