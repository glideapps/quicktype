export declare class Namespace {
    readonly forbiddenNamespaces: ReadonlySet<Namespace>;
    readonly additionalForbidden: ReadonlySet<Name>;
    private readonly _children;
    private readonly _members;
    constructor(_name: string, parent: Namespace | undefined, forbiddenNamespaces: Iterable<Namespace>, additionalForbidden: Iterable<Name>);
    private addChild;
    get children(): ReadonlySet<Namespace>;
    get members(): ReadonlySet<Name>;
    get forbiddenNameds(): ReadonlySet<Name>;
    add<TName extends Name>(named: TName): TName;
}
export type NameStyle = (rawName: string) => string;
export declare class Namer {
    readonly name: string;
    readonly nameStyle: NameStyle;
    private readonly _prefixes;
    constructor(name: string, nameStyle: NameStyle, prefixes: string[]);
    assignNames(names: ReadonlyMap<Name, string>, forbiddenNamesIterable: Iterable<string>, namesToAssignIterable: Iterable<Name>): ReadonlyMap<Name, string>;
}
export declare function funPrefixNamer(name: string, nameStyle: NameStyle): Namer;
export declare abstract class Name {
    private readonly _namingFunction;
    readonly order: number;
    private readonly _associates;
    constructor(_namingFunction: Namer | undefined, order: number);
    addAssociate(associate: AssociatedName): void;
    abstract get dependencies(): ReadonlyArray<Name>;
    isFixed(): this is FixedName;
    get namingFunction(): Namer;
    abstract proposeUnstyledNames(names: ReadonlyMap<Name, string>): ReadonlySet<string>;
    firstProposedName(names: ReadonlyMap<Name, string>): string;
    nameAssignments(forbiddenNames: ReadonlySet<string>, assignedName: string): ReadonlyMap<Name, string> | null;
}
export declare class FixedName extends Name {
    private readonly _fixedName;
    constructor(_fixedName: string);
    get dependencies(): ReadonlyArray<Name>;
    addAssociate(_: AssociatedName): never;
    get fixedName(): string;
    proposeUnstyledNames(_?: ReadonlyMap<Name, string>): ReadonlySet<string>;
}
export declare class SimpleName extends Name {
    private readonly _unstyledNames;
    constructor(unstyledNames: Iterable<string>, namingFunction: Namer, order: number);
    get dependencies(): ReadonlyArray<Name>;
    proposeUnstyledNames(_?: ReadonlyMap<Name, string>): ReadonlySet<string>;
}
export declare class AssociatedName extends Name {
    private readonly _sponsor;
    readonly getName: (sponsorName: string) => string;
    constructor(_sponsor: Name, order: number, getName: (sponsorName: string) => string);
    get dependencies(): ReadonlyArray<Name>;
    proposeUnstyledNames(_?: ReadonlyMap<Name, string>): never;
}
export declare class DependencyName extends Name {
    private readonly _proposeUnstyledName;
    private readonly _dependencies;
    constructor(namingFunction: Namer | undefined, order: number, _proposeUnstyledName: (lookup: (n: Name) => string) => string);
    get dependencies(): ReadonlyArray<Name>;
    proposeUnstyledNames(names: ReadonlyMap<Name, string>): ReadonlySet<string>;
}
export declare function keywordNamespace(name: string, keywords: string[]): Namespace;
export declare function assignNames(rootNamespaces: Iterable<Namespace>): ReadonlyMap<Name, string>;
