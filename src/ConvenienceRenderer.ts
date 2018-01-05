"use strict";

import { Map, Set, List, OrderedSet, OrderedMap, Collection } from "immutable";

import {
    Type,
    ClassType,
    EnumType,
    UnionType,
    separateNamedTypes,
    nullableFromUnion,
    matchTypeExhaustive,
    TypeKind,
    isNamedType
} from "./Type";
import { Namespace, Name, Namer, FixedName, SimpleName, DependencyName, keywordNamespace } from "./Naming";
import { Renderer, BlankLineLocations } from "./Renderer";
import { defined, panic, nonNull } from "./Support";
import { Sourcelike, sourcelikeToSource, serializeRenderResult } from "./Source";

import { trimEnd } from "lodash";
import { declarationsForGraph, DeclarationIR, cycleBreakerTypesForGraph, Declaration } from "./DeclarationIR";

export abstract class ConvenienceRenderer extends Renderer {
    protected globalNamespace: Namespace;
    private _topLevelNames: Map<string, Name>;
    private _namesForNamedTypes: Map<Type, Name>;
    private _propertyNames: Map<ClassType, Map<string, Name>>;
    private _memberNames: Map<UnionType, Map<Type, Name>>;
    private _caseNames: Map<EnumType, Map<string, Name>>;

    private _declarationIR: DeclarationIR;
    private _namedTypes: List<Type>;
    private _namedClasses: OrderedSet<ClassType>;
    private _namedEnums: OrderedSet<EnumType>;
    private _namedUnions: OrderedSet<UnionType>;
    private _haveUnions: boolean;
    private _cycleBreakerTypes?: Set<Type>;

    private _alphabetizeProperties = false;

    get topLevels(): Map<string, Type> {
        return this.typeGraph.topLevels;
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return [];
    }

