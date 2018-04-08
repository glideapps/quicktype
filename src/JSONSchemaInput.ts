"use strict";

import { List, OrderedSet, Map, Set, hash, OrderedMap } from "immutable";
import * as pluralize from "pluralize";
import * as URI from "urijs";
import * as lodash from "lodash";

import { ClassProperty, PrimitiveTypeKind } from "./Type";
import {
    panic,
    assertNever,
    StringMap,
    checkStringMap,
    assert,
    defined,
    addHashCode,
    mapSync,
    forEachSync,
    checkArray,
    mapOptional
} from "./Support";
import { TypeBuilder, TypeRef } from "./TypeBuilder";
import { TypeNames } from "./TypeNames";
import { makeNamesTypeAttributes, modifyTypeNames, singularizeTypeNames } from "./TypeNames";
import {
    TypeAttributes,
    descriptionTypeAttributeKind,
    propertyDescriptionsTypeAttributeKind,
    makeTypeAttributesInferred,
    emptyTypeAttributes
} from "./TypeAttributes";
import { JSONSchema, JSONSchemaStore } from "./JSONSchemaStore";
import {
    accessorNamesTypeAttributeKind,
    checkAccessorNames,
    makeUnionIdentifierAttribute,
    isAccessorEntry,
    makeUnionMemberNamesAttribute
} from "./AccessorNames";
import { ErrorMessage, messageAssert, messageError } from "./Messages";

export enum PathElementKind {
    Root,
    KeyOrIndex,
    Type,
    Object
}

export type PathElement =
    | { kind: PathElementKind.Root }
    | { kind: PathElementKind.KeyOrIndex; key: string }
    | { kind: PathElementKind.Type; index: number }
    | { kind: PathElementKind.Object };

function keyOrIndex(pe: PathElement): string | undefined {
    if (pe.kind !== PathElementKind.KeyOrIndex) return undefined;
    return pe.key;
}

function pathElementEquals(a: PathElement, b: PathElement): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case PathElementKind.Type:
            return a.index === (b as any).index;
        case PathElementKind.KeyOrIndex:
            return a.key === (b as any).key;
        default:
            return true;
    }
}

export function checkJSONSchema(x: any): JSONSchema {
    if (typeof x === "boolean") return x;
    if (Array.isArray(x)) return messageError(ErrorMessage.SchemaArrayIsInvalidSchema);
    if (x === null) return messageError(ErrorMessage.SchemaNullIsInvalidSchema);
    if (typeof x !== "object") return messageError(ErrorMessage.SchemaInvalidJSONSchemaType, { type: typeof x });
    return x;
}

const numberRegexp = new RegExp("^[0-9]+$");

export class Ref {
    static root(address: string): Ref {
        const uri = new URI(address);
        return new Ref(uri, List());
    }

    private static parsePath(path: string): List<PathElement> {
        const elements: PathElement[] = [];

        if (path.startsWith("/")) {
            elements.push({ kind: PathElementKind.Root });
            path = path.substr(1);
        }

        if (path !== "") {
            const parts = path.split("/");
            for (let i = 0; i < parts.length; i++) {
                elements.push({ kind: PathElementKind.KeyOrIndex, key: parts[i] });
            }
        }
        return List(elements);
    }

    static parseURI(uri: uri.URI, destroyURI: boolean = false): Ref {
        if (!destroyURI) {
            uri = uri.clone();
        }

        let path = uri.fragment();
        uri.fragment("");
        if ((uri.host() !== "" || uri.filename() !== "") && path === "") {
            path = "/";
        }
        const elements = Ref.parsePath(path);
        return new Ref(uri, elements);
    }

    static parse(ref: any): Ref {
        if (typeof ref !== "string") {
            return messageError(ErrorMessage.SchemaRefMustBeString);
        }

        return Ref.parseURI(new URI(ref), true);
    }

    public addressURI: uri.URI | undefined;

    constructor(addressURI: uri.URI | undefined, readonly path: List<PathElement>) {
        if (addressURI !== undefined) {
            assert(addressURI.fragment() === "", `Ref URI with fragment is not allowed: ${addressURI.toString()}`);
            this.addressURI = addressURI.clone().normalize();
        } else {
            this.addressURI = undefined;
        }
    }

