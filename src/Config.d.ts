export type Json = object;
export type IRTypeable = Json | string;

export type TopLevelConfig =
  | { name: string; samples: IRTypeable[] }
  | { name: string; schema: Json };

export interface Config {
  language: string;
  topLevels: TopLevelConfig[];
  inferMaps: boolean;
  rendererOptions: { [name: string]: any };
}