    protected forbiddenForClassProperties(_c: ClassType, _className: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [] };
    }

    protected topLevelDependencyNames(_t: Type, _topLevelName: Name): DependencyName[] {
        return [];
    }

    protected namedTypeDependencyNames(_t: Type, _name: Name): DependencyName[] {
        return [];
    }

    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract get namedTypeNamer(): Namer;
    protected abstract get classPropertyNamer(): Namer | null;
    protected abstract get unionMemberNamer(): Namer | null;
    protected abstract get enumCaseNamer(): Namer | null;
    protected abstract namedTypeToNameForTopLevel(type: Type): Type | null;
    protected abstract emitSourceStructure(): void;

    protected get unionMembersInGlobalNamespace(): boolean {
        return false;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return false;
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return false;
    }

    protected canBeForwardDeclared(_t: Type): boolean {
        return panic("If needsTypeDeclarationBeforeUse returns true, canBeForwardDeclared must be implemented");
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
        this._memberNames = Map();
        this._caseNames = Map();
        this._topLevelNames = this.topLevels.map(this.nameForTopLevel).toMap();
        classes.forEach((c: ClassType) => {
            const name = this.addNamedForNamedType(c);
            this.addPropertyNames(c, name);
        });
        enums.forEach((e: EnumType) => {
            const name = this.addNamedForNamedType(e);
            this.addEnumCaseNames(e, name);
        });
        namedUnions.forEach((u: UnionType) => {
            const name = this.addNamedForNamedType(u);
            this.addUnionMemberNames(u, name);
        });
        return [this.globalNamespace];
    }

    private addDependenciesForNamedType = (type: Type, named: Name): void => {
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

    private addNamedForNamedType = (type: Type): Name => {
        const existing = this._namesForNamedTypes.get(type);
        if (existing !== undefined) return existing;
        const named = this.globalNamespace.add(new SimpleName(type.getProposedNames(), this.namedTypeNamer));

        this.addDependenciesForNamedType(type, named);

        this._namesForNamedTypes = this._namesForNamedTypes.set(type, named);
        return named;
    };

    private addPropertyNames = (c: ClassType, className: Name): void => {
        const propertyNamer = this.classPropertyNamer;
        if (propertyNamer === null) return;

        const { names: forbiddenNames, namespaces: forbiddenNamespace } = this.forbiddenForClassProperties(
            c,
            className
        );
        const ns = new Namespace(
            c.getCombinedName(),
            this.globalNamespace,
            Set(forbiddenNamespace),
            Set(forbiddenNames)
        );
        const names = c.sortedProperties
            .map((_: Type, name: string) => {
                // FIXME: This alternative should really depend on what the
                // actual name of the class ends up being.  We can do this
                // with a DependencyName.
                // Also, we currently don't have any languages where properties
                // are global, so collisions here could only occur where two
                // properties of the same class have the same name, in which case
                // the alternative would also be the same, i.e. useless.  But
                // maybe we'll need global properties for some weird language at
                // some point.
                const alternative = `${c.getCombinedName()}_${name}`;
                return ns.add(new SimpleName(OrderedSet([name, alternative]), propertyNamer));
            })
            .toMap();
        this._propertyNames = this._propertyNames.set(c, names);
    };

    private makeUnionMemberName(u: UnionType, unionName: Name, t: Type): Name {
        return new DependencyName(nonNull(this.unionMemberNamer), lookup =>
            this.proposeUnionMemberName(u, unionName, t, lookup)
        );
    }

    private addUnionMemberNames = (u: UnionType, unionName: Name): void => {
        const memberNamer = this.unionMemberNamer;
        if (memberNamer === null) return;

        const { names: forbiddenNames, namespaces: forbiddenNamespace } = this.forbiddenForUnionMembers(u, unionName);
        let ns: Namespace;
        if (this.unionMembersInGlobalNamespace) {
            ns = this.globalNamespace;
        } else {
            ns = new Namespace(u.getCombinedName(), this.globalNamespace, Set(forbiddenNamespace), Set(forbiddenNames));
        }
        let names = Map<Type, Name>();
        u.members.forEach(t => {
            const name = this.makeUnionMemberName(u, unionName, t);
            names = names.set(t, ns.add(name));
        });
        this._memberNames = this._memberNames.set(u, names);
    };

    // FIXME: this is very similar to addPropertyNameds and addUnionMemberNames
    private addEnumCaseNames = (e: EnumType, enumName: Name): void => {
        const caseNamer = this.enumCaseNamer;
        if (caseNamer === null) return;

        const { names: forbiddenNames, namespaces: forbiddenNamespace } = this.forbiddenForEnumCases(e, enumName);
        let ns: Namespace;
        if (this.enumCasesInGlobalNamespace) {
            ns = this.globalNamespace;
        } else {
            ns = new Namespace(e.getCombinedName(), this.globalNamespace, Set(forbiddenNamespace), Set(forbiddenNames));
        }
        let names = Map<string, Name>();
        e.cases.forEach(name => {
            // FIXME: See the FIXME in `addPropertyNameds`.  We do have global
            // enum cases, though (in Go), so this is actually useful already.
            const alternative = `${e.getCombinedName()}_${name}`;
            names = names.set(name, ns.add(new SimpleName(OrderedSet([name, alternative]), caseNamer)));
        });
        this._caseNames = this._caseNames.set(e, names);
    };

    private childrenOfType = (t: Type): OrderedSet<Type> => {
        const names = this.names;
        if (t instanceof ClassType && this.classPropertyNamer !== null) {
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

    protected proposedUnionMemberNameForTypeKind = (_kind: TypeKind): string | null => {
        return null;
    };

    protected proposeUnionMemberName(
        _u: UnionType,
        _unionName: Name,
        fieldType: Type,
        lookup: (n: Name) => string
    ): string {
        const simpleName = this.proposedUnionMemberNameForTypeKind(fieldType.kind);
        if (simpleName !== null) {
            return simpleName;
        }

        const typeNameForUnionMember = (t: Type): string =>
            matchTypeExhaustive(
                t,
                _noneType => {
                    return panic("None type should have been replaced");
                },
                _anyType => "anything",
                _nullType => "null",
                _boolType => "bool",
                _integerType => "integer",
                _doubleType => "double",
                _stringType => "string",
                arrayType => typeNameForUnionMember(arrayType.items) + "_array",
                classType => lookup(this.nameForNamedType(classType)),
                mapType => typeNameForUnionMember(mapType.values) + "_map",
                _enumType => "enum",
                _unionType => "union",
                _dateType => "date",
                _timeType => "time",
                _dateTimeType => "date_time"
            );

        return typeNameForUnionMember(fieldType);
    }

    protected nameForNamedType = (t: Type): Name => {
        const name = this._namesForNamedTypes.get(t);
        if (name === undefined) {
            return panic("Named type does not exist.");
        }
        return name;
    };

    protected isForwardDeclaredType(t: Type): boolean {
        return this._declarationIR.forwardedTypes.has(t);
    }

    protected isImplicitCycleBreaker(_t: Type): boolean {
        return panic("A renderer that invokes isCycleBreakerType must implement canBeCycleBreakerType");
    }

    protected canBreakCycles(_t: Type): boolean {
        return true;
    }

    protected isCycleBreakerType(t: Type): boolean {
        if (this._cycleBreakerTypes === undefined) {
            this._cycleBreakerTypes = cycleBreakerTypesForGraph(
                this.typeGraph,
                s => this.isImplicitCycleBreaker(s),
                s => this.canBreakCycles(s)
            );
        }
        return this._cycleBreakerTypes.has(t);
    }

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

    protected forEachDeclaration(blankLocations: BlankLineLocations, f: (decl: Declaration) => void) {
        this.forEachWithBlankLines(this._declarationIR.declarations, blankLocations, f);
    }

    setAlphabetizeProperties = (value: boolean): void => {
        this._alphabetizeProperties = value;
    };

    protected forEachClassProperty = (
        c: ClassType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string, t: Type) => void
    ): void => {
        const propertyNames = defined(this._propertyNames.get(c));
        if (this._alphabetizeProperties) {
            const alphabetizedPropertyNames = propertyNames.sortBy(n => this.names.get(n)).toOrderedMap();
            this.forEachWithBlankLines(alphabetizedPropertyNames, blankLocations, (name, jsonName) => {
                const t = defined(c.properties.get(jsonName));
                f(name, jsonName, t);
            });
        } else {
            this.forEachWithBlankLines(c.properties, blankLocations, (t, jsonName) => {
                const name = defined(propertyNames.get(jsonName));
                f(name, jsonName, t);
            });
        }
    };

    protected nameForUnionMember = (u: UnionType, t: Type): Name => {
        return defined(defined(this._memberNames.get(u)).get(t));
    };

    protected forEachUnionMember = (
        u: UnionType,
        members: OrderedSet<Type> | null,
        blankLocations: BlankLineLocations,
        sortOrder: ((n: Name, t: Type) => string) | null,
        f: (name: Name, t: Type) => void
    ): void => {
        const iterateMembers = members === null ? u.members : members;
        if (sortOrder === null) {
            sortOrder = n => defined(this.names.get(n));
        }
        const memberNames = defined(this._memberNames.get(u)).filter((_, t) => iterateMembers.has(t));
        const sortedMemberNames = memberNames.sortBy(sortOrder).toOrderedMap();
        this.forEachWithBlankLines(sortedMemberNames, blankLocations, f);
    };

    protected forEachEnumCase = (
        e: EnumType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string) => void
    ): void => {
        const caseNames = defined(this._caseNames.get(e));
        const sortedCaseNames = caseNames.sortBy(n => this.names.get(n)).toOrderedMap();
        this.forEachWithBlankLines(sortedCaseNames, blankLocations, f);
    };

    protected callForNamedType<T extends Type>(t: T, f: (t: T, name: Name) => void): void {
        f(t, defined(this._namesForNamedTypes.get(t)));
    }

    protected forEachSpecificNamedType<T extends Type>(
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
        classFunc: (c: ClassType, className: Name) => void,
        enumFunc: (e: EnumType, enumName: Name) => void,
        unionFunc: (u: UnionType, unionName: Name) => void
    ): void => {
        this.forEachWithBlankLines(this._namedTypes, blankLocations, (t: Type) => {
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

    protected emitCommentLines = (commentStart: string, lines: string[]): void => {
        for (const line of lines) {
            this.emitLine(trimEnd(commentStart + line));
        }
    };

    protected emitSource(): void {
        this._declarationIR = declarationsForGraph(
            this.typeGraph,
            this.needsTypeDeclarationBeforeUse ? t => this.canBeForwardDeclared(t) : undefined,
            this.childrenOfType,
            t => {
                if (t instanceof UnionType) {
                    return this.unionNeedsName(t);
                }
                return isNamedType(t);
            }
        );

        const types = this.typeGraph.allTypesUnordered();
        this._haveUnions = types.some(t => t instanceof UnionType);
        this._namedTypes = this._declarationIR.declarations.filter(d => d.kind === "define").map(d => d.type);
        const { classes, enums, unions } = separateNamedTypes(this._namedTypes);
        this._namedClasses = classes;
        this._namedEnums = enums;
        this._namedUnions = unions;
        this.emitSourceStructure();
    }
}
