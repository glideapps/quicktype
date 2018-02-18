"use strict";

import { Map, Set, List, OrderedSet, OrderedMap, Collection } from "immutable";
import * as handlebars from "handlebars";

import {
    Type,
    ClassType,
    EnumType,
    UnionType,
    separateNamedTypes,
    nullableFromUnion,
    matchTypeExhaustive,
    TypeKind,
    isNamedType,
    ClassProperty,
    MapType
} from "./Type";
import { Namespace, Name, Namer, FixedName, SimpleName, DependencyName, keywordNamespace } from "./Naming";
import { Renderer, BlankLineLocations } from "./Renderer";
import { defined, panic, nonNull, StringMap } from "./Support";
import { Sourcelike, sourcelikeToSource, serializeRenderResult } from "./Source";

import { trimEnd } from "lodash";
import { declarationsForGraph, DeclarationIR, cycleBreakerTypesForGraph, Declaration } from "./DeclarationIR";
import { TypeAttributeStoreView } from "./TypeGraph";
import {
    TypeAttributeKind,
    descriptionTypeAttributeKind,
    propertyDescriptionsTypeAttributeKind
} from "./TypeAttributes";

function splitDescription(descriptions: OrderedSet<string> | undefined): string[] | undefined {
    if (descriptions === undefined) return undefined;
    const description = descriptions.join("\n\n").trim();
    if (description === "") return undefined;
    return description.split("\n").map(l => l.trim());
}

export type ForbiddenWordsInfo = { names: (Name | string)[]; includeGlobalForbidden: boolean };

const assignedNameAttributeKind = new TypeAttributeKind<Name>("assignedName", undefined);
const assignedPropertyNamesAttributeKind = new TypeAttributeKind<Map<string, Name>>("assignedPropertyNames", undefined);
const assignedMemberNamesAttributeKind = new TypeAttributeKind<Map<Type, Name>>("assignedMemberNames", undefined);
const assignedCaseNamesAttributeKind = new TypeAttributeKind<Map<string, Name>>("assignedCaseNames", undefined);

export abstract class ConvenienceRenderer extends Renderer {
    private _globalForbiddenNamespace: Namespace | undefined;
    private _otherForbiddenNamespaces: Map<string, Namespace> | undefined;
    private _globalNamespace: Namespace | undefined;
    private _nameStoreView: TypeAttributeStoreView<Name> | undefined;
    private _propertyNamesStoreView: TypeAttributeStoreView<Map<string, Name>> | undefined;
    private _memberNamesStoreView: TypeAttributeStoreView<Map<Type, Name>> | undefined;
    private _caseNamesStoreView: TypeAttributeStoreView<Map<string, Name>> | undefined;

    private _namedTypeNamer: Namer | undefined;
    // @ts-ignore: FIXME: Make this `Namer | undefined`
    private _unionMemberNamer: Namer | null;
    // @ts-ignore: FIXME: Make this `Namer | undefined`
    private _enumCaseNamer: Namer | null;

    private _declarationIR: DeclarationIR | undefined;
    private _namedTypes: List<Type> | undefined;
    private _namedClasses: OrderedSet<ClassType> | undefined;
    private _namedEnums: OrderedSet<EnumType> | undefined;
    private _namedUnions: OrderedSet<UnionType> | undefined;
    private _haveUnions: boolean | undefined;
    private _haveMaps: boolean | undefined;
    private _haveOptionalProperties: boolean | undefined;
    private _cycleBreakerTypes?: Set<Type> | undefined;

    private _alphabetizeProperties = false;

    get topLevels(): Map<string, Type> {
        return this.typeGraph.topLevels;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [];
    }

