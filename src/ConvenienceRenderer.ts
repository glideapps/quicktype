"use strict";

import { Map, Set, OrderedSet, OrderedMap, Collection } from "immutable";

import {
    Type,
    NamedType,
    PrimitiveType,
    ArrayType,
    MapType,
    ClassType,
    EnumType,
    UnionType,
    separateNamedTypes,
    nullableFromUnion,
    matchType
} from "./Type";
import { TypeGraph } from "./TypeGraph";
import { Namespace, Name, Namer, FixedName, SimpleName, DependencyName, keywordNamespace } from "./Naming";
import { Renderer, BlankLineLocations } from "./Renderer";
import { defined, assertNever, panic } from "./Support";
import { Sourcelike, sourcelikeToSource, serializeRenderResult } from "./Source";

export abstract class ConvenienceRenderer extends Renderer {
    protected globalNamespace: Namespace;
    private _topLevelNames: Map<string, Name>;
    private _namesForNamedTypes: Map<NamedType, Name>;
    private _propertyNames: Map<ClassType, Map<string, Name>>;
    private _caseNames: Map<EnumType, Map<string, Name>>;

    private _namedTypes: OrderedSet<NamedType>;
    private _namedClasses: OrderedSet<ClassType>;
    private _namedEnums: OrderedSet<EnumType>;
    private _namedUnions: OrderedSet<UnionType>;
    private _haveUnions: boolean;

    get topLevels(): Map<string, Type> {
        return this.typeGraph.topLevels;
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return [];
    }

    protected forbiddenForProperties(c: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected forbiddenForCases(e: EnumType, enumNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected topLevelDependencyNames(t: Type, topLevelName: Name): DependencyName[] {
        return [];
    }

    protected namedTypeDependencyNames(t: NamedType, name: Name): DependencyName[] {
        return [];
    }

    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract get namedTypeNamer(): Namer;
    protected abstract get propertyNamer(): Namer | null;
    protected abstract get caseNamer(): Namer | null;
    protected abstract namedTypeToNameForTopLevel(type: Type): NamedType | null;
    protected abstract emitSourceStructure(): void;

    protected get casesInGlobalNamespace(): boolean {
        return false;
    }

    protected unionNeedsName(u: UnionType): boolean {
        return !nullableFromUnion(u);
    }

    protected setUpNaming(): Namespace[] {
        this.globalNamespace = keywordNamespace("global", this.forbiddenNamesForGlobalNamespace);
        const { classes, enums, unions } = this.typeGraph.allNamedTypesSeparated();
        const namedUnions = unions.filter((u: UnionType) => this.unionNeedsName(u)).toOrderedSet();
        this._namesForNamedTypes = Map();
        this._propertyNames = Map();
        this._caseNames = Map();
        this._topLevelNames = this.topLevels.map(this.nameForTopLevel).toMap();
        classes.forEach((c: ClassType) => {
            const named = this.addNamedForNamedType(c);
            this.addPropertyNameds(c, named);
        });
        namedUnions.forEach((u: UnionType) => this.addNamedForNamedType(u));
        enums.forEach((e: EnumType) => {
            const named = this.addNamedForNamedType(e);
            this.addCaseNameds(e, named);
        });
        return [this.globalNamespace];
    }

    private addDependenciesForNamedType = (type: NamedType, named: Name): void => {
        const dependencyNames = this.namedTypeDependencyNames(type, named);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }
    };

    private nameForTopLevel = (type: Type, name: string): FixedName => {
        const maybeNamedType = this.namedTypeToNameForTopLevel(type);
        let styledName: string;
        if (maybeNamedType) {
            styledName = this.namedTypeNamer.nameStyle(name);
        } else {
            styledName = this.topLevelNameStyle(name);
        }

        const named = this.globalNamespace.add(new FixedName(styledName));
        const dependencyNames = this.topLevelDependencyNames(type, named);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }

        if (maybeNamedType) {
            this.addDependenciesForNamedType(maybeNamedType, named);
            this._namesForNamedTypes = this._namesForNamedTypes.set(maybeNamedType, named);
        }

        return named;
    };

    private addNamedForNamedType = (type: NamedType): Name => {
        const existing = this._namesForNamedTypes.get(type);
        if (existing !== undefined) return existing;
        const named = this.globalNamespace.add(new SimpleName(type.proposedNames, this.namedTypeNamer));

        this.addDependenciesForNamedType(type, named);

        this._namesForNamedTypes = this._namesForNamedTypes.set(type, named);
        return named;
    };

    private addPropertyNameds = (c: ClassType, classNamed: Name): void => {
        const propertyNamer = this.propertyNamer;
        if (propertyNamer === null) {
            return;
        }

        const { names: forbiddenNames, namespaces: forbiddenNamespace } = this.forbiddenForProperties(c, classNamed);
        const ns = new Namespace(c.combinedName, this.globalNamespace, Set(forbiddenNamespace), Set(forbiddenNames));
        const names = c.sortedProperties
            .map((t: Type, name: string) => {
                // FIXME: This alternative should really depend on what the
                // actual name of the class ends up being.  We can do this
                // with a DependencyName.
                // Also, we currently don't have any languages where properties
                // are global, so collisions here could only occur where two
                // properties of the same class have the same name, in which case
                // the alternative would also be the same, i.e. useless.  But
                // maybe we'll need global properties for some weird language at
                // some point.
                const alternative = `${c.combinedName}_${name}`;
                return ns.add(new SimpleName(OrderedSet([name, alternative]), propertyNamer));
            })
            .toMap();
        this._propertyNames = this._propertyNames.set(c, names);
    };

