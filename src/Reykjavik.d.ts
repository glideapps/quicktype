export type PrimitiveTypeKind =
  | "any"
  | "null"
  | "bool"
  | "integer"
  | "double"
  | "string";
export type NamedTypeKind = "class" | "enum" | "union";
export type TypeKind = PrimitiveTypeKind | NamedTypeKind | "array" | "map";

export type GlueType =
  | GluePrimitiveType
  | GlueClassType
  | GlueArrayType
  | GlueMapType
  | GlueEnumType
  | GlueUnionType;

export interface GlueGraph {
  classes: GlueClassEntry[];
  toplevels: { [name: string]: GlueType };
}

export type GlueTypeNames = {
  names: string[];
  combined: string;
};

export interface GluePrimitiveType {
  kind: PrimitiveTypeKind;
}

export interface GlueArrayType {
  kind: "array";
  items: GlueType;
}

export interface GlueClassType {
  kind: "class";
  index: number;
}

export interface GlueClassEntry {
  properties: { [name: string]: GlueType };
  names: GlueTypeNames;
}

export interface GlueMapType {
  kind: "map";
  values: GlueType;
}

export interface GlueEnumType {
  kind: "enum";
  names: GlueTypeNames;
  cases: string[];
}

export interface GlueUnionType {
  kind: "union";
  names: GlueTypeNames;
  members: GlueType[];
}
