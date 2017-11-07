"use strict";

import { Map, Set, OrderedSet, OrderedMap, Collection } from "immutable";

import {
    Type,
    NamedType,
    PrimitiveType,
    ArrayType,
    MapType,
    ClassType,
    UnionType,
    allClassesAndUnions,
    allNamedTypes,
    splitClassesAndUnions,
    nullableFromUnion
} from "./Type";
import {
    Namespace,
    Name,
    Namer,
    FixedName,
    SimpleName,
    DependencyName,
    keywordNamespace
} from "./Naming";
import { Renderer, BlankLineLocations } from "./Renderer";
import { defined, assertNever } from "./Support";
import { Sourcelike, sourcelikeToSource, serializeRenderResult } from "./Source";

export abstract class ConvenienceRenderer extends Renderer {
    protected globalNamespace: Namespace;
    private _topLevelNames: Map<string, Name>;
    private _classAndUnionNames: Map<NamedType, Name>;
    private _propertyNames: Map<ClassType, Map<string, Name>>;

    private _namedTypes: OrderedSet<NamedType>;
    private _namedClasses: OrderedSet<ClassType>;
    private _namedUnions: OrderedSet<UnionType>;
    private _haveUnions: boolean;

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return [];
    }

    protected forbiddenForProperties(
        c: ClassType,
        classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected topLevelDependencyNames(topLevelName: Name): DependencyName[] {
        return [];
    }

    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract get namedTypeNamer(): Namer;
    protected abstract get propertyNamer(): Namer;
    protected abstract namedTypeToNameForTopLevel(type: Type): NamedType | null;
    protected abstract emitSourceStructure(): void;

    protected unionNeedsName(u: UnionType): boolean {
        return !nullableFromUnion(u);
    }

    protected setUpNaming(): Namespace[] {
        this.globalNamespace = keywordNamespace("global", this.forbiddenNamesForGlobalNamespace);
        const { classes, unions } = allClassesAndUnions(this.topLevels);
        const namedUnions = unions.filter((u: UnionType) => this.unionNeedsName(u)).toOrderedSet();
        this._classAndUnionNames = Map();
        this._propertyNames = Map();
        this._topLevelNames = this.topLevels.map(this.nameForTopLevel).toMap();
        classes.forEach((c: ClassType) => {
            const named = this.addClassOrUnionNamed(c);
            this.addPropertyNameds(c, named);
        });
        namedUnions.forEach((u: UnionType) => this.addClassOrUnionNamed(u));
        return [this.globalNamespace];
    }

    private nameForTopLevel = (type: Type, name: string): FixedName => {
        const maybeNamedType = this.namedTypeToNameForTopLevel(type);
        let styledName: string;
        if (maybeNamedType) {
            styledName = this.namedTypeNamer.nameStyle(name);
        } else {
            styledName = this.topLevelNameStyle(name);
        }

        const named = this.globalNamespace.add(new FixedName(styledName));
        const dependencyNames = this.topLevelDependencyNames(named);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }

        if (maybeNamedType) {
            this._classAndUnionNames = this._classAndUnionNames.set(maybeNamedType, named);
        }

        return named;
    };

    private addClassOrUnionNamed = (type: NamedType): Name => {
        const existing = this._classAndUnionNames.get(type);
        if (existing !== undefined) return existing;
        const name = type.names.combined;
        const named = this.globalNamespace.add(new SimpleName(name, this.namedTypeNamer));
        this._classAndUnionNames = this._classAndUnionNames.set(type, named);
        return named;
    };

    private addPropertyNameds = (c: ClassType, classNamed: Name): void => {
        const {
            names: forbiddenNames,
            namespaces: forbiddenNamespace
        } = this.forbiddenForProperties(c, classNamed);
        const ns = new Namespace(
            c.names.combined,
            this.globalNamespace,
            Set(forbiddenNamespace),
            Set(forbiddenNames)
        );
        const names = c.properties
            .map((t: Type, name: string) => {
                return ns.add(new SimpleName(name, this.propertyNamer));
            })
            .toMap();
        this._propertyNames = this._propertyNames.set(c, names);
    };

    private childrenOfType = (t: Type): OrderedSet<Type> => {
        const names = this.names;
        if (t instanceof ClassType) {
            const propertyNameds = defined(this._propertyNames.get(t));
            return t.properties
                .sortBy((_, n: string): string =>
                    defined(names.get(defined(propertyNameds.get(n))))
                )
                .toOrderedSet();
        }
        return t.children.toOrderedSet();
    };

    protected get namedUnions(): OrderedSet<UnionType> {
        return this._namedUnions;
    }

    protected get haveNamedUnions(): boolean {
        return !this._namedUnions.isEmpty();
    }

    protected get haveUnions(): boolean {
        return this._haveUnions;
    }

    protected unionFieldName = (fieldType: Type): string => {
        const typeNameForUnionMember = (t: Type): string => {
            if (t instanceof PrimitiveType) {
                switch (t.kind) {
                    case "any":
                        return "anything";
                    case "null":
                        return "null";
                    case "bool":
                        return "bool";
                    case "integer":
                        return "long";
                    case "double":
                        return "double";
                    case "string":
                        return "string";
                    default:
                        assertNever(t.kind);
                }
            } else if (t instanceof ArrayType) {
                return typeNameForUnionMember(t.items) + "_array";
            } else if (t instanceof ClassType) {
                return defined(this.names.get(this.nameForNamedType(t)));
            } else if (t instanceof MapType) {
                return typeNameForUnionMember(t.values), "_map";
            } else if (t instanceof UnionType) {
                return "union";
            }
            throw "Unknown type";
        };

        return this.propertyNamer.nameStyle(typeNameForUnionMember(fieldType));
    };

    protected nameForNamedType = (t: NamedType): Name => {
        if (!this._classAndUnionNames.has(t)) {
            throw "Named type does not exist.";
        }
        return defined(this._classAndUnionNames.get(t));
    };

    protected forEachTopLevel = (
        blankLocations: BlankLineLocations,
        f: (t: Type, name: Name) => void,
        predicate?: (t: Type) => boolean
    ): void => {
        let topLevels: Collection<string, Type>;
        if (predicate) {
            topLevels = this.topLevels.filter(predicate);
        } else {
            topLevels = this.topLevels;
        }
        this.forEachWithBlankLines(topLevels, blankLocations, (t: Type, name: string) =>
            f(t, defined(this._topLevelNames.get(name)))
        );
    };

    protected forEachProperty = (
        c: ClassType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string, t: Type) => void
    ): void => {
        const propertyNames = defined(this._propertyNames.get(c));
        const sortedPropertyNames = propertyNames
            .sortBy((n: Name) => this.names.get(n))
            .toOrderedMap();
        this.forEachWithBlankLines(sortedPropertyNames, blankLocations, (name, jsonName) => {
            const t = defined(c.properties.get(jsonName));
            f(name, jsonName, t);
        });
    };

    protected callForClass = (c: ClassType, f: (c: ClassType, className: Name) => void): void => {
        f(c, defined(this._classAndUnionNames.get(c)));
    };

    protected forEachClass = (
        blankLocations: BlankLineLocations,
        f: (c: ClassType, className: Name) => void
    ): void => {
        this.forEachWithBlankLines(this._namedClasses, blankLocations, c => {
            this.callForClass(c, f);
        });
    };

    protected callForUnion = (u: UnionType, f: (u: UnionType, unionName: Name) => void): void => {
        f(u, defined(this._classAndUnionNames.get(u)));
    };

    protected forEachUnion = (
        blankLocations: BlankLineLocations,
        f: (u: UnionType, unionName: Name) => void
    ): void => {
        this.forEachWithBlankLines(this._namedUnions, blankLocations, u => this.callForUnion(u, f));
    };

    protected forEachUniqueUnion<T>(
        blankLocations: BlankLineLocations,
        uniqueValue: (u: UnionType) => T,
        f: (firstUnion: UnionType, value: T) => void
    ): void {
        let firstUnionByValue = OrderedMap<T, UnionType>();
        this._namedUnions.forEach(u => {
            const v = uniqueValue(u);
            if (!firstUnionByValue.has(v)) {
                firstUnionByValue = firstUnionByValue.set(v, u);
            }
        });
        this.forEachWithBlankLines(firstUnionByValue, blankLocations, f);
    }

    protected forEachNamedType = (
        blankLocations: BlankLineLocations,
        leavesFirst: boolean,
        classFunc: (c: ClassType, className: Name) => void,
        unionFunc: (u: UnionType, unionName: Name) => void
    ): void => {
        let collection: Collection<any, NamedType> = this._namedTypes;
        if (leavesFirst) collection = collection.reverse();
        this.forEachWithBlankLines(collection, blankLocations, (t: NamedType) => {
            if (t instanceof ClassType) {
                this.callForClass(t, classFunc);
            } else if (t instanceof UnionType) {
                this.callForUnion(t, unionFunc);
            } else {
                throw "Named type that's neither a class nor union";
            }
        });
    };

    protected sourcelikeToString = (src: Sourcelike): string => {
        return serializeRenderResult(
            {
                rootSource: sourcelikeToSource(src),
                names: this.names
            },
            // FIXME: Use proper indentation.
            ""
        ).lines.join("\n");
    };

    protected emitSource(): void {
        const types = allNamedTypes(this.topLevels, this.childrenOfType);
        this._haveUnions = types.some(t => t instanceof UnionType);
        this._namedTypes = types
            .filter((t: NamedType) => !(t instanceof UnionType) || this.unionNeedsName(t))
            .toOrderedSet();
        const { classes, unions } = splitClassesAndUnions(this._namedTypes);
        this._namedClasses = classes;
        this._namedUnions = unions;
        this.emitSourceStructure();
    }
}
