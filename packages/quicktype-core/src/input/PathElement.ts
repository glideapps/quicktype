export enum PathElementKind {
    Root = 1,
    KeyOrIndex = 2,
    Type = 3,
    Object = 4
}

export type PathElement =
    | { kind: PathElementKind.Root }
    | { key: string; kind: PathElementKind.KeyOrIndex }
    | { index: number; kind: PathElementKind.Type }
    | { kind: PathElementKind.Object };