    protected forbiddenForClassProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: false };
    }

    protected makeTopLevelDependencyNames(_t: Type, _topLevelName: Name): DependencyName[] {
        return [];
    }

    protected makeNamedTypeDependencyNames(_t: Type, _name: Name): DependencyName[] {
        return [];
    }

    protected abstract topLevelNameStyle(rawName: string): string;
    protected abstract makeNamedTypeNamer(): Namer;
    protected abstract namerForClassProperty(c: ClassType, p: ClassProperty): Namer | null;
    protected abstract makeUnionMemberNamer(): Namer | null;
    protected abstract makeEnumCaseNamer(): Namer | null;
    protected abstract emitSourceStructure(givenOutputFilename: string): void;

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        if (isNamedType(type)) {
            return type;
        }
        return undefined;
    }

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
        return nullableFromUnion(u) === null;
    }

    private get globalNamespace(): Namespace {
        return defined(this._globalNamespace);
    }

    private get nameStoreView(): TypeAttributeStoreView<Name> {
        return defined(this._nameStoreView);
    }

    protected descriptionForType(t: Type): string[] | undefined {
        let description = this.typeGraph.attributeStore.tryGet(descriptionTypeAttributeKind, t);
        return splitDescription(description);
    }

    protected descriptionForClassProperty(c: ClassType, name: string): string[] | undefined {
        const descriptions = this.typeGraph.attributeStore.tryGet(propertyDescriptionsTypeAttributeKind, c);
        if (descriptions === undefined) return undefined;
        return splitDescription(descriptions.get(name));
    }

    protected setUpNaming(): OrderedSet<Namespace> {
        this._nameStoreView = new TypeAttributeStoreView(this.typeGraph.attributeStore, assignedNameAttributeKind);
        this._propertyNamesStoreView = new TypeAttributeStoreView(
            this.typeGraph.attributeStore,
            assignedPropertyNamesAttributeKind
        );
        this._memberNamesStoreView = new TypeAttributeStoreView(
            this.typeGraph.attributeStore,
            assignedMemberNamesAttributeKind
        );
        this._caseNamesStoreView = new TypeAttributeStoreView(
            this.typeGraph.attributeStore,
            assignedCaseNamesAttributeKind
        );

        this._namedTypeNamer = this.makeNamedTypeNamer();
        this._unionMemberNamer = this.makeUnionMemberNamer();
        this._enumCaseNamer = this.makeEnumCaseNamer();

        this._globalForbiddenNamespace = keywordNamespace("forbidden", this.forbiddenNamesForGlobalNamespace());
        this._otherForbiddenNamespaces = Map();
        this._globalNamespace = new Namespace("global", undefined, Set([this._globalForbiddenNamespace]), Set());
        const { classes, enums, unions } = this.typeGraph.allNamedTypesSeparated();
        const namedUnions = unions.filter((u: UnionType) => this.unionNeedsName(u)).toOrderedSet();
        this.topLevels.forEach((t, name) => {
            this.nameStoreView.setForTopLevel(name, this.addNameForTopLevel(t, name));
        });
        classes.forEach((c: ClassType) => {
            const name = this.addNameForNamedType(c);
            this.addPropertyNames(c, name);
        });
        enums.forEach((e: EnumType) => {
            const name = this.addNameForNamedType(e);
            this.addEnumCaseNames(e, name);
        });
        namedUnions.forEach((u: UnionType) => {
            const name = this.addNameForNamedType(u);
            this.addUnionMemberNames(u, name);
        });
        return OrderedSet([this._globalForbiddenNamespace, this._globalNamespace]).union(
            this._otherForbiddenNamespaces.valueSeq()
        );
    }

    private addDependenciesForNamedType = (type: Type, named: Name): void => {
        const dependencyNames = this.makeNamedTypeDependencyNames(type, named);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }
    };

    protected makeNameForTopLevel(_t: Type, givenName: string, maybeNamedType: Type | undefined): Name {
        let styledName: string;
        if (maybeNamedType !== undefined) {
            styledName = defined(this._namedTypeNamer).nameStyle(givenName);
        } else {
            styledName = this.topLevelNameStyle(givenName);
        }

        return new FixedName(styledName);
    }

    private addNameForTopLevel = (type: Type, givenName: string): Name => {
        const maybeNamedType = this.namedTypeToNameForTopLevel(type);
        const name = this.makeNameForTopLevel(type, givenName, maybeNamedType);
        this.globalNamespace.add(name);
        const dependencyNames = this.makeTopLevelDependencyNames(type, name);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }

        if (maybeNamedType !== undefined) {
            this.addDependenciesForNamedType(maybeNamedType, name);
            this.nameStoreView.set(maybeNamedType, name);
        }

        return name;
    };

    protected makeNameForNamedType(t: Type): Name {
        return new SimpleName(t.getProposedNames(), defined(this._namedTypeNamer));
    }

    private addNameForNamedType = (type: Type): Name => {
        const existing = this.nameStoreView.tryGet(type);
        if (existing !== undefined) return existing;

        const name = this.globalNamespace.add(this.makeNameForNamedType(type));

        this.addDependenciesForNamedType(type, name);

        this.nameStoreView.set(type, name);
        return name;
    };

    private processForbiddenWordsInfo(
        info: ForbiddenWordsInfo,
        namespaceName: string
    ): { forbiddenNames: Set<Name>; forbiddenNamespaces: Set<Namespace> } {
        const forbiddenNames: Name[] = [];
        const forbiddenStrings: string[] = [];
        for (const nameOrString of info.names) {
            if (typeof nameOrString === "string") {
                forbiddenStrings.push(nameOrString);
            } else {
                forbiddenNames.push(nameOrString);
            }
        }
        let namespace = defined(this._otherForbiddenNamespaces).get(namespaceName);
        if (forbiddenStrings.length > 0 && namespace === undefined) {
            namespace = keywordNamespace(namespaceName, forbiddenStrings);
            this._otherForbiddenNamespaces = defined(this._otherForbiddenNamespaces).set(namespaceName, namespace);
        }
        let forbiddenNamespaces: Set<Namespace> = Set();
        if (info.includeGlobalForbidden) {
            forbiddenNamespaces = forbiddenNamespaces.add(defined(this._globalForbiddenNamespace));
        }
        if (namespace !== undefined) {
            forbiddenNamespaces = forbiddenNamespaces.add(namespace);
        }

        return { forbiddenNames: Set(forbiddenNames), forbiddenNamespaces };
    }

    protected makeNameForProperty(
        c: ClassType,
        _className: Name,
        p: ClassProperty,
        jsonName: string
    ): Name | undefined {
        // FIXME: This alternative should really depend on what the
        // actual name of the class ends up being.  We can do this
        // with a DependencyName.
        // Also, we currently don't have any languages where properties
        // are global, so collisions here could only occur where two
        // properties of the same class have the same name, in which case
        // the alternative would also be the same, i.e. useless.  But
        // maybe we'll need global properties for some weird language at
        // some point.
        const alternative = `${c.getCombinedName()}_${jsonName}`;
        const namer = this.namerForClassProperty(c, p);
        if (namer === null) return undefined;
        return new SimpleName(OrderedSet([jsonName, alternative]), namer);
    }

    protected makePropertyDependencyNames(
        _c: ClassType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        _name: Name
    ): Name[] {
        return [];
    }

    private addPropertyNames = (c: ClassType, className: Name): void => {
        const { forbiddenNames, forbiddenNamespaces } = this.processForbiddenWordsInfo(
            this.forbiddenForClassProperties(c, className),
            "forbidden-for-properties"
        );

        let ns: Namespace | undefined;

        const names = c.sortedProperties
            .map((p, jsonName) => {
                const name = this.makeNameForProperty(c, className, p, jsonName);
                if (name === undefined) return undefined;
                if (ns === undefined) {
                    ns = new Namespace(c.getCombinedName(), this.globalNamespace, forbiddenNamespaces, forbiddenNames);
                }
                ns.add(name);
                for (const depName of this.makePropertyDependencyNames(c, className, p, jsonName, name)) {
                    ns.add(depName);
                }
                return name;
            })
            .filter(v => v !== undefined) as OrderedMap<string, SimpleName>;
        defined(this._propertyNamesStoreView).set(c, names);
    };

    protected makeNameForUnionMember(u: UnionType, unionName: Name, t: Type): Name {
        return new DependencyName(nonNull(this._unionMemberNamer), lookup =>
            this.proposeUnionMemberName(u, unionName, t, lookup)
        );
    }

    private addUnionMemberNames = (u: UnionType, unionName: Name): void => {
        const memberNamer = this._unionMemberNamer;
        if (memberNamer === null) return;

        const { forbiddenNames, forbiddenNamespaces } = this.processForbiddenWordsInfo(
            this.forbiddenForUnionMembers(u, unionName),
            "forbidden-for-union-members"
        );

        let ns: Namespace;
        if (this.unionMembersInGlobalNamespace) {
            ns = this.globalNamespace;
        } else {
            ns = new Namespace(u.getCombinedName(), this.globalNamespace, forbiddenNamespaces, forbiddenNames);
        }
        let names = Map<Type, Name>();
        u.members.forEach(t => {
            const name = this.makeNameForUnionMember(u, unionName, t);
            names = names.set(t, ns.add(name));
        });
        defined(this._memberNamesStoreView).set(u, names);
    };

    protected makeNameForEnumCase(e: EnumType, _enumName: Name, caseName: string): Name {
        // FIXME: See the FIXME in `makeNameForProperty`.  We do have global
        // enum cases, though (in Go), so this is actually useful already.
        const alternative = `${e.getCombinedName()}_${caseName}`;
        return new SimpleName(OrderedSet([caseName, alternative]), nonNull(this._enumCaseNamer));
    }

    // FIXME: this is very similar to addPropertyNameds and addUnionMemberNames
    private addEnumCaseNames = (e: EnumType, enumName: Name): void => {
        if (this._enumCaseNamer === null) return;

        const { forbiddenNames, forbiddenNamespaces } = this.processForbiddenWordsInfo(
            this.forbiddenForEnumCases(e, enumName),
            "forbidden-for-enum-cases"
        );

        let ns: Namespace;
        if (this.enumCasesInGlobalNamespace) {
            ns = this.globalNamespace;
        } else {
            ns = new Namespace(e.getCombinedName(), this.globalNamespace, forbiddenNamespaces, forbiddenNames);
        }
        let names = Map<string, Name>();
        e.cases.forEach(caseName => {
            names = names.set(caseName, ns.add(this.makeNameForEnumCase(e, enumName, caseName)));
        });
        defined(this._caseNamesStoreView).set(e, names);
    };

    private childrenOfType = (t: Type): OrderedSet<Type> => {
        const names = this.names;
        if (t instanceof ClassType) {
            const propertyNameds = defined(this._propertyNamesStoreView).get(t);
            const sortedMap = t.properties
                .filter((_, n) => propertyNameds.get(n) !== undefined)
                .map(p => p.type)
                .sortBy((_, n) => defined(names.get(defined(propertyNameds.get(n)))));
            return sortedMap.toOrderedSet();
        }
        return t.children.toOrderedSet();
    };

    protected get namedUnions(): OrderedSet<UnionType> {
        return defined(this._namedUnions);
    }

    protected get haveNamedUnions(): boolean {
        return !this.namedUnions.isEmpty();
    }

    protected get haveNamedTypes(): boolean {
        return !defined(this._namedTypes).isEmpty();
    }

    protected get haveUnions(): boolean {
        return defined(this._haveUnions);
    }

    protected get haveMaps(): boolean {
        return defined(this._haveMaps);
    }

    protected get haveOptionalProperties(): boolean {
        return defined(this._haveOptionalProperties);
    }

    // FIXME: Inconsistently named, though technically correct.  Right now all enums are named,
    // but this should really be called `namedEnums`.
    protected get enums(): OrderedSet<EnumType> {
        return defined(this._namedEnums);
    }

    protected get haveEnums(): boolean {
        return !this.enums.isEmpty();
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
        return this.nameStoreView.get(t);
    };

    protected isForwardDeclaredType(t: Type): boolean {
        return defined(this._declarationIR).forwardedTypes.has(t);
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
        if (predicate !== undefined) {
            topLevels = this.topLevels.filter(predicate);
        } else {
            topLevels = this.topLevels;
        }
        this.forEachWithBlankLines(topLevels, blankLocations, (t: Type, name: string) =>
            f(t, this.nameStoreView.getForTopLevel(name))
        );
    };

    protected forEachDeclaration(blankLocations: BlankLineLocations, f: (decl: Declaration) => void) {
        this.forEachWithBlankLines(defined(this._declarationIR).declarations, blankLocations, f);
    }

    setAlphabetizeProperties = (value: boolean): void => {
        this._alphabetizeProperties = value;
    };

    protected forEachClassProperty = (
        c: ClassType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string, p: ClassProperty) => void
    ): void => {
        const propertyNames = defined(this._propertyNamesStoreView).get(c);
        if (this._alphabetizeProperties) {
            const alphabetizedPropertyNames = propertyNames.sortBy(n => this.names.get(n)).toOrderedMap();
            this.forEachWithBlankLines(alphabetizedPropertyNames, blankLocations, (name, jsonName) => {
                const p = defined(c.properties.get(jsonName));
                f(name, jsonName, p);
            });
        } else {
            this.forEachWithBlankLines(c.properties, blankLocations, (p, jsonName) => {
                const name = defined(propertyNames.get(jsonName));
                f(name, jsonName, p);
            });
        }
    };

    protected nameForUnionMember = (u: UnionType, t: Type): Name => {
        return defined(
            defined(this._memberNamesStoreView)
                .get(u)
                .get(t)
        );
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
        const memberNames = defined(this._memberNamesStoreView)
            .get(u)
            .filter((_, t) => iterateMembers.has(t));
        const sortedMemberNames = memberNames.sortBy(sortOrder).toOrderedMap();
        this.forEachWithBlankLines(sortedMemberNames, blankLocations, f);
    };

    protected forEachEnumCase = (
        e: EnumType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string) => void
    ): void => {
        const caseNames = defined(this._caseNamesStoreView).get(e);
        const sortedCaseNames = caseNames.sortBy(n => this.names.get(n)).toOrderedMap();
        this.forEachWithBlankLines(sortedCaseNames, blankLocations, f);
    };

    protected callForNamedType<T extends Type>(t: T, f: (t: T, name: Name) => void): void {
        f(t, this.nameForNamedType(t));
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
        this.forEachSpecificNamedType(blankLocations, defined(this._namedClasses), f);
    };

    protected forEachEnum = (blankLocations: BlankLineLocations, f: (u: EnumType, enumName: Name) => void): void => {
        this.forEachSpecificNamedType(blankLocations, this.enums, f);
    };

    protected forEachUnion = (blankLocations: BlankLineLocations, f: (u: UnionType, unionName: Name) => void): void => {
        this.forEachSpecificNamedType(blankLocations, this.namedUnions, f);
    };

    protected forEachUniqueUnion<T>(
        blankLocations: BlankLineLocations,
        uniqueValue: (u: UnionType) => T,
        f: (firstUnion: UnionType, value: T) => void
    ): void {
        let firstUnionByValue = OrderedMap<T, UnionType>();
        this.namedUnions.forEach(u => {
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
        this.forEachWithBlankLines(defined(this._namedTypes), blankLocations, (t: Type) => {
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
        return serializeRenderResult(sourcelikeToSource(src), this.names, "").lines.join("\n");
    };

    protected get commentLineStart(): string {
        return "// ";
    }

    protected emitCommentLines(lines: string[]): void {
        for (const line of lines) {
            this.emitLine(trimEnd(this.commentLineStart + line));
        }
    }

    private processGraph(): void {
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
        this._haveMaps = types.some(t => t instanceof MapType);
        this._haveOptionalProperties = types
            .filter(t => t instanceof ClassType)
            .some(c => (c as ClassType).properties.some(p => p.isOptional));
        this._namedTypes = this._declarationIR.declarations.filter(d => d.kind === "define").map(d => d.type);
        const { classes, enums, unions } = separateNamedTypes(this._namedTypes);
        this._namedClasses = classes;
        this._namedEnums = enums;
        this._namedUnions = unions;
    }

    protected emitSource(givenOutputFilename: string): void {
        this.processGraph();
        this.emitSourceStructure(givenOutputFilename);
    }

    protected makeHandlebarsContextForUnionMember(t: Type, name: Name): StringMap {
        const value = this.makeHandlebarsContextForType(t);
        value.assignedName = defined(this.names.get(name));
        return value;
    }

    protected makeHandlebarsContextForType(t: Type): StringMap {
        const value: StringMap = { type: { kind: t.kind, index: t.typeRef.getIndex() } };
        const maybeName = this.nameStoreView.tryGet(t);
        if (maybeName !== undefined) {
            value.assignedName = this.names.get(maybeName);
        }
        return value;
    }

    protected makeHandlebarsContext(): StringMap {
        this.processGraph();

        const allTypes: any[] = [];
        this.typeGraph.allTypesUnordered().forEach(t => {
            const value = this.makeHandlebarsContextForType(t);
            if (t instanceof ClassType) {
                const properties: StringMap = {};
                this.forEachClassProperty(t, "none", (name, jsonName, p) => {
                    const propertyValue = this.makeHandlebarsContextForType(p.type);
                    propertyValue.isOptional = p.isOptional;
                    propertyValue.assignedName = defined(this.names.get(name));
                    properties[jsonName] = propertyValue;
                });
                value.properties = properties;
            } else if (t instanceof EnumType) {
                const cases: StringMap = {};
                this.forEachEnumCase(t, "none", (name, jsonName) => {
                    cases[jsonName] = { assignedName: defined(this.names.get(name)) };
                });
                value.cases = cases;
            } else if (t instanceof UnionType) {
                const members: StringMap[] = [];
                // FIXME: It's a bit ugly to have these two cases.
                if (defined(this._memberNamesStoreView).tryGet(t) === undefined) {
                    t.members.forEach(m => {
                        members.push(this.makeHandlebarsContextForType(m));
                    });
                } else {
                    this.forEachUnionMember(t, null, "none", null, (name, m) => {
                        members.push(this.makeHandlebarsContextForUnionMember(m, name));
                    });
                }
                value.members = members;
            }

            const index = t.typeRef.getIndex();
            while (allTypes.length <= index) {
                allTypes.push(undefined);
            }
            allTypes[index] = value;
        });

        const namedTypes: any[] = [];
        const addNamedType = (t: Type): void => {
            namedTypes.push(allTypes[t.typeRef.getIndex()]);
        };
        this.forEachNamedType("none", addNamedType, addNamedType, addNamedType);

        const topLevels: StringMap = {};
        this.topLevels.forEach((t, name) => {
            const value = allTypes[t.typeRef.getIndex()];
            value.assignedTopLevelName = this.names.get(this.nameStoreView.getForTopLevel(name));
            topLevels[name] = value;
        });
        return { allTypes, topLevels, namedTypes };
    }

    protected registerHandlebarsHelpers(context: StringMap): void {
        super.registerHandlebarsHelpers(context);

        handlebars.registerHelper("with_type", function(t: any, options: any): any {
            return options.fn(context.allTypes[t.index]);
        });
    }
}