    get hasAddress(): boolean {
        return this.addressURI !== undefined;
    }

    get address(): string {
        return defined(this.addressURI).toString();
    }

    get isRoot(): boolean {
        return this.path.size === 1 && defined(this.path.first()).kind === PathElementKind.Root;
    }

    private pushElement(pe: PathElement): Ref {
        return new Ref(this.addressURI, this.path.push(pe));
    }

    push(...keys: string[]): Ref {
        let ref: Ref = this;
        for (const key of keys) {
            ref = ref.pushElement({ kind: PathElementKind.KeyOrIndex, key });
        }
        return ref;
    }

    pushObject(): Ref {
        return this.pushElement({ kind: PathElementKind.Object });
    }

    pushType(index: number): Ref {
        return this.pushElement({ kind: PathElementKind.Type, index });
    }

    resolveAgainst(base: Ref | undefined): Ref {
        let addressURI = this.addressURI;
        if (base !== undefined && base.addressURI !== undefined) {
            addressURI = addressURI === undefined ? base.addressURI : addressURI.absoluteTo(base.addressURI);
        }
        return new Ref(addressURI, this.path);
    }

    get name(): string {
        let path = this.path;

        for (;;) {
            const e = path.last();
            if (e === undefined || e.kind === PathElementKind.Root) {
                let name = this.addressURI !== undefined ? this.addressURI.filename() : "";
                const suffix = this.addressURI !== undefined ? this.addressURI.suffix() : "";
                if (name.length > suffix.length + 1) {
                    name = name.substr(0, name.length - suffix.length - 1);
                }
                if (name === "") {
                    return "Something";
                }
                return name;
            }

            switch (e.kind) {
                case PathElementKind.KeyOrIndex:
                    if (e.key.match(numberRegexp) !== null) {
                        return e.key;
                    }
                    break;
                case PathElementKind.Type:
                case PathElementKind.Object:
                    return panic("We shouldn't try to get the name of Type or Object refs");
                default:
                    return assertNever(e);
            }

            path = path.pop();
        }
    }

    get definitionName(): string | undefined {
        const pe = this.path.get(-2);
        if (pe === undefined) return undefined;
        if (keyOrIndex(pe) === "definitions") return keyOrIndex(defined(this.path.last()));
        return undefined;
    }

    toString(): string {
        function elementToString(e: PathElement): string {
            switch (e.kind) {
                case PathElementKind.Root:
                    return "/";
                case PathElementKind.Type:
                    return `type/${e.index.toString()}`;
                case PathElementKind.Object:
                    return "object";
                case PathElementKind.KeyOrIndex:
                    return e.key;
                default:
                    return assertNever(e);
            }
        }
        const address = this.addressURI === undefined ? "" : this.addressURI.toString();
        return address + "#" + this.path.map(elementToString).join("/");
    }

    lookupRef(root: JSONSchema): JSONSchema {
        function lookup(local: any, path: List<PathElement>): JSONSchema {
            const first = path.first();
            if (first === undefined) {
                return checkJSONSchema(local);
            }
            const rest = path.rest();
            switch (first.kind) {
                case PathElementKind.Root:
                    return lookup(root, rest);
                case PathElementKind.KeyOrIndex:
                    const key = first.key;
                    if (Array.isArray(local)) {
                        if (!/^\d+$/.test(key)) {
                            return messageError(ErrorMessage.SchemaCannotIndexArrayWithNonNumber, { actual: key });
                        }
                        const index = parseInt(first.key, 10);
                        if (index >= local.length) {
                            return messageError(ErrorMessage.SchemaIndexNotInArray, { index });
                        }
                        return lookup(local[index], rest);
                    } else {
                        if (!lodash.has(local, [key])) {
                            return messageError(ErrorMessage.SchemaKeyNotInObject, { key });
                        }
                        return lookup(checkStringMap(local)[first.key], rest);
                    }
                case PathElementKind.Type:
                    return panic('Cannot look up path that indexes "type"');
                case PathElementKind.Object:
                    return panic('Cannot look up path that indexes "object"');
                default:
                    return assertNever(first);
            }
        }
        return lookup(root, this.path);
    }

