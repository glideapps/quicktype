import {
    setUnion,
    setFilter,
    iterableEnumerate,
    iterableSome,
    mapFilter,
    mapSortBy,
    mapFilterMap,
    mapSome
} from "collection-utils";

import { Type, ClassType, EnumType, UnionType, TypeKind, ClassProperty, MapType, ObjectType } from "./Type";
import { separateNamedTypes, nullableFromUnion, matchTypeExhaustive, isNamedType } from "./TypeUtils";
import { Namespace, Name, Namer, FixedName, SimpleName, DependencyName, keywordNamespace } from "./Naming";
import { Renderer, BlankLineLocations, RenderContext, ForEachPosition } from "./Renderer";
import { defined, panic, nonNull, assert } from "./support/Support";
import { trimEnd } from "./support/Strings";
import { Sourcelike, sourcelikeToSource, serializeRenderResult } from "./Source";

import { declarationsForGraph, DeclarationIR, cycleBreakerTypesForGraph, Declaration } from "./DeclarationIR";
import { TypeAttributeStoreView } from "./TypeGraph";
import { TypeAttributeKind } from "./TypeAttributes";
import { descriptionTypeAttributeKind, propertyDescriptionsTypeAttributeKind } from "./Description";
import { enumCaseNames, objectPropertyNames, unionMemberName, getAccessorName } from "./AccessorNames";
import { transformationForType, followTargetType, Transformation } from "./Transformers";
import { TargetLanguage } from "./TargetLanguage";

const wordWrap: (s: string) => string = require("wordwrap")(90);

const topLevelNameOrder = 1;

const givenNameOrder = 10;
export const inferredNameOrder = 30;

const classPropertyNameOrder = 20;
const assignedClassPropertyNameOrder = 10;

const enumCaseNameOrder = 20;
const assignedEnumCaseNameOrder = 10;

const unionMemberNameOrder = 40;

function splitDescription(descriptions: Iterable<string> | undefined): string[] | undefined {
    if (descriptions === undefined) return undefined;
    const description = Array.from(descriptions)
        .join("\n\n")
        .trim();
    if (description === "") return undefined;
    return wordWrap(description)
        .split("\n")
        .map(l => l.trim());
}

export type ForbiddenWordsInfo = { names: (Name | string)[]; includeGlobalForbidden: boolean };

const assignedNameAttributeKind = new TypeAttributeKind<Name>("assignedName");
const assignedPropertyNamesAttributeKind = new TypeAttributeKind<ReadonlyMap<string, Name>>("assignedPropertyNames");
const assignedMemberNamesAttributeKind = new TypeAttributeKind<ReadonlyMap<Type, Name>>("assignedMemberNames");
const assignedCaseNamesAttributeKind = new TypeAttributeKind<ReadonlyMap<string, Name>>("assignedCaseNames");

export abstract class ConvenienceRenderer extends Renderer {
    private _globalForbiddenNamespace: Namespace | undefined;
    private _otherForbiddenNamespaces: Map<string, Namespace> | undefined;
    private _globalNamespace: Namespace | undefined;
    private _nameStoreView: TypeAttributeStoreView<Name> | undefined;
    private _propertyNamesStoreView: TypeAttributeStoreView<ReadonlyMap<string, Name>> | undefined;
    private _memberNamesStoreView: TypeAttributeStoreView<ReadonlyMap<Type, Name>> | undefined;
    private _caseNamesStoreView: TypeAttributeStoreView<ReadonlyMap<string, Name>> | undefined;
    private _namesForTransformations: Map<Type, Name> | undefined;

    private _namedTypeNamer: Namer | undefined;
    // @ts-ignore: FIXME: Make this `Namer | undefined`
    private _unionMemberNamer: Namer | null;
    // @ts-ignore: FIXME: Make this `Namer | undefined`
    private _enumCaseNamer: Namer | null;

    private _declarationIR: DeclarationIR | undefined;
    private _namedTypes: ReadonlyArray<Type> | undefined;
    private _namedObjects: Set<ObjectType> | undefined;
    private _namedEnums: Set<EnumType> | undefined;
    private _namedUnions: Set<UnionType> | undefined;
    private _haveUnions: boolean | undefined;
    private _haveMaps: boolean | undefined;
    private _haveOptionalProperties: boolean | undefined;
    private _cycleBreakerTypes?: Set<Type> | undefined;

