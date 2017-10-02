type Json = object;
type IRTypeable = Json | string;

declare namespace Config {
  export type TopLevelConfig =
    | { name: string; samples: IRTypeable[] }
    | { name: string; schema: Json };

  export interface Config {
    language: string;
    topLevels: TopLevelConfig[];
    inferMaps?: boolean;
    rendererOptions?: { [name: string]: string };
  }
}

export = Config;
export as namespace Config;
