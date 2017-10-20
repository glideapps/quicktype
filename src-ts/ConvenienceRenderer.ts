"use strict";

import { Map, Set, OrderedSet } from "immutable";

import {
    Type,
    NamedType,
    PrimitiveType,
    ArrayType,
    MapType,
    ClassType,
    UnionType,
    allClassesAndUnions,
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

export abstract class ConvenienceRenderer extends Renderer {
    private _globalNamespace: Namespace;
    private _topLevelNames: Map<string, Name>;
    private _classAndUnionNames: Map<NamedType, Name>;
    private _propertyNames: Map<ClassType, Map<string, Name>>;

    private _namedClasses: OrderedSet<ClassType>;
    private _namedUnions: OrderedSet<UnionType>;

    protected get forbiddenNames(): string[] {
        return [];
    }

    protected topLevelDependencyNames(topLevelName: Name): DependencyName[] {
        return [];
    }

    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract namedTypeNameStyle(rawName: string): string;
    protected abstract propertyNameStyle(rawName: string): string;
    protected abstract namedTypeToNameForTopLevel(type: Type): NamedType | null;
    protected abstract get namedTypeNamer(): Namer;
    protected abstract get propertyNamer(): Namer;
    protected abstract emitSourceStructure(): void;

    protected unionNeedsName(u: UnionType): boolean {
        return !nullableFromUnion(u);
    }

    protected setUpNaming(): Namespace[] {
        this._globalNamespace = keywordNamespace("global", this.forbiddenNames);
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
        return [this._globalNamespace];
    }

    private nameForTopLevel = (type: Type, name: string): FixedName => {
        const maybeNamedType = this.namedTypeToNameForTopLevel(type);
        let styledName: string;
        if (maybeNamedType) {
            styledName = this.namedTypeNameStyle(name);
        } else {
            styledName = this.topLevelNameStyle(name);
        }

        const named = this._globalNamespace.add(new FixedName(styledName));
        const dependencyNames = this.topLevelDependencyNames(named);
        for (const dn of dependencyNames) {
            this._globalNamespace.add(dn);
        }

        if (maybeNamedType) {
            this._classAndUnionNames = this._classAndUnionNames.set(maybeNamedType, named);
        }

        return named;
    };

    private addClassOrUnionNamed = (type: NamedType): Name => {
        if (this._classAndUnionNames.has(type)) {
            return this._classAndUnionNames.get(type);
        }
        const name = type.names.combined;
        const named = this._globalNamespace.add(
            new SimpleName(this.namedTypeNameStyle(name), this.namedTypeNamer)
        );
        this._classAndUnionNames = this._classAndUnionNames.set(type, named);
        return named;
    };

    private addPropertyNameds = (c: ClassType, classNamed: Name): void => {
        const ns = new Namespace(c.names.combined, this._globalNamespace, Set(), Set([classNamed]));
        const names = c.properties
            .map((t: Type, name: string) => {
                return ns.add(new SimpleName(this.propertyNameStyle(name), this.propertyNamer));
            })
            .toMap();
        this._propertyNames = this._propertyNames.set(c, names);
    };

    private childrenOfType = (t: Type): OrderedSet<Type> => {
        const names = this.names;
        if (t instanceof ClassType) {
            const propertyNameds = this._propertyNames.get(t);
            return t.properties
                .sortBy((_, n: string): string => names.get(propertyNameds.get(n)))
                .toOrderedSet();
        }
        return t.children.toOrderedSet();
    };

    protected get namedUnions(): OrderedSet<UnionType> {
        return this._namedUnions;
    }

    protected get haveUnions(): boolean {
        return !this._namedUnions.isEmpty();
    }

    protected unionFieldName = (t: Type): string => {
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
                }
            } else if (t instanceof ArrayType) {
                return typeNameForUnionMember(t.items) + "_array";
            } else if (t instanceof ClassType) {
                return this.names.get(this.nameForNamedType(t));
            } else if (t instanceof MapType) {
                return typeNameForUnionMember(t.values), "_map";
            } else if (t instanceof UnionType) {
                return "union";
            }
            throw "Unknown type";
        };

        return this.propertyNameStyle(typeNameForUnionMember(t));
    };

    protected nameForNamedType = (t: NamedType): Name => {
        if (!this._classAndUnionNames.has(t)) {
            throw "Named type does not exist.";
        }
        return this._classAndUnionNames.get(t);
    };

    protected forEachTopLevel = (
        blankLocations: BlankLineLocations,
        f: (t: Type, name: Name) => void
    ): void => {
        this.forEachWithBlankLines(this.topLevels, blankLocations, (t: Type, name: string) =>
            f(t, this._topLevelNames.get(name))
        );
    };

    protected forEachClass = (
        blankLocations: BlankLineLocations,
        f: (c: ClassType, className: Name, propertyNames: Map<string, Name>) => void
    ): void => {
        // FIXME: sort property names
        this.forEachWithBlankLines(this._namedClasses, blankLocations, c =>
            f(c, this._classAndUnionNames.get(c), this._propertyNames.get(c))
        );
    };

    protected forEachUnion = (
        blankLocations: BlankLineLocations,
        f: (u: UnionType, unionName: Name) => void
    ): void => {
        this.forEachWithBlankLines(this._namedUnions, blankLocations, u =>
            f(u, this._classAndUnionNames.get(u))
        );
    };

    protected emitSource(): void {
        const { classes, unions } = allClassesAndUnions(this.topLevels, this.childrenOfType);
        this._namedClasses = classes;
        this._namedUnions = unions.filter((u: UnionType) => this.unionNeedsName(u)).toOrderedSet();

        this.emitSourceStructure();
    }
}