    private _alphabetizeProperties = false;

    constructor(targetLanguage: TargetLanguage, renderContext: RenderContext) {
        super(targetLanguage, renderContext);
    }

    get topLevels(): ReadonlyMap<string, Type> {
        return this.typeGraph.topLevels;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [];
    }

    protected forbiddenForObjectProperties(_o: ObjectType, _className: Name): ForbiddenWordsInfo {
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

    protected abstract makeNamedTypeNamer(): Namer;
    protected abstract namerForObjectProperty(o: ObjectType, p: ClassProperty): Namer | null;
    protected abstract makeUnionMemberNamer(): Namer | null;
    protected abstract makeEnumCaseNamer(): Namer | null;
    protected abstract emitSourceStructure(givenOutputFilename: string): void;

    protected makeNameForTransformation(_xf: Transformation, _typeName: Name | undefined): Name | undefined {
        return undefined;
    }

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

    protected setUpNaming(): ReadonlySet<Namespace> {
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
        this._namesForTransformations = new Map();

        this._namedTypeNamer = this.makeNamedTypeNamer();
        this._unionMemberNamer = this.makeUnionMemberNamer();
        this._enumCaseNamer = this.makeEnumCaseNamer();

        this._globalForbiddenNamespace = keywordNamespace("forbidden", this.forbiddenNamesForGlobalNamespace());
        this._otherForbiddenNamespaces = new Map();
        this._globalNamespace = new Namespace("global", undefined, [this._globalForbiddenNamespace], []);
        const { objects, enums, unions } = this.typeGraph.allNamedTypesSeparated();
        const namedUnions = setFilter(unions, u => this.unionNeedsName(u));
        for (const [name, t] of this.topLevels) {
            this.nameStoreView.setForTopLevel(name, this.addNameForTopLevel(t, name));
        }
        for (const o of objects) {
            const name = this.addNameForNamedType(o);
            this.addPropertyNames(o, name);
        }
        for (const e of enums) {
            const name = this.addNameForNamedType(e);
            this.addEnumCaseNames(e, name);
        }
        for (const u of namedUnions) {
            const name = this.addNameForNamedType(u);
            this.addUnionMemberNames(u, name);
        }
        for (const t of this.typeGraph.allTypesUnordered()) {
            this.addNameForTransformation(t);
        }
        return setUnion(
            [this._globalForbiddenNamespace, this._globalNamespace],
            this._otherForbiddenNamespaces.values()
        );
    }

    private addDependenciesForNamedType = (type: Type, named: Name): void => {
        const dependencyNames = this.makeNamedTypeDependencyNames(type, named);
        for (const dn of dependencyNames) {
            this.globalNamespace.add(dn);
        }
    };

    protected makeNameForTopLevel(_t: Type, givenName: string, _maybeNamedType: Type | undefined): Name {
        return new SimpleName([givenName], defined(this._namedTypeNamer), topLevelNameOrder);
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

    private makeNameForType(t: Type, namer: Namer, givenOrder: number, inferredOrder: number): Name {
        const names = t.getNames();
        const order = names.areInferred ? inferredOrder : givenOrder;
        return new SimpleName(names.proposedNames, namer, order);
    }

    protected makeNameForNamedType(t: Type): Name {
        return this.makeNameForType(t, defined(this._namedTypeNamer), givenNameOrder, inferredNameOrder);
    }

    private addNameForNamedType = (type: Type): Name => {
        const existing = this.nameStoreView.tryGet(type);
        if (existing !== undefined) return existing;

        const name = this.globalNamespace.add(this.makeNameForNamedType(type));

        this.addDependenciesForNamedType(type, name);

        this.nameStoreView.set(type, name);
        return name;
    };

    protected get typesWithNamedTransformations(): ReadonlyMap<Type, Name> {
        return defined(this._namesForTransformations);
    }

    protected nameForTransformation(t: Type): Name | undefined {
        const xf = transformationForType(t);
        if (xf === undefined) return undefined;

        const name = defined(this._namesForTransformations).get(t);
        if (name === undefined) {
            return panic("No name for transformation");
        }
        return name;
    }

    private addNameForTransformation(t: Type): void {
        const xf = transformationForType(t);
        if (xf === undefined) return;

        assert(
            defined(this._namesForTransformations).get(t) === undefined,
            "Tried to give two names to the same transformation"
        );

        const name = this.makeNameForTransformation(xf, this.nameStoreView.tryGet(xf.targetType));
        if (name === undefined) return;
        this.globalNamespace.add(name);

        defined(this._namesForTransformations).set(t, name);
    }

    private processForbiddenWordsInfo(
        info: ForbiddenWordsInfo,
        namespaceName: string
    ): { forbiddenNames: ReadonlySet<Name>; forbiddenNamespaces: ReadonlySet<Namespace> } {
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
        let forbiddenNamespaces = new Set<Namespace>();
        if (info.includeGlobalForbidden) {
            forbiddenNamespaces = forbiddenNamespaces.add(defined(this._globalForbiddenNamespace));
        }
        if (namespace !== undefined) {
            forbiddenNamespaces = forbiddenNamespaces.add(namespace);
        }

        return { forbiddenNames: new Set(forbiddenNames), forbiddenNamespaces };
    }

    protected makeNameForProperty(
        o: ObjectType,
        _className: Name,
        p: ClassProperty,
        jsonName: string,
        assignedName: string | undefined
    ): Name | undefined {
        const namer = this.namerForObjectProperty(o, p);
        if (namer === null) return undefined;
        // FIXME: This alternative should really depend on what the
        // actual name of the class ends up being.  We can do this
        // with a DependencyName.
        // Also, we currently don't have any languages where properties
        // are global, so collisions here could only occur where two
        // properties of the same class have the same name, in which case
        // the alternative would also be the same, i.e. useless.  But
        // maybe we'll need global properties for some weird language at
        // some point.
        const alternative = `${o.getCombinedName()}_${jsonName}`;
        const order = assignedName === undefined ? classPropertyNameOrder : assignedClassPropertyNameOrder;
        const names = assignedName === undefined ? [jsonName, alternative] : [assignedName];
        return new SimpleName(names, namer, order);
    }

    protected makePropertyDependencyNames(
        _o: ObjectType,
        _className: Name,
        _p: ClassProperty,
        _jsonName: string,
        _name: Name
    ): Name[] {
        return [];
    }

    private addPropertyNames = (o: ObjectType, className: Name): void => {
        const { forbiddenNames, forbiddenNamespaces } = this.processForbiddenWordsInfo(
            this.forbiddenForObjectProperties(o, className),
            "forbidden-for-properties"
        );

        let ns: Namespace | undefined;

        const accessorNames = objectPropertyNames(o, this.targetLanguage.name);
        const names = mapFilterMap(o.getSortedProperties(), (p, jsonName) => {
            const [assignedName, isFixed] = getAccessorName(accessorNames, jsonName);
            let name: Name | undefined;
            if (isFixed) {
                name = new FixedName(defined(assignedName));
            } else {
                name = this.makeNameForProperty(o, className, p, jsonName, assignedName);
            }
            if (name === undefined) return undefined;
            if (ns === undefined) {
                ns = new Namespace(o.getCombinedName(), this.globalNamespace, forbiddenNamespaces, forbiddenNames);
            }
            ns.add(name);
            for (const depName of this.makePropertyDependencyNames(o, className, p, jsonName, name)) {
                ns.add(depName);
            }
            return name;
        });
        defined(this._propertyNamesStoreView).set(o, names);
    };

    protected makeNameForUnionMember(u: UnionType, unionName: Name, t: Type): Name {
        const [assignedName, isFixed] = unionMemberName(u, t, this.targetLanguage.name);
        if (isFixed) {
            return new FixedName(defined(assignedName));
        }
        return new DependencyName(nonNull(this._unionMemberNamer), unionMemberNameOrder, lookup => {
            if (assignedName !== undefined) return assignedName;
            return this.proposeUnionMemberName(u, unionName, t, lookup);
        });
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
        let names = new Map<Type, Name>();
        for (const t of u.members) {
            const name = this.makeNameForUnionMember(u, unionName, followTargetType(t));
            names.set(t, ns.add(name));
        }
        defined(this._memberNamesStoreView).set(u, names);
    };

    protected makeNameForEnumCase(
        e: EnumType,
        _enumName: Name,
        caseName: string,
        assignedName: string | undefined
    ): Name {
        // FIXME: See the FIXME in `makeNameForProperty`.  We do have global
        // enum cases, though (in Go), so this is actually useful already.
        const alternative = `${e.getCombinedName()}_${caseName}`;
        const order = assignedName === undefined ? enumCaseNameOrder : assignedEnumCaseNameOrder;
        const names = assignedName === undefined ? [caseName, alternative] : [assignedName];
        return new SimpleName(names, nonNull(this._enumCaseNamer), order);
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
        let names = new Map<string, Name>();
        const accessorNames = enumCaseNames(e, this.targetLanguage.name);
        for (const caseName of e.cases) {
            const [assignedName, isFixed] = getAccessorName(accessorNames, caseName);
            let name: Name;
            if (isFixed) {
                name = new FixedName(defined(assignedName));
            } else {
                name = this.makeNameForEnumCase(e, enumName, caseName, assignedName);
            }
            names.set(caseName, ns.add(name));
        }
        defined(this._caseNamesStoreView).set(e, names);
    };

    private childrenOfType(t: Type): ReadonlySet<Type> {
        const names = this.names;
        if (t instanceof ClassType) {
            const propertyNameds = defined(this._propertyNamesStoreView).get(t);
            const filteredMap = mapFilterMap(t.getProperties(), (p, n) => {
                if (propertyNameds.get(n) === undefined) return undefined;
                return p.type;
            });
            const sortedMap = mapSortBy(filteredMap, (_, n) => defined(names.get(defined(propertyNameds.get(n)))));
            return new Set(sortedMap.values());
        }
        return t.getChildren();
    }

    protected get namedUnions(): ReadonlySet<UnionType> {
        return defined(this._namedUnions);
    }

    protected get haveNamedUnions(): boolean {
        return this.namedUnions.size > 0;
    }

    protected get haveNamedTypes(): boolean {
        return defined(this._namedTypes).length > 0;
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
    protected get enums(): ReadonlySet<EnumType> {
        return defined(this._namedEnums);
    }

    protected get haveEnums(): boolean {
        return this.enums.size > 0;
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
                    return panic("none type should have been replaced");
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
                objectType => {
                    assert(
                        this.targetLanguage.supportsFullObjectType,
                        "Object type should have been replaced in `replaceObjectType`"
                    );
                    return lookup(this.nameForNamedType(objectType));
                },
                _enumType => "enum",
                _unionType => "union",
                _dateType => "date",
                _timeType => "time",
                _dateTimeType => "date_time",
                _integerStringType => {
                    return panic("integer-string type should have been replaced");
                }
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

    protected forEachTopLevel(
        blankLocations: BlankLineLocations,
        f: (t: Type, name: Name, position: ForEachPosition) => void,
        predicate?: (t: Type) => boolean
    ): void {
        let topLevels: ReadonlyMap<string, Type>;
        if (predicate !== undefined) {
            topLevels = mapFilter(this.topLevels, predicate);
        } else {
            topLevels = this.topLevels;
        }
        this.forEachWithBlankLines(topLevels, blankLocations, (t, name, pos) =>
            f(t, this.nameStoreView.getForTopLevel(name), pos)
        );
    }

    protected forEachDeclaration(
        blankLocations: BlankLineLocations,
        f: (decl: Declaration, position: ForEachPosition) => void
    ) {
        this.forEachWithBlankLines(
            iterableEnumerate(defined(this._declarationIR).declarations),
            blankLocations,
            (decl, _, pos) => f(decl, pos)
        );
    }

    setAlphabetizeProperties = (value: boolean): void => {
        this._alphabetizeProperties = value;
    };

    protected forEachClassProperty(
        o: ObjectType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string, p: ClassProperty, position: ForEachPosition) => void
    ): void {
        const propertyNames = defined(this._propertyNamesStoreView).get(o);
        if (this._alphabetizeProperties) {
            const alphabetizedPropertyNames = mapSortBy(propertyNames, n => defined(this.names.get(n)));
            this.forEachWithBlankLines(alphabetizedPropertyNames, blankLocations, (name, jsonName, pos) => {
                const p = defined(o.getProperties().get(jsonName));
                f(name, jsonName, p, pos);
            });
        } else {
            this.forEachWithBlankLines(o.getProperties(), blankLocations, (p, jsonName, pos) => {
                const name = defined(propertyNames.get(jsonName));
                f(name, jsonName, p, pos);
            });
        }
    }

    protected nameForUnionMember = (u: UnionType, t: Type): Name => {
        return defined(
            defined(this._memberNamesStoreView)
                .get(u)
                .get(t)
        );
    };

    protected nameForEnumCase(e: EnumType, caseName: string): Name {
        const caseNames = defined(this._caseNamesStoreView).get(e);
        return defined(caseNames.get(caseName));
    }

    protected forEachUnionMember(
        u: UnionType,
        members: ReadonlySet<Type> | null,
        blankLocations: BlankLineLocations,
        sortOrder: ((n: Name, t: Type) => string) | null,
        f: (name: Name, t: Type, position: ForEachPosition) => void
    ): void {
        const iterateMembers = members === null ? u.members : members;
        if (sortOrder === null) {
            sortOrder = n => defined(this.names.get(n));
        }
        const memberNames = mapFilter(defined(this._memberNamesStoreView).get(u), (_, t) => iterateMembers.has(t));
        const sortedMemberNames = mapSortBy(memberNames, sortOrder);
        this.forEachWithBlankLines(sortedMemberNames, blankLocations, f);
    }

    protected forEachEnumCase(
        e: EnumType,
        blankLocations: BlankLineLocations,
        f: (name: Name, jsonName: string, position: ForEachPosition) => void
    ): void {
        const caseNames = defined(this._caseNamesStoreView).get(e);
        const sortedCaseNames = mapSortBy(caseNames, n => defined(this.names.get(n)));
        this.forEachWithBlankLines(sortedCaseNames, blankLocations, f);
    }

    protected forEachTransformation(
        blankLocations: BlankLineLocations,
        f: (n: Name, t: Type, position: ForEachPosition) => void
    ): void {
        this.forEachWithBlankLines(defined(this._namesForTransformations), blankLocations, f);
    }

    protected forEachSpecificNamedType<T extends Type>(
        blankLocations: BlankLineLocations,
        types: Iterable<[any, T]>,
        f: (t: T, name: Name, position: ForEachPosition) => void
    ): void {
        this.forEachWithBlankLines(types, blankLocations, (t, _, pos) => f(t, this.nameForNamedType(t), pos));
    }

    protected forEachObject(
        blankLocations: BlankLineLocations,
        f:
            | ((c: ClassType, className: Name, position: ForEachPosition) => void)
            | ((o: ObjectType, objectName: Name, position: ForEachPosition) => void)
    ): void {
        // FIXME: This is ugly.
        this.forEachSpecificNamedType<ObjectType>(blankLocations, defined(this._namedObjects).entries(), f as any);
    }

    protected forEachEnum(
        blankLocations: BlankLineLocations,
        f: (u: EnumType, enumName: Name, position: ForEachPosition) => void
    ): void {
        this.forEachSpecificNamedType(blankLocations, this.enums.entries(), f);
    }

    protected forEachUnion(
        blankLocations: BlankLineLocations,
        f: (u: UnionType, unionName: Name, position: ForEachPosition) => void
    ): void {
        this.forEachSpecificNamedType(blankLocations, this.namedUnions.entries(), f);
    }

    protected forEachUniqueUnion<T>(
        blankLocations: BlankLineLocations,
        uniqueValue: (u: UnionType) => T,
        f: (firstUnion: UnionType, value: T, position: ForEachPosition) => void
    ): void {
        const firstUnionByValue = new Map<T, UnionType>();
        for (const u of this.namedUnions) {
            const v = uniqueValue(u);
            if (!firstUnionByValue.has(v)) {
                firstUnionByValue.set(v, u);
            }
        }
        this.forEachWithBlankLines(firstUnionByValue, blankLocations, f);
    }

    protected forEachNamedType(
        blankLocations: BlankLineLocations,
        objectFunc:
            | ((c: ClassType, className: Name, position: ForEachPosition) => void)
            | ((o: ObjectType, objectName: Name, position: ForEachPosition) => void),
        enumFunc: (e: EnumType, enumName: Name, position: ForEachPosition) => void,
        unionFunc: (u: UnionType, unionName: Name, position: ForEachPosition) => void
    ): void {
        this.forEachWithBlankLines(defined(this._namedTypes).entries(), blankLocations, (t, _, pos) => {
            const name = this.nameForNamedType(t);
            if (t instanceof ObjectType) {
                // FIXME: This is ugly.  We can't runtime check that the function
                // takes full object types if we have them.
                (objectFunc as any)(t, name, pos);
            } else if (t instanceof EnumType) {
                enumFunc(t, name, pos);
            } else if (t instanceof UnionType) {
                unionFunc(t, name, pos);
            } else {
                return panic("Named type that's neither a class nor union");
            }
        });
    }

    // You should never have to use this to produce parts of your generated
    // code.  If you need to modify a Name, for example to change its casing,
    // use `modifySource`.
    protected sourcelikeToString = (src: Sourcelike): string => {
        return serializeRenderResult(sourcelikeToSource(src), this.names, "").lines.join("\n");
    };

    protected get commentLineStart(): string {
        return "// ";
    }

    protected emitCommentLines(
        lines: string[],
        lineStart?: string,
        beforeLine?: string,
        afterLine?: string,
        firstLineStart?: string
    ): void {
        if (lineStart === undefined) {
            lineStart = this.commentLineStart;
        }
        if (firstLineStart === undefined) {
            firstLineStart = lineStart;
        }
        if (beforeLine !== undefined) {
            this.emitLine(beforeLine);
        }
        let first = true;
        for (const line of lines) {
            let start = first ? firstLineStart : lineStart;
            if (line === "") {
                start = trimEnd(start);
            }
            this.emitLine(start, trimEnd(line));
            first = false;
        }
        if (afterLine !== undefined) {
            this.emitLine(afterLine);
        }
    }

    protected emitDescription(description: string[] | undefined): void {
        if (description === undefined) return;
        // FIXME: word-wrap
        this.emitDescriptionBlock(description);
    }

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines);
    }

    protected emitPropertyTable(
        c: ClassType,
        makePropertyRow: (name: Name, jsonName: string, p: ClassProperty) => Sourcelike[]
    ): void {
        let table: Sourcelike[][] = [];
        const emitTable = () => {
            if (table.length === 0) return;
            this.emitTable(table);
            table = [];
        };

        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const description = this.descriptionForClassProperty(c, jsonName);
            if (description !== undefined) {
                emitTable();
                this.emitDescription(description);
            }
            table.push(makePropertyRow(name, jsonName, p));
        });
        emitTable();
    }

    private processGraph(): void {
        this._declarationIR = declarationsForGraph(
            this.typeGraph,
            this.needsTypeDeclarationBeforeUse ? t => this.canBeForwardDeclared(t) : undefined,
            t => this.childrenOfType(t),
            t => {
                if (t instanceof UnionType) {
                    return this.unionNeedsName(t);
                }
                return isNamedType(t);
            }
        );

        const types = this.typeGraph.allTypesUnordered();
        this._haveUnions = iterableSome(types, t => t instanceof UnionType);
        this._haveMaps = iterableSome(types, t => t instanceof MapType);
        const classTypes = setFilter(types, t => t instanceof ClassType) as Set<ClassType>;
        this._haveOptionalProperties = iterableSome(classTypes, c => mapSome(c.getProperties(), p => p.isOptional));
        this._namedTypes = this._declarationIR.declarations.filter(d => d.kind === "define").map(d => d.type);
        const { objects, enums, unions } = separateNamedTypes(this._namedTypes);
        this._namedObjects = new Set(objects);
        this._namedEnums = new Set(enums);
        this._namedUnions = new Set(unions);
    }

    protected emitSource(givenOutputFilename: string): void {
        this.processGraph();
        this.emitSourceStructure(givenOutputFilename);
    }

    protected forEachType<TResult>(process: (t: Type) => TResult): Set<TResult> {
        const visitedTypes = new Set();
        const processed = new Set();
        const queue = Array.from(this.typeGraph.topLevels.values());

        function visit(t: Type) {
            if (visitedTypes.has(t)) return;
            for (const c of t.getChildren()) {
                queue.push(c);
            }
            visitedTypes.add(t);
            processed.add(process(t));
        }

        for (;;) {
            const maybeType = queue.pop();
            if (maybeType === undefined) {
                break;
            }
            visit(maybeType);
        }

        return processed;
    }
}