    equals(other: any): boolean {
        if (!(other instanceof Ref)) return false;
        if (this.addressURI !== undefined && other.addressURI !== undefined) {
            if (!this.addressURI.equals(other.addressURI)) return false;
        } else {
            if ((this.addressURI === undefined) !== (other.addressURI === undefined)) return false;
        }
        if (this.path.size !== other.path.size) return false;
        return this.path.zipWith(pathElementEquals, other.path).every(x => x);
    }

    hashCode(): number {
        let acc = hash(mapOptional(u => u.toString(), this.addressURI));
        this.path.forEach(pe => {
            acc = addHashCode(acc, pe.kind);
            switch (pe.kind) {
                case PathElementKind.Type:
                    acc = addHashCode(acc, pe.index);
                    break;
                case PathElementKind.KeyOrIndex:
                    acc = addHashCode(acc, hash(pe.key));
                    break;
                default:
                    break;
            }
        });
        return acc;
    }
}

class Location {
    public readonly canonicalRef: Ref;
    public readonly virtualRef: Ref;

    constructor(canonicalRef: Ref, virtualRef?: Ref) {
        this.canonicalRef = canonicalRef;
        this.virtualRef = virtualRef !== undefined ? virtualRef : canonicalRef;
    }

    updateWithID(id: any) {
        if (typeof id !== "string") return this;
        // FIXME: This is incorrect.  If the parsed ref doesn't have an address, the
        // current virtual one's must be used.  The canonizer must do this, too.
        return new Location(this.canonicalRef, Ref.parse(id).resolveAgainst(this.virtualRef));
    }

    push(...keys: string[]): Location {
        return new Location(this.canonicalRef.push(...keys), this.virtualRef.push(...keys));
    }

    pushObject(): Location {
        return new Location(this.canonicalRef.pushObject(), this.virtualRef.pushObject());
    }

    pushType(index: number): Location {
        return new Location(this.canonicalRef.pushType(index), this.virtualRef.pushType(index));
    }

    toString(): string {
        return `${this.virtualRef.toString()} (${this.canonicalRef.toString()})`;
    }
}

class Canonizer {
    private _map: Map<Ref, Ref> = Map();
    private _schemaAddressesAdded: Set<string> = Set();

    private addID(mapped: string, loc: Location): void {
        const ref = Ref.parse(mapped).resolveAgainst(loc.virtualRef);
        messageAssert(ref.hasAddress, ErrorMessage.SchemaIDMustHaveAddress, { id: mapped });
        this._map = this._map.set(ref, loc.canonicalRef);
    }

    private addIDs(schema: any, loc: Location) {
        if (schema === null) return;
        if (Array.isArray(schema)) {
            for (let i = 0; i < schema.length; i++) {
                this.addIDs(schema[i], loc.push(i.toString()));
            }
            return;
        }
        if (typeof schema !== "object") {
            return;
        }
        const maybeID = schema["$id"];
        if (typeof maybeID === "string") {
            this.addID(maybeID, loc);
            loc = loc.updateWithID(maybeID);
        }
        for (const property of Object.getOwnPropertyNames(schema)) {
            this.addIDs(schema[property], loc.push(property));
        }
    }

    addSchema(schema: any, address: string) {
        if (this._schemaAddressesAdded.has(address)) return;

        this.addIDs(schema, new Location(Ref.root(address)));
        this._schemaAddressesAdded = this._schemaAddressesAdded.add(address);
    }

    // Returns: Canonical ref, full virtual ref
    canonize(virtualBase: Ref | undefined, ref: Ref): [Ref, Ref] {
        const fullVirtual = ref.resolveAgainst(virtualBase);
        let virtual = fullVirtual;
        let relative: List<PathElement> = List();
        for (;;) {
            const maybeCanonical = this._map.get(virtual);
            if (maybeCanonical !== undefined) {
                return [new Ref(maybeCanonical.addressURI, maybeCanonical.path.concat(relative)), fullVirtual];
            }
            const last = virtual.path.last();
            if (last === undefined) {
                // We've exhausted our options - it's not a mapped ref.
                return [fullVirtual, fullVirtual];
            }
            if (last.kind !== PathElementKind.Root) {
                relative = relative.unshift(last);
            }
            virtual = new Ref(virtual.addressURI, virtual.path.pop());
        }
    }
}

