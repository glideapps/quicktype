"use strict";

import { Map, Set, OrderedSet } from "immutable";

import {
    Type,
    NamedType,
    ClassType,
    UnionType,
    allClassesAndUnions,
    nullableFromUnion
} from "./Type";
import { Namespace, Name, Namer, FixedName, SimpleName, keywordNamespace } from "./Naming";
import { Renderer } from "./Renderer";

type BlankLineLocations = "leading-and-interposing";

export abstract class ConvenienceRenderer extends Renderer {
    private _globalNamespace: Namespace;
    private _topLevelNames: Map<string, Name>;
    private _classAndUnionNames: Map<NamedType, Name>;
    private _propertyNames: Map<ClassType, Map<string, Name>>;

    private _namedClasses: OrderedSet<ClassType>;
    private _namedUnions: OrderedSet<UnionType>;

    protected abstract get forbiddenNames(): string[];
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
        this.forEachWithLeadingAndInterposedBlankLines(this.topLevels, (t: Type, name: string) =>
            f(t, this._topLevelNames.get(name))
        );
    };

    protected forEachClass = (
        blankLocations: BlankLineLocations,
        f: (c: ClassType, className: Name, propertyNames: Map<string, Name>) => void
    ): void => {
        this.forEachWithLeadingAndInterposedBlankLines(this._namedClasses, c =>
            f(c, this._classAndUnionNames.get(c), this._propertyNames.get(c))
        );
    };

    protected forEachUnion = (
        blankLocations: BlankLineLocations,
        f: (u: UnionType, unionName: Name) => void
    ): void => {
        this.forEachWithLeadingAndInterposedBlankLines(this._namedUnions, u =>
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