    // FIXME: this is very similar to addPropertyNameds
    private addCaseNameds = (e: EnumType, enumNamed: Name): void => {
        const caseNamer = this.caseNamer;
        if (caseNamer === null) {
            return;
        }

        const { names: forbiddenNames, namespaces: forbiddenNamespace } = this.forbiddenForCases(e, enumNamed);
        let ns: Namespace;
        if (this.casesInGlobalNamespace) {
            ns = this.globalNamespace;
        } else {
            ns = new Namespace(e.combinedName, this.globalNamespace, Set(forbiddenNamespace), Set(forbiddenNames));
        }
        let names = Map<string, Name>();
        e.cases.forEach((name: string) => {
            // FIXME: See the FIXME in `addPropertyNameds`.  We do have global
            // enum cases, though (in Go), so this is actually useful already.
            const alternative = `${e.combinedName}_${name}`;
            names = names.set(name, ns.add(new SimpleName(OrderedSet([name, alternative]), caseNamer)));
        });
        this._caseNames = this._caseNames.set(e, names);
    };

    private childrenOfType = (t: Type): OrderedSet<Type> => {
        const names = this.names;
        if (t instanceof ClassType && this.propertyNamer !== null) {
            const propertyNameds = defined(this._propertyNames.get(t));
            return t.properties
                .sortBy((_, n: string): string => defined(names.get(defined(propertyNameds.get(n)))))
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

    protected get enums(): OrderedSet<EnumType> {
        return this._namedEnums;
    }

    protected get haveEnums(): boolean {
        return !this._namedEnums.isEmpty();
    }

    // FIXME: These should use Name.  Not only to fix collisions, but also
    // so we can rename them via config at some point.
    protected unionFieldName = (fieldType: Type): string => {
        const propertyNamer = this.propertyNamer;
        if (propertyNamer === null) {
            return panic("Can't get union field name unless we have a property namer");
        }

        const typeNameForUnionMember = (t: Type): string =>
            matchType(
                t,
                anyType => "anything",
                nullType => "null",
                boolType => "bool",
                integerType => "integer",
                doubleType => "double",
                stringType => "string",
                arrayType => typeNameForUnionMember(arrayType.items) + "_array",
                classType => defined(this.names.get(this.nameForNamedType(classType))),
                mapType => typeNameForUnionMember(mapType.values) + "_map",
                enumType => "enum",
                unionType => "union"
            );

        return propertyNamer.nameStyle(typeNameForUnionMember(fieldType));
    };

    protected nameForNamedType = (t: NamedType): Name => {
        if (!this._namesForNamedTypes.has(t)) {
            return panic("Named type does not exist.");
        }
        return defined(this._namesForNamedTypes.get(t));
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
        const sortedPropertyNames = propertyNames.sortBy((n: Name) => this.names.get(n)).toOrderedMap();
        this.forEachWithBlankLines(sortedPropertyNames, blankLocations, (name, jsonName) => {
            const t = defined(c.properties.get(jsonName));
            f(name, jsonName, t);
        });
    };

    protected forEachCase = (
        e: EnumType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string) => void
    ): void => {
        const caseNames = defined(this._caseNames.get(e));
        const sortedCaseNames = caseNames.sortBy((n: Name) => this.names.get(n)).toOrderedMap();
        this.forEachWithBlankLines(sortedCaseNames, blankLocations, f);
    };

    protected callForNamedType<T extends NamedType>(t: T, f: (t: T, name: Name) => void): void {
        f(t, defined(this._namesForNamedTypes.get(t)));
    }

    protected forEachSpecificNamedType<T extends NamedType>(
        blankLocations: BlankLineLocations,
        types: OrderedSet<T>,
        f: (t: T, name: Name) => void
    ): void {
        this.forEachWithBlankLines(types, blankLocations, t => {
            this.callForNamedType(t, f);
        });
    }

    protected forEachClass = (blankLocations: BlankLineLocations, f: (c: ClassType, className: Name) => void): void => {
        this.forEachSpecificNamedType(blankLocations, this._namedClasses, f);
    };

    protected forEachEnum = (blankLocations: BlankLineLocations, f: (u: EnumType, enumName: Name) => void): void => {
        this.forEachSpecificNamedType(blankLocations, this._namedEnums, f);
    };

    protected forEachUnion = (blankLocations: BlankLineLocations, f: (u: UnionType, unionName: Name) => void): void => {
        this.forEachSpecificNamedType(blankLocations, this._namedUnions, f);
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
        enumFunc: (e: EnumType, enumName: Name) => void,
        unionFunc: (u: UnionType, unionName: Name) => void
    ): void => {
        let collection: Collection<any, NamedType> = this._namedTypes;
        if (leavesFirst) collection = collection.reverse();
        this.forEachWithBlankLines(collection, blankLocations, (t: NamedType) => {
            if (t instanceof ClassType) {
                this.callForNamedType(t, classFunc);
            } else if (t instanceof EnumType) {
                this.callForNamedType(t, enumFunc);
            } else if (t instanceof UnionType) {
                this.callForNamedType(t, unionFunc);
            } else {
                return panic("Named type that's neither a class nor union");
            }
        });
    };

    // You should never have to use this to produce parts of your generated
    // code.  If you need to modify a Name, for example to change its casing,
    // use `modifySource`.
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
        const types = this.typeGraph.allNamedTypes(this.childrenOfType);
        this._haveUnions = types.some(t => t instanceof UnionType);
        this._namedTypes = types
            .filter((t: NamedType) => !(t instanceof UnionType) || this.unionNeedsName(t))
            .toOrderedSet();
        const { classes, enums, unions } = separateNamedTypes(this._namedTypes);
        this._namedClasses = classes;
        this._namedEnums = enums;
        this._namedUnions = unions;
        this.emitSourceStructure();
    }
}