function makeAttributes(schema: StringMap, loc: Location, attributes: TypeAttributes): TypeAttributes {
    const maybeDescription = schema.description;
    if (typeof maybeDescription === "string") {
        attributes = descriptionTypeAttributeKind.setInAttributes(attributes, OrderedSet([maybeDescription]));
    }
    return modifyTypeNames(attributes, maybeTypeNames => {
        const typeNames = defined(maybeTypeNames);
        if (!typeNames.areInferred) {
            return typeNames;
        }
        let title = schema.title;
        if (typeof title !== "string") {
            title = loc.canonicalRef.definitionName;
        }

        if (typeof title === "string") {
            return new TypeNames(OrderedSet([title]), OrderedSet(), false);
        } else {
            return typeNames.makeInferred();
        }
    });
}

function makeNonUnionAccessorAttributes(schema: StringMap): TypeAttributes | undefined {
    const maybeAccessors = schema["qt-accessors"];
    if (maybeAccessors === undefined) return undefined;
    return accessorNamesTypeAttributeKind.makeAttributes(checkAccessorNames(maybeAccessors));
}

function checkTypeList(typeOrTypes: any): OrderedSet<string> {
    if (typeof typeOrTypes === "string") {
        return OrderedSet([typeOrTypes]);
    } else if (Array.isArray(typeOrTypes)) {
        const arr: string[] = [];
        for (const t of typeOrTypes) {
            if (typeof t !== "string") {
                return messageError(ErrorMessage.SchemaTypeElementMustBeString, { element: t });
            }
            arr.push(t);
        }
        const set = OrderedSet(arr);
        messageAssert(!set.isEmpty(), ErrorMessage.SchemaNoTypeSpecified);
        return set;
    } else {
        return messageError(ErrorMessage.SchemaTypeMustBeStringOrStringArray, { actual: typeOrTypes });
    }
}

function checkRequiredArray(arr: any): string[] {
    if (!Array.isArray(arr)) {
        return messageError(ErrorMessage.SchemaRequiredMustBeStringOrStringArray, { actual: arr });
    }
    for (const e of arr) {
        if (typeof e !== "string") {
            return messageError(ErrorMessage.SchemaRequiredElementMustBeString, { element: e });
        }
    }
    return arr;
}

