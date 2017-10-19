"use strict";

import { Map, Set } from "immutable";

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

export abstract class ConvenienceRenderer extends Renderer {
    // FIXME: These should all become private.
    protected _globalNamespace: Namespace;
    protected _topLevelNames: Map<string, Name>;
    protected _classAndUnionNames: Map<NamedType, Name>;
    protected _propertyNames: Map<ClassType, Map<string, Name>>;

    protected abstract get forbiddenNames(): string[];
    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract namedTypeNameStyle(rawName: string): string;
    protected abstract propertyNameStyle(rawName: string): string;
    protected abstract namedTypeToNameForTopLevel(type: Type): NamedType | null;
    protected abstract get namedTypeNamer(): Namer;
    protected abstract get propertyNamer(): Namer;

    protected setUpNaming(): Namespace[] {
        this._globalNamespace = keywordNamespace("global", this.forbiddenNames);
        const { classes, unions } = allClassesAndUnions(this.topLevels);
        // FIXME: make predicate for union configurable
        const namedUnions = unions.filter((u: UnionType) => !nullableFromUnion(u)).toOrderedSet();
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
}