export async function addTypesInSchema(
    typeBuilder: TypeBuilder,
    store: JSONSchemaStore,
    references: Map<string, Ref>
): Promise<void> {
    const canonizer = new Canonizer();

    async function resolveVirtualRef(base: Location | undefined, virtualRef: Ref): Promise<[JSONSchema, Location]> {
        const [canonical, fullVirtual] = canonizer.canonize(mapOptional(b => b.virtualRef, base), virtualRef);
        assert(canonical.hasAddress, "Canonical ref can't be resolved without an address");
        const schema = await store.get(canonical.address);
        canonizer.addSchema(schema, canonical.address);
        return [canonical.lookupRef(schema), new Location(canonical, fullVirtual)];
    }

    let typeForCanonicalRef = Map<Ref, TypeRef>();

    async function setTypeForLocation(loc: Location, t: TypeRef): Promise<void> {
        const maybeRef = await typeForCanonicalRef.get(loc.canonicalRef);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForCanonicalRef = typeForCanonicalRef.set(loc.canonicalRef, t);
    }

    async function makeObject(
        loc: Location,
        attributes: TypeAttributes,
        properties: StringMap,
        requiredArray: string[],
        additionalProperties: any
    ): Promise<TypeRef> {
        const required = OrderedSet(requiredArray);
        const propertiesMap = OrderedMap(properties).sortBy((_, k) => k.toLowerCase());
        const propertyDescriptions = propertiesMap
            .map(propSchema => {
                if (typeof propSchema === "object") {
                    const desc = propSchema.description;
                    if (typeof desc === "string") {
                        return OrderedSet([desc]);
                    }
                }
                return undefined;
            })
            .filter(v => v !== undefined) as OrderedMap<string, OrderedSet<string>>;
        if (!propertyDescriptions.isEmpty()) {
            attributes = propertyDescriptionsTypeAttributeKind.setInAttributes(attributes, propertyDescriptions);
        }
        // FIXME: We're using a Map instead of an OrderedMap here because we represent
        // the JSON Schema as a JavaScript object, which has no map ordering.  Ideally
        // we would use a JSON parser that preserves order.
        let props = (await mapSync(propertiesMap, async (propSchema, propName) => {
            const t = await toType(
                checkJSONSchema(propSchema),
                loc.push("properties", propName),
                makeNamesTypeAttributes(pluralize.singular(propName), true)
            );
            const isOptional = !required.has(propName);
            return new ClassProperty(t, isOptional);
        })).toOrderedMap();
        let additionalPropertiesType: TypeRef | undefined;
        if (additionalProperties === undefined || additionalProperties === true) {
            additionalPropertiesType = typeBuilder.getPrimitiveType("any");
        } else if (additionalProperties === false) {
            additionalPropertiesType = undefined;
        } else {
            additionalPropertiesType = await toType(
                checkJSONSchema(additionalProperties),
                loc.push("additionalProperties"),
                singularizeTypeNames(attributes)
            );
        }
        const additionalRequired = required.subtract(props.keySeq());
        if (!additionalRequired.isEmpty()) {
            const t = additionalPropertiesType;
            if (t === undefined) {
                return messageError(ErrorMessage.SchemaAdditionalTypesForbidRequired);
            }

            const additionalProps = additionalRequired.toOrderedMap().map(_name => new ClassProperty(t, false));
            props = props.merge(additionalProps);
        }
        return typeBuilder.getUniqueObjectType(attributes, props, additionalPropertiesType);
    }

    async function convertToType(schema: StringMap, loc: Location, typeAttributes: TypeAttributes): Promise<TypeRef> {
        typeAttributes = makeAttributes(schema, loc, typeAttributes);
        const inferredAttributes = makeTypeAttributesInferred(typeAttributes);

        function makeStringType(): TypeRef {
            if (schema.format !== undefined) {
                switch (schema.format) {
                    case "date":
                        return typeBuilder.getPrimitiveType("date");
                    case "time":
                        return typeBuilder.getPrimitiveType("time");
                    case "date-time":
                        return typeBuilder.getPrimitiveType("date-time");
                    default:
                        // FIXME: Output a warning here instead to indicate that
                        // the format is uninterpreted.
                        return typeBuilder.getStringType(inferredAttributes, undefined);
                }
            }
            return typeBuilder.getStringType(inferredAttributes, undefined);
        }

        async function makeArrayType(): Promise<TypeRef> {
            const singularAttributes = singularizeTypeNames(typeAttributes);
            const items = schema.items;
            let itemType: TypeRef;
            if (Array.isArray(items)) {
                const itemsLoc = loc.push("items");
                const itemTypes = await mapSync(
                    items,
                    async (item, i) =>
                        await toType(checkStringMap(item), itemsLoc.push(i.toString()), singularAttributes)
                );
                itemType = typeBuilder.getUnionType(emptyTypeAttributes, OrderedSet(itemTypes));
            } else if (typeof items === "object") {
                itemType = await toType(checkStringMap(items), loc.push("items"), singularAttributes);
            } else if (items !== undefined) {
                return messageError(ErrorMessage.SchemaArrayItemsMustBeStringOrArray, { actual: items });
            } else {
                itemType = typeBuilder.getPrimitiveType("any");
            }
            typeBuilder.addAttributes(itemType, singularAttributes);
            return typeBuilder.getArrayType(itemType);
        }

        async function makeObjectType(): Promise<TypeRef> {
            let required: string[];
            if (schema.required === undefined) {
                required = [];
            } else {
                required = checkRequiredArray(schema.required);
            }

            let properties: StringMap;
            if (schema.properties === undefined) {
                properties = {};
            } else {
                properties = checkStringMap(schema.properties);
            }

            const additionalProperties = schema.additionalProperties;

            return await makeObject(loc, inferredAttributes, properties, required, additionalProperties);
        }

        async function makeTypesFromCases(cases: any, kind: string): Promise<TypeRef[]> {
            if (!Array.isArray(cases)) {
                return messageError(ErrorMessage.SchemaSetOperationCasesIsNotArray, { operation: kind, cases });
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            return await mapSync(
                cases,
                async (t, index) =>
                    await toType(
                        checkStringMap(t),
                        loc.push(kind, index.toString()),
                        makeTypeAttributesInferred(typeAttributes)
                    )
            );
        }

        async function convertOneOrAnyOf(cases: any, kind: string): Promise<TypeRef> {
            const maybeAccessors = schema["qt-accessors"];
            const unionType = typeBuilder.getUniqueUnionType(makeTypeAttributesInferred(typeAttributes), undefined);
            const typeRefs = await makeTypesFromCases(cases, kind);

            if (maybeAccessors !== undefined) {
                const identifierAttribute = makeUnionIdentifierAttribute();
                typeBuilder.addAttributes(unionType, identifierAttribute);

                const accessors = checkArray(maybeAccessors, isAccessorEntry);
                messageAssert(typeRefs.length === accessors.length, ErrorMessage.SchemaWrongAccessorEntryArrayLength, {
                    operation: kind
                });
                for (let i = 0; i < typeRefs.length; i++) {
                    typeBuilder.addAttributes(
                        typeRefs[i],
                        makeUnionMemberNamesAttribute(identifierAttribute, accessors[i])
                    );
                }
            }

            typeBuilder.setSetOperationMembers(unionType, OrderedSet(typeRefs));
            return unionType;
        }

        const enumArray = Array.isArray(schema.enum) ? schema.enum : undefined;
        const typeSet = mapOptional(checkTypeList, schema.type);

        function includePrimitiveType(name: string): boolean {
            if (typeSet !== undefined && !typeSet.has(name)) {
                return false;
            }
            if (enumArray !== undefined) {
                let predicate: (x: any) => boolean;
                switch (name) {
                    case "null":
                        predicate = (x: any) => x === null;
                        break;
                    case "integer":
                        predicate = (x: any) => typeof x === "number" && x === Math.floor(x);
                        break;
                    default:
                        predicate = (x: any) => typeof x === name;
                        break;
                }

                return enumArray.find(predicate) !== undefined;
            }
            return true;
        }

        const includeObject = enumArray === undefined && (typeSet === undefined || typeSet.has("object"));
        const includeArray = enumArray === undefined && (typeSet === undefined || typeSet.has("array"));
        const needStringEnum =
            includePrimitiveType("string") &&
            enumArray !== undefined &&
            enumArray.find((x: any) => typeof x === "string") !== undefined;
        const needUnion =
            typeSet !== undefined ||
            schema.properties !== undefined ||
            schema.additionalProperties !== undefined ||
            schema.items !== undefined ||
            schema.required !== undefined ||
            enumArray !== undefined;

        const intersectionType = typeBuilder.getUniqueIntersectionType(typeAttributes, undefined);
        await setTypeForLocation(loc, intersectionType);
        const types: TypeRef[] = [];

        if (needUnion) {
            const unionTypes: TypeRef[] = [];

            for (const [name, kind] of [
                ["null", "null"],
                ["number", "double"],
                ["integer", "integer"],
                ["boolean", "bool"]
            ] as [string, PrimitiveTypeKind][]) {
                if (!includePrimitiveType(name)) continue;

                unionTypes.push(typeBuilder.getPrimitiveType(kind));
            }

            if (needStringEnum) {
                let cases = enumArray as any[];
                cases = cases.filter(x => typeof x === "string");
                unionTypes.push(typeBuilder.getEnumType(inferredAttributes, OrderedSet(cases)));
            } else if (includePrimitiveType("string")) {
                unionTypes.push(makeStringType());
            }

            if (includeArray) {
                unionTypes.push(await makeArrayType());
            }
            if (includeObject) {
                unionTypes.push(await makeObjectType());
            }

            types.push(typeBuilder.getUniqueUnionType(inferredAttributes, OrderedSet(unionTypes)));
        }

        if (schema.$ref !== undefined) {
            const virtualRef = Ref.parse(schema.$ref);
            const [target, newLoc] = await resolveVirtualRef(loc, virtualRef);
            const attributes = modifyTypeNames(typeAttributes, tn => {
                if (!defined(tn).areInferred) return tn;
                return new TypeNames(OrderedSet([newLoc.canonicalRef.name]), OrderedSet(), true);
            });
            types.push(await toType(target, newLoc, attributes));
        }

        if (schema.allOf !== undefined) {
            types.push(...(await makeTypesFromCases(schema.allOf, "allOf")));
        }
        if (schema.oneOf !== undefined) {
            types.push(await convertOneOrAnyOf(schema.oneOf, "oneOf"));
        } else {
            const maybeAttributes = makeNonUnionAccessorAttributes(schema);
            if (maybeAttributes !== undefined) {
                typeBuilder.addAttributes(intersectionType, maybeAttributes);
            }
        }
        if (schema.anyOf !== undefined) {
            types.push(await convertOneOrAnyOf(schema.anyOf, "anyOf"));
        }

        typeBuilder.setSetOperationMembers(intersectionType, OrderedSet(types));
        return intersectionType;
    }

    async function toType(schema: JSONSchema, loc: Location, typeAttributes: TypeAttributes): Promise<TypeRef> {
        const maybeType = typeForCanonicalRef.get(loc.canonicalRef);
        if (maybeType !== undefined) {
            return maybeType;
        }

        let result: TypeRef;
        if (typeof schema === "boolean") {
            // FIXME: Empty union.  We'd have to check that it's supported everywhere,
            // in particular in union flattening.
            messageAssert(schema === true, ErrorMessage.SchemaFalseNotSupported);
            result = typeBuilder.getPrimitiveType("any");
        } else {
            loc = loc.updateWithID(schema["$id"]);
            result = await convertToType(schema, loc, typeAttributes);
        }

        await setTypeForLocation(loc, result);
        return result;
    }

    await forEachSync(references, async (topLevelRef, topLevelName) => {
        const [target, loc] = await resolveVirtualRef(undefined, topLevelRef);
        const t = await toType(target, loc, makeNamesTypeAttributes(topLevelName, false));
        typeBuilder.addTopLevel(topLevelName, t);
    });
}

function nameFromURI(uri: uri.URI): string | undefined {
    // FIXME: Try `title` first.
    const fragment = uri.fragment();
    if (fragment !== "") {
        const components = fragment.split("/");
        const len = components.length;
        if (components[len - 1] !== "") {
            return components[len - 1];
        }
        if (len > 1 && components[len - 2] !== "") {
            return components[len - 2];
        }
    }
    const filename = uri.filename();
    if (filename !== "") {
        return filename;
    }
    return messageError(ErrorMessage.DriverCannotInferNameForSchema, { uri: uri.toString() });
}

export async function refsInSchemaForURI(
    store: JSONSchemaStore,
    uri: uri.URI,
    defaultName: string
): Promise<Map<string, Ref> | [string, Ref]> {
    const fragment = uri.fragment();
    let propertiesAreTypes = fragment.endsWith("/");
    if (propertiesAreTypes) {
        uri = uri.clone().fragment(fragment.substr(0, fragment.length - 1));
    }
    const ref = Ref.parseURI(uri);
    if (ref.isRoot) {
        propertiesAreTypes = false;
    }

    const rootSchema = await store.get(ref.address);
    const schema = ref.lookupRef(rootSchema);

    if (propertiesAreTypes) {
        if (typeof schema !== "object") {
            return messageError(ErrorMessage.SchemaCannotGetTypesFromBoolean, { ref: ref.toString() });
        }
        return Map(schema).map((_, name) => ref.push(name));
    } else {
        let name: string;
        if (typeof schema === "object" && typeof schema.title === "string") {
            name = schema.title;
        } else {
            const maybeName = nameFromURI(uri);
            name = maybeName !== undefined ? maybeName : defaultName;
        }
        return [name, ref];
    }
}
