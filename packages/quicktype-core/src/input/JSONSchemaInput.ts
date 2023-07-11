import URI from "urijs";
import {
    setFilter,
    EqualityMap,
    mapMap,
    mapFromObject,
    setSubtract,
    mapFromIterable,
    iterableFind,
    mapSortBy,
    mapMapSync,
    mapMergeInto,
    arrayMapSync,
    arrayLast,
    arrayGetFromEnd,
    hashCodeOf,
    hasOwnProperty,
    definedMap,
    addHashCode,
    iterableFirst,
    hashString
} from "collection-utils";

import {
    PrimitiveTypeKind,
    TransformedStringTypeKind,
    transformedStringTypeTargetTypeKindsMap,
    isNumberTypeKind
} from "../Type";
import { panic, assertNever, StringMap, assert, defined, parseJSON } from "../support/Support";
import { TypeBuilder } from "../TypeBuilder";
import { TypeNames } from "../attributes/TypeNames";
import { makeNamesTypeAttributes, modifyTypeNames, singularizeTypeNames } from "../attributes/TypeNames";
import {
    TypeAttributes,
    makeTypeAttributesInferred,
    emptyTypeAttributes,
    combineTypeAttributes
} from "../attributes/TypeAttributes";
import { JSONSchema, JSONSchemaStore } from "./JSONSchemaStore";
import { messageAssert, messageError } from "../Messages";
import { StringTypes } from "../attributes/StringTypes";

import { TypeRef } from "../TypeGraph";
import { type RunContext } from "../Run";
import { type Input } from "./Inputs";

// There's a cyclic import here. Ignoring now because it requires a large refactor.
// skipcq: JS-E1008
import { descriptionAttributeProducer } from "../attributes/Description";

import { accessorNamesAttributeProducer } from "../attributes/AccessorNames";
import { enumValuesAttributeProducer } from "../attributes/EnumValues";
import { minMaxAttributeProducer } from "../attributes/Constraints";
import { minMaxLengthAttributeProducer } from "../attributes/Constraints";
import { patternAttributeProducer } from "../attributes/Constraints";
import { uriSchemaAttributesProducer } from "../attributes/URIAttributes";

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

function withRef(refOrLoc: Ref | (() => Ref) | Location): { ref: Ref };
function withRef<T extends object>(refOrLoc: Ref | (() => Ref) | Location, props?: T): T & { ref: Ref };
function withRef<T extends object>(refOrLoc: Ref | (() => Ref) | Location, props?: T): any {
    const ref =
        typeof refOrLoc === "function" ? refOrLoc() : refOrLoc instanceof Ref ? refOrLoc : refOrLoc.canonicalRef;
    return Object.assign({ ref }, props === undefined ? {} : props);
}

function checkJSONSchemaObject(x: any, refOrLoc: Ref | (() => Ref)): StringMap {
    if (Array.isArray(x)) {
        return messageError("SchemaArrayIsInvalidSchema", withRef(refOrLoc));
    }
    if (x === null) {
        return messageError("SchemaNullIsInvalidSchema", withRef(refOrLoc));
    }
    if (typeof x !== "object") {
        return messageError("SchemaInvalidJSONSchemaType", withRef(refOrLoc, { type: typeof x }));
    }
    return x;
}

function checkJSONSchema(x: any, refOrLoc: Ref | (() => Ref)): JSONSchema {
    if (typeof x === "boolean") return x;
    return checkJSONSchemaObject(x, refOrLoc);
}

const numberRegexp = new RegExp("^[0-9]+$");

function normalizeURI(uri: string | URI): URI {
    // FIXME: This is overly complicated and a bit shady.  The problem is
    // that `normalize` will URL-escape, with the result that if we want to
    // open the URL as a file, escaped character will thwart us.  I think the
    // JSONSchemaStore should take a URI, not a string, and if it reads from
    // a file it can decode by itself.
    if (typeof uri === "string") {
        uri = new URI(uri);
    }
    return new URI(URI.decode(uri.clone().normalize().toString()));
}

export class Ref {
    static root(address: string | undefined): Ref {
        const uri = definedMap(address, a => new URI(a));
        return new Ref(uri, []);
    }

    private static parsePath(path: string): ReadonlyArray<PathElement> {
        const elements: PathElement[] = [];

        if (path.startsWith("/")) {
            elements.push({ kind: PathElementKind.Root });
            path = path.slice(1);
        }

        if (path !== "") {
            const parts = path.split("/");
            for (let i = 0; i < parts.length; i++) {
                elements.push({ kind: PathElementKind.KeyOrIndex, key: parts[i] });
            }
        }
        return elements;
    }

    static parseURI(uri: URI, destroyURI = false): Ref {
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

    static parse(ref: string): Ref {
        return Ref.parseURI(new URI(ref), true);
    }

    public addressURI: URI | undefined;

    constructor(
        addressURI: URI | undefined,
        readonly path: ReadonlyArray<PathElement>
    ) {
        if (addressURI !== undefined) {
            assert(addressURI.fragment() === "", `Ref URI with fragment is not allowed: ${addressURI.toString()}`);
            this.addressURI = normalizeURI(addressURI);
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
        return this.path.length === 1 && this.path[0].kind === PathElementKind.Root;
    }

    private pushElement(pe: PathElement): Ref {
        const newPath = Array.from(this.path);
        newPath.push(pe);
        return new Ref(this.addressURI, newPath);
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
        const path = Array.from(this.path);

        for (;;) {
            const e = path.pop();
            if (e === undefined || e.kind === PathElementKind.Root) {
                let name = this.addressURI !== undefined ? this.addressURI.filename() : "";
                const suffix = this.addressURI !== undefined ? this.addressURI.suffix() : "";
                if (name.length > suffix.length + 1) {
                    name = name.slice(0, name.length - suffix.length - 1);
                }
                if (name === "") {
                    return "Something";
                }
                return name;
            }

            switch (e.kind) {
                case PathElementKind.KeyOrIndex:
                    if (numberRegexp.test(e.key)) {
                        return e.key;
                    }
                    break;
                case PathElementKind.Type:
                case PathElementKind.Object:
                    return panic("We shouldn't try to get the name of Type or Object refs");
                default:
                    return assertNever(e);
            }
        }
    }

    get definitionName(): string | undefined {
        const pe = arrayGetFromEnd(this.path, 2);
        if (pe === undefined) return undefined;
        if (keyOrIndex(pe) === "definitions") return keyOrIndex(defined(arrayLast(this.path)));
        return undefined;
    }

    toString(): string {
        function elementToString(e: PathElement): string {
            switch (e.kind) {
                case PathElementKind.Root:
                    return "";
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

    private lookup(local: any, path: ReadonlyArray<PathElement>, root: JSONSchema): JSONSchema {
        const refMaker = () => new Ref(this.addressURI, path);
        const first = path[0];
        if (first === undefined) {
            return checkJSONSchema(local, refMaker);
        }
        const rest = path.slice(1);
        switch (first.kind) {
            case PathElementKind.Root:
                return this.lookup(root, rest, root);
            case PathElementKind.KeyOrIndex:
                const key = first.key;
                if (Array.isArray(local)) {
                    if (!/^\d+$/.test(key)) {
                        return messageError("SchemaCannotIndexArrayWithNonNumber", withRef(refMaker, { actual: key }));
                    }
                    const index = parseInt(first.key, 10);
                    if (index >= local.length) {
                        return messageError("SchemaIndexNotInArray", withRef(refMaker, { index }));
                    }
                    return this.lookup(local[index], rest, root);
                } else {
                    if (!hasOwnProperty(local, key)) {
                        return messageError("SchemaKeyNotInObject", withRef(refMaker, { key }));
                    }
                    return this.lookup(checkJSONSchemaObject(local, refMaker)[first.key], rest, root);
                }
            case PathElementKind.Type:
                return panic('Cannot look up path that indexes "type"');
            case PathElementKind.Object:
                return panic('Cannot look up path that indexes "object"');
            default:
                return assertNever(first);
        }
    }

    lookupRef(root: JSONSchema): JSONSchema {
        return this.lookup(root, this.path, root);
    }

    equals(other: any): boolean {
        if (!(other instanceof Ref)) return false;
        if (this.addressURI !== undefined && other.addressURI !== undefined) {
            if (!this.addressURI.equals(other.addressURI)) return false;
        } else {
            if ((this.addressURI === undefined) !== (other.addressURI === undefined)) return false;
        }
        const l = this.path.length;
        if (l !== other.path.length) return false;
        for (let i = 0; i < l; i++) {
            if (!pathElementEquals(this.path[i], other.path[i])) return false;
        }
        return true;
    }

    hashCode(): number {
        let acc = hashCodeOf(definedMap(this.addressURI, u => u.toString()));
        for (const pe of this.path) {
            acc = addHashCode(acc, pe.kind);
            switch (pe.kind) {
                case PathElementKind.Type:
                    acc = addHashCode(acc, pe.index);
                    break;
                case PathElementKind.KeyOrIndex:
                    acc = addHashCode(acc, hashString(pe.key));
                    break;
                default:
                    break;
            }
        }
        return acc;
    }
}

class Location {
    public readonly canonicalRef: Ref;
    public readonly virtualRef: Ref;

    constructor(
        canonicalRef: Ref,
        virtualRef?: Ref,
        readonly haveID: boolean = false
    ) {
        this.canonicalRef = canonicalRef;
        this.virtualRef = virtualRef !== undefined ? virtualRef : canonicalRef;
    }

    updateWithID(id: any) {
        if (typeof id !== "string") return this;
        const parsed = Ref.parse(id);
        const virtual = this.haveID ? parsed.resolveAgainst(this.virtualRef) : parsed;
        if (!this.haveID) {
            messageAssert(virtual.hasAddress, "SchemaIDMustHaveAddress", withRef(this, { id }));
        }
        return new Location(this.canonicalRef, virtual, true);
    }

    push(...keys: string[]): Location {
        return new Location(this.canonicalRef.push(...keys), this.virtualRef.push(...keys), this.haveID);
    }

    pushObject(): Location {
        return new Location(this.canonicalRef.pushObject(), this.virtualRef.pushObject(), this.haveID);
    }

    pushType(index: number): Location {
        return new Location(this.canonicalRef.pushType(index), this.virtualRef.pushType(index), this.haveID);
    }

    toString(): string {
        return `${this.virtualRef.toString()} (${this.canonicalRef.toString()})`;
    }
}

class Canonizer {
    private readonly _map = new EqualityMap<Ref, Location>();
    private readonly _schemaAddressesAdded = new Set<string>();

    constructor(private readonly _ctx: RunContext) {}

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
        const locWithoutID = loc;
        const maybeID = schema["$id"];
        if (typeof maybeID === "string") {
            loc = loc.updateWithID(maybeID);
        }
        if (loc.haveID) {
            if (this._ctx.debugPrintSchemaResolving) {
                console.log(`adding mapping ${loc.toString()}`);
            }
            this._map.set(loc.virtualRef, locWithoutID);
        }
        for (const property of Object.getOwnPropertyNames(schema)) {
            this.addIDs(schema[property], loc.push(property));
        }
    }

    addSchema(schema: any, address: string): boolean {
        if (this._schemaAddressesAdded.has(address)) return false;

        this.addIDs(schema, new Location(Ref.root(address), Ref.root(undefined)));
        this._schemaAddressesAdded.add(address);
        return true;
    }

    // Returns: Canonical ref
    canonize(base: Location, ref: Ref): Location {
        const virtual = ref.resolveAgainst(base.virtualRef);
        const loc = this._map.get(virtual);
        if (loc !== undefined) {
            return loc;
        }
        const canonicalRef =
            virtual.addressURI === undefined ? new Ref(base.canonicalRef.addressURI, virtual.path) : virtual;
        return new Location(canonicalRef, new Ref(undefined, virtual.path));
    }
}

function checkTypeList(typeOrTypes: any, loc: Location): ReadonlySet<string> {
    let set: Set<string>;
    if (typeof typeOrTypes === "string") {
        set = new Set([typeOrTypes]);
    } else if (Array.isArray(typeOrTypes)) {
        const arr: string[] = [];
        for (const t of typeOrTypes) {
            if (typeof t !== "string") {
                return messageError("SchemaTypeElementMustBeString", withRef(loc, { element: t }));
            }
            arr.push(t);
        }
        set = new Set(arr);
    } else {
        return messageError("SchemaTypeMustBeStringOrStringArray", withRef(loc, { actual: typeOrTypes }));
    }
    messageAssert(set.size > 0, "SchemaNoTypeSpecified", withRef(loc));
    const validTypes = ["null", "boolean", "object", "array", "number", "string", "integer"];
    const maybeInvalid = iterableFind(set, s => validTypes.indexOf(s) < 0);
    if (maybeInvalid !== undefined) {
        return messageError("SchemaInvalidType", withRef(loc, { type: maybeInvalid }));
    }
    return set;
}

function checkRequiredArray(arr: any, loc: Location): string[] {
    if (!Array.isArray(arr)) {
        return messageError("SchemaRequiredMustBeStringOrStringArray", withRef(loc, { actual: arr }));
    }
    for (const e of arr) {
        if (typeof e !== "string") {
            return messageError("SchemaRequiredElementMustBeString", withRef(loc, { element: e }));
        }
    }
    return arr;
}

export const schemaTypeDict = {
    null: true,
    boolean: true,
    string: true,
    integer: true,
    number: true,
    array: true,
    object: true
};
export type JSONSchemaType = keyof typeof schemaTypeDict;

const schemaTypes = Object.getOwnPropertyNames(schemaTypeDict) as JSONSchemaType[];

export type JSONSchemaAttributes = {
    forType?: TypeAttributes;
    forUnion?: TypeAttributes;
    forObject?: TypeAttributes;
    forNumber?: TypeAttributes;
    forString?: TypeAttributes;
    forCases?: TypeAttributes[];
};
export type JSONSchemaAttributeProducer = (
    schema: JSONSchema,
    canonicalRef: Ref,
    types: Set<JSONSchemaType>,
    unionCases: JSONSchema[] | undefined
) => JSONSchemaAttributes | undefined;

function typeKindForJSONSchemaFormat(format: string): TransformedStringTypeKind | undefined {
    const target = iterableFind(
        transformedStringTypeTargetTypeKindsMap,
        ([_, { jsonSchema }]) => jsonSchema === format
    );
    if (target === undefined) return undefined;
    return target[0] as TransformedStringTypeKind;
}

function schemaFetchError(base: Location | undefined, address: string): never {
    if (base === undefined) {
        return messageError("SchemaFetchErrorTopLevel", { address });
    } else {
        return messageError("SchemaFetchError", { address, base: base.canonicalRef });
    }
}

class Resolver {
    constructor(
        private readonly _ctx: RunContext,
        private readonly _store: JSONSchemaStore,
        private readonly _canonizer: Canonizer
    ) {}

    private async tryResolveVirtualRef(
        fetchBase: Location,
        lookupBase: Location,
        virtualRef: Ref
    ): Promise<[JSONSchema | undefined, Location]> {
        let didAdd = false;
        // If we are resolving into a schema file that we haven't seen yet then
        // we don't know its $id mapping yet, which means we don't know where we
        // will end up.  What we do if we encounter a new schema is add all its
        // IDs first, and then try to canonize again.
        for (;;) {
            const loc = this._canonizer.canonize(fetchBase, virtualRef);
            const canonical = loc.canonicalRef;
            assert(canonical.hasAddress, "Canonical ref can't be resolved without an address");
            const address = canonical.address;

            let schema =
                canonical.addressURI === undefined
                    ? undefined
                    : await this._store.get(address, this._ctx.debugPrintSchemaResolving);
            if (schema === undefined) {
                return [undefined, loc];
            }

            if (this._canonizer.addSchema(schema, address)) {
                assert(!didAdd, "We can't add a schema twice");
                didAdd = true;
            } else {
                let lookupLoc = this._canonizer.canonize(lookupBase, virtualRef);
                if (fetchBase !== undefined) {
                    lookupLoc = new Location(
                        new Ref(loc.canonicalRef.addressURI, lookupLoc.canonicalRef.path),
                        lookupLoc.virtualRef,
                        lookupLoc.haveID
                    );
                }
                return [lookupLoc.canonicalRef.lookupRef(schema), lookupLoc];
            }
        }
    }

    async resolveVirtualRef(base: Location, virtualRef: Ref): Promise<[JSONSchema, Location]> {
        if (this._ctx.debugPrintSchemaResolving) {
            console.log(`resolving ${virtualRef.toString()} relative to ${base.toString()}`);
        }

        // Try with the virtual base first.  If that doesn't work, use the
        // canonical ref's address with the virtual base's path.
        let result = await this.tryResolveVirtualRef(base, base, virtualRef);
        let schema = result[0];
        if (schema !== undefined) {
            if (this._ctx.debugPrintSchemaResolving) {
                console.log(`resolved to ${result[1].toString()}`);
            }
            return [schema, result[1]];
        }

        const altBase = new Location(
            base.canonicalRef,
            new Ref(base.canonicalRef.addressURI, base.virtualRef.path),
            base.haveID
        );
        result = await this.tryResolveVirtualRef(altBase, base, virtualRef);
        schema = result[0];
        if (schema !== undefined) {
            if (this._ctx.debugPrintSchemaResolving) {
                console.log(`resolved to ${result[1].toString()}`);
            }
            return [schema, result[1]];
        }

        return schemaFetchError(base, virtualRef.address);
    }

    async resolveTopLevelRef(ref: Ref): Promise<[JSONSchema, Location]> {
        return await this.resolveVirtualRef(new Location(new Ref(ref.addressURI, [])), new Ref(undefined, ref.path));
    }
}

async function addTypesInSchema(
    resolver: Resolver,
    typeBuilder: TypeBuilder,
    references: ReadonlyMap<string, Ref>,
    attributeProducers: JSONSchemaAttributeProducer[]
): Promise<void> {
    let typeForCanonicalRef = new EqualityMap<Ref, TypeRef>();

    function setTypeForLocation(loc: Location, t: TypeRef): void {
        const maybeRef = typeForCanonicalRef.get(loc.canonicalRef);
        if (maybeRef !== undefined) {
            assert(maybeRef === t, "Trying to set path again to different type");
        }
        typeForCanonicalRef.set(loc.canonicalRef, t);
    }

    async function makeObject(
        loc: Location,
        attributes: TypeAttributes,
        properties: StringMap,
        requiredArray: string[],
        additionalProperties: any,
        sortKey: (k: string) => number | string = (k: string) => k.toLowerCase()
    ): Promise<TypeRef> {
        const required = new Set(requiredArray);
        const propertiesMap = mapSortBy(mapFromObject(properties), (_, k) => sortKey(k));
        const props = await mapMapSync(propertiesMap, async (propSchema, propName) => {
            const propLoc = loc.push("properties", propName);
            const t = await toType(
                checkJSONSchema(propSchema, propLoc.canonicalRef),
                propLoc,
                makeNamesTypeAttributes(propName, true)
            );
            const isOptional = !required.has(propName);
            return typeBuilder.makeClassProperty(t, isOptional);
        });
        let additionalPropertiesType: TypeRef | undefined;
        if (additionalProperties === undefined || additionalProperties === true) {
            additionalPropertiesType = typeBuilder.getPrimitiveType("any");
        } else if (additionalProperties === false) {
            additionalPropertiesType = undefined;
        } else {
            const additionalLoc = loc.push("additionalProperties");
            additionalPropertiesType = await toType(
                checkJSONSchema(additionalProperties, additionalLoc.canonicalRef),
                additionalLoc,
                singularizeTypeNames(attributes)
            );
        }
        const additionalRequired = setSubtract(required, props.keys());
        if (additionalRequired.size > 0) {
            const t = additionalPropertiesType;
            if (t === undefined) {
                return messageError("SchemaAdditionalTypesForbidRequired", withRef(loc));
            }

            const additionalProps = mapFromIterable(additionalRequired, _name =>
                typeBuilder.makeClassProperty(t, false)
            );
            mapMergeInto(props, additionalProps);
        }
        return typeBuilder.getUniqueObjectType(attributes, props, additionalPropertiesType);
    }

    async function convertToType(schema: StringMap, loc: Location, typeAttributes: TypeAttributes): Promise<TypeRef> {
        const enumArray = Array.isArray(schema.enum) ? schema.enum : undefined;
        const isConst = schema.const !== undefined;
        const typeSet = definedMap(schema.type, t => checkTypeList(t, loc));

        function isTypeIncluded(name: JSONSchemaType): boolean {
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
            if (isConst) {
                return name === (schema.type ?? typeof schema.const);
            }
            return true;
        }

        const includedTypes = setFilter(schemaTypes, isTypeIncluded);
        let producedAttributesForNoCases: JSONSchemaAttributes[] | undefined = undefined;

        function forEachProducedAttribute(
            cases: JSONSchema[] | undefined,
            f: (attributes: JSONSchemaAttributes) => void
        ): void {
            let attributes: JSONSchemaAttributes[];
            if (cases === undefined && producedAttributesForNoCases !== undefined) {
                attributes = producedAttributesForNoCases;
            } else {
                attributes = [];
                for (const producer of attributeProducers) {
                    const newAttributes = producer(schema, loc.canonicalRef, includedTypes, cases);
                    if (newAttributes === undefined) continue;
                    attributes.push(newAttributes);
                }
                if (cases === undefined) {
                    producedAttributesForNoCases = attributes;
                }
            }
            for (const a of attributes) {
                f(a);
            }
        }

        function combineProducedAttributes(
            f: (attributes: JSONSchemaAttributes) => TypeAttributes | undefined
        ): TypeAttributes {
            let result = emptyTypeAttributes;
            forEachProducedAttribute(undefined, attr => {
                const maybeAttributes = f(attr);
                if (maybeAttributes === undefined) return;
                result = combineTypeAttributes("union", result, maybeAttributes);
            });
            return result;
        }

        function makeAttributes(attributes: TypeAttributes): TypeAttributes {
            if (schema.oneOf === undefined) {
                attributes = combineTypeAttributes(
                    "union",
                    attributes,
                    combineProducedAttributes(({ forType, forUnion, forCases }) => {
                        assert(
                            forUnion === undefined && forCases === undefined,
                            "We can't have attributes for unions and cases if we don't have a union"
                        );
                        return forType;
                    })
                );
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
                    return TypeNames.make(new Set([title]), new Set(), schema.$ref !== undefined);
                } else {
                    return typeNames.makeInferred();
                }
            });
        }

        typeAttributes = makeAttributes(typeAttributes);
        const inferredAttributes = makeTypeAttributesInferred(typeAttributes);

        function makeStringType(attributes: TypeAttributes): TypeRef {
            const kind = typeKindForJSONSchemaFormat(schema.format);
            if (kind === undefined) {
                return typeBuilder.getStringType(attributes, StringTypes.unrestricted);
            } else {
                return typeBuilder.getPrimitiveType(kind, attributes);
            }
        }

        async function makeArrayType(): Promise<TypeRef> {
            const singularAttributes = singularizeTypeNames(typeAttributes);
            const items = schema.items;
            let itemType: TypeRef;
            if (Array.isArray(items)) {
                const itemsLoc = loc.push("items");
                const itemTypes = await arrayMapSync(items, async (item, i) => {
                    const itemLoc = itemsLoc.push(i.toString());
                    return await toType(checkJSONSchema(item, itemLoc.canonicalRef), itemLoc, singularAttributes);
                });
                itemType = typeBuilder.getUnionType(emptyTypeAttributes, new Set(itemTypes));
            } else if (typeof items === "object") {
                const itemsLoc = loc.push("items");
                itemType = await toType(checkJSONSchema(items, itemsLoc.canonicalRef), itemsLoc, singularAttributes);
            } else if (items !== undefined) {
                return messageError("SchemaArrayItemsMustBeStringOrArray", withRef(loc, { actual: items }));
            } else {
                itemType = typeBuilder.getPrimitiveType("any");
            }
            typeBuilder.addAttributes(itemType, singularAttributes);
            return typeBuilder.getArrayType(emptyTypeAttributes, itemType);
        }

        async function makeObjectType(): Promise<TypeRef> {
            let required: string[];
            if (schema.required === undefined || typeof schema.required === "boolean") {
                required = [];
            } else {
                required = Array.from(checkRequiredArray(schema.required, loc));
            }

            let properties: StringMap;
            if (schema.properties === undefined) {
                properties = {};
            } else {
                properties = checkJSONSchemaObject(schema.properties, loc.canonicalRef);
            }

            // In Schema Draft 3, `required` is `true` on a property that's required.
            for (const p of Object.getOwnPropertyNames(properties)) {
                if (properties[p].required === true && required.indexOf(p) < 0) {
                    required.push(p);
                }
            }

            let additionalProperties = schema.additionalProperties;
            // This is an incorrect hack to fix an issue with a Go->Schema generator:
            // https://github.com/quicktype/quicktype/issues/976
            if (
                additionalProperties === undefined &&
                typeof schema.patternProperties === "object" &&
                hasOwnProperty(schema.patternProperties, ".*")
            ) {
                additionalProperties = schema.patternProperties[".*"];
            }

            const objectAttributes = combineTypeAttributes(
                "union",
                inferredAttributes,
                combineProducedAttributes(({ forObject }) => forObject)
            );
            const order = schema.quicktypePropertyOrder ? schema.quicktypePropertyOrder : [];
            const orderKey = (propertyName: string) => {
                // use the index of the order array
                const index = order.indexOf(propertyName);
                // if no index then use the property name
                return index !== -1 ? index : propertyName.toLowerCase();
            };

            return await makeObject(loc, objectAttributes, properties, required, additionalProperties, orderKey);
        }

        async function makeTypesFromCases(cases: any, kind: string): Promise<TypeRef[]> {
            const kindLoc = loc.push(kind);
            if (!Array.isArray(cases)) {
                return messageError("SchemaSetOperationCasesIsNotArray", withRef(kindLoc, { operation: kind, cases }));
            }
            // FIXME: This cast shouldn't be necessary, but TypeScript forces our hand.
            return await arrayMapSync(cases, async (t, index) => {
                const caseLoc = kindLoc.push(index.toString());
                return await toType(
                    checkJSONSchema(t, caseLoc.canonicalRef),
                    caseLoc,
                    makeTypeAttributesInferred(typeAttributes)
                );
            });
        }

        const intersectionType = typeBuilder.getUniqueIntersectionType(typeAttributes, undefined);
        setTypeForLocation(loc, intersectionType);

        async function convertOneOrAnyOf(cases: any, kind: string): Promise<TypeRef> {
            const typeRefs = await makeTypesFromCases(cases, kind);
            let unionAttributes = makeTypeAttributesInferred(typeAttributes);
            if (kind === "oneOf") {
                forEachProducedAttribute(cases as JSONSchema[], ({ forType, forUnion, forCases }) => {
                    if (forType !== undefined) {
                        typeBuilder.addAttributes(intersectionType, forType);
                    }
                    if (forUnion !== undefined) {
                        unionAttributes = combineTypeAttributes("union", unionAttributes, forUnion);
                    }
                    if (forCases !== undefined) {
                        assert(
                            forCases.length === typeRefs.length,
                            "Number of case attributes doesn't match number of cases"
                        );
                        for (let i = 0; i < typeRefs.length; i++) {
                            typeBuilder.addAttributes(typeRefs[i], forCases[i]);
                        }
                    }
                });
            }
            const unionType = typeBuilder.getUniqueUnionType(unionAttributes, undefined);
            typeBuilder.setSetOperationMembers(unionType, new Set(typeRefs));
            return unionType;
        }

        const includeObject = enumArray === undefined && !isConst && (typeSet === undefined || typeSet.has("object"));
        const includeArray = enumArray === undefined && !isConst && (typeSet === undefined || typeSet.has("array"));
        const needStringEnum =
            includedTypes.has("string") &&
            enumArray !== undefined &&
            enumArray.find((x: any) => typeof x === "string") !== undefined;
        const needUnion =
            typeSet !== undefined ||
            schema.properties !== undefined ||
            schema.additionalProperties !== undefined ||
            schema.items !== undefined ||
            schema.required !== undefined ||
            enumArray !== undefined ||
            isConst;

        const types: TypeRef[] = [];

        if (needUnion) {
            const unionTypes: TypeRef[] = [];

            const numberAttributes = combineProducedAttributes(({ forNumber }) => forNumber);

            for (const [name, kind] of [
                ["null", "null"],
                ["number", "double"],
                ["integer", "integer"],
                ["boolean", "bool"]
            ] as [JSONSchemaType, PrimitiveTypeKind][]) {
                if (!includedTypes.has(name)) continue;

                const attributes = isNumberTypeKind(kind) ? numberAttributes : undefined;
                unionTypes.push(typeBuilder.getPrimitiveType(kind, attributes));
            }

            const stringAttributes = combineTypeAttributes(
                "union",
                inferredAttributes,
                combineProducedAttributes(({ forString }) => forString)
            );

            if (needStringEnum || isConst) {
                const cases = isConst
                    ? [schema.const]
                    : ((enumArray as any[]).filter(x => typeof x === "string") as string[]);
                unionTypes.push(typeBuilder.getStringType(stringAttributes, StringTypes.fromCases(cases)));
            } else if (includedTypes.has("string")) {
                unionTypes.push(makeStringType(stringAttributes));
            }

            if (includeArray) {
                unionTypes.push(await makeArrayType());
            }
            if (includeObject) {
                unionTypes.push(await makeObjectType());
            }

            types.push(typeBuilder.getUniqueUnionType(inferredAttributes, new Set(unionTypes)));
        }

        if (schema.$ref !== undefined) {
            if (typeof schema.$ref !== "string") {
                return messageError("SchemaRefMustBeString", withRef(loc, { actual: typeof schema.$ref }));
            }
            const virtualRef = Ref.parse(schema.$ref);
            const [target, newLoc] = await resolver.resolveVirtualRef(loc, virtualRef);
            const attributes = modifyTypeNames(typeAttributes, tn => {
                if (!defined(tn).areInferred) return tn;
                return TypeNames.make(new Set([newLoc.canonicalRef.name]), new Set(), true);
            });
            types.push(await toType(target, newLoc, attributes));
        }

        if (schema.allOf !== undefined) {
            types.push(...(await makeTypesFromCases(schema.allOf, "allOf")));
        }
        if (schema.oneOf !== undefined) {
            types.push(await convertOneOrAnyOf(schema.oneOf, "oneOf"));
        }
        if (schema.anyOf !== undefined) {
            types.push(await convertOneOrAnyOf(schema.anyOf, "anyOf"));
        }

        typeBuilder.setSetOperationMembers(intersectionType, new Set(types));
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
            messageAssert(schema === true, "SchemaFalseNotSupported", withRef(loc));
            result = typeBuilder.getPrimitiveType("any");
        } else {
            loc = loc.updateWithID(schema["$id"]);
            result = await convertToType(schema, loc, typeAttributes);
        }

        setTypeForLocation(loc, result);
        return result;
    }

    for (const [topLevelName, topLevelRef] of references) {
        const [target, loc] = await resolver.resolveTopLevelRef(topLevelRef);
        const t = await toType(target, loc, makeNamesTypeAttributes(topLevelName, false));
        typeBuilder.addTopLevel(topLevelName, t);
    }
}

function removeExtension(fn: string): string {
    const lower = fn.toLowerCase();
    const extensions = [".json", ".schema"];
    for (const ext of extensions) {
        if (lower.endsWith(ext)) {
            const base = fn.slice(0, fn.length - ext.length);
            if (base.length > 0) {
                return base;
            }
        }
    }
    return fn;
}

function nameFromURI(uri: URI): string | undefined {
    const fragment = uri.fragment();
    if (fragment !== "") {
        const components = fragment.split("/");
        const len = components.length;
        if (components[len - 1] !== "") {
            return removeExtension(components[len - 1]);
        }
        if (len > 1 && components[len - 2] !== "") {
            return removeExtension(components[len - 2]);
        }
    }
    const filename = uri.filename();
    if (filename !== "") {
        return removeExtension(filename);
    }
    return messageError("DriverCannotInferNameForSchema", { uri: uri.toString() });
}

async function refsInSchemaForURI(
    resolver: Resolver,
    uri: URI,
    defaultName: string
): Promise<ReadonlyMap<string, Ref> | [string, Ref]> {
    const fragment = uri.fragment();
    let propertiesAreTypes = fragment.endsWith("/");
    if (propertiesAreTypes) {
        uri = uri.clone().fragment(fragment.slice(0, -1));
    }
    const ref = Ref.parseURI(uri);
    if (ref.isRoot) {
        propertiesAreTypes = false;
    }

    const schema = (await resolver.resolveTopLevelRef(ref))[0];

    if (propertiesAreTypes) {
        if (typeof schema !== "object") {
            return messageError("SchemaCannotGetTypesFromBoolean", { ref: ref.toString() });
        }
        return mapMap(mapFromObject(schema), (_, name) => ref.push(name));
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

class InputJSONSchemaStore extends JSONSchemaStore {
    constructor(
        private readonly _inputs: Map<string, string>,
        private readonly _delegate?: JSONSchemaStore
    ) {
        super();
    }

    async fetch(address: string): Promise<JSONSchema | undefined> {
        const maybeInput = this._inputs.get(address);
        if (maybeInput !== undefined) {
            return checkJSONSchema(parseJSON(maybeInput, "JSON Schema", address), () => Ref.root(address));
        }
        if (this._delegate === undefined) {
            return panic(`Schema URI ${address} requested, but no store given`);
        }
        return await this._delegate.fetch(address);
    }
}

export interface JSONSchemaSourceData {
    name: string;
    uris?: string[];
    schema?: string;
    isConverted?: boolean;
}

export class JSONSchemaInput implements Input<JSONSchemaSourceData> {
    readonly kind: string = "schema";
    readonly needSchemaProcessing: boolean = true;

    private readonly _attributeProducers: JSONSchemaAttributeProducer[];

    private readonly _schemaInputs: Map<string, string> = new Map();
    private _schemaSources: [URI, JSONSchemaSourceData][] = [];

    private readonly _topLevels: Map<string, Ref> = new Map();

    private _needIR = false;

    constructor(
        private _schemaStore: JSONSchemaStore | undefined,
        additionalAttributeProducers: JSONSchemaAttributeProducer[] = [],
        private readonly _additionalSchemaAddresses: ReadonlyArray<string> = []
    ) {
        this._attributeProducers = [
            descriptionAttributeProducer,
            accessorNamesAttributeProducer,
            enumValuesAttributeProducer,
            uriSchemaAttributesProducer,
            minMaxAttributeProducer,
            minMaxLengthAttributeProducer,
            patternAttributeProducer
        ].concat(additionalAttributeProducers);
    }

    get needIR(): boolean {
        return this._needIR;
    }

    addTopLevel(name: string, ref: Ref): void {
        this._topLevels.set(name, ref);
    }

    async addTypes(ctx: RunContext, typeBuilder: TypeBuilder): Promise<void> {
        if (this._schemaSources.length === 0) return;

        let maybeSchemaStore = this._schemaStore;
        if (this._schemaInputs.size === 0) {
            if (maybeSchemaStore === undefined) {
                return panic("Must have a schema store to process JSON Schema");
            }
        } else {
            maybeSchemaStore = this._schemaStore = new InputJSONSchemaStore(this._schemaInputs, maybeSchemaStore);
        }
        const schemaStore = maybeSchemaStore;
        const canonizer = new Canonizer(ctx);

        for (const address of this._additionalSchemaAddresses) {
            const schema = await schemaStore.get(address, ctx.debugPrintSchemaResolving);
            if (schema === undefined) {
                return messageError("SchemaFetchErrorAdditional", { address });
            }
            canonizer.addSchema(schema, address);
        }

        const resolver = new Resolver(ctx, defined(this._schemaStore), canonizer);

        for (const [normalizedURI, source] of this._schemaSources) {
            const givenName = source.name;

            const refs = await refsInSchemaForURI(resolver, normalizedURI, givenName);
            if (Array.isArray(refs)) {
                let name: string;
                if (this._schemaSources.length === 1 && givenName !== undefined) {
                    name = givenName;
                } else {
                    name = refs[0];
                }
                this.addTopLevel(name, refs[1]);
            } else {
                for (const [refName, ref] of refs) {
                    this.addTopLevel(refName, ref);
                }
            }
        }

        await addTypesInSchema(resolver, typeBuilder, this._topLevels, this._attributeProducers);
    }

    addTypesSync(): void {
        return panic("addTypesSync not supported in JSONSchemaInput");
    }

    async addSource(schemaSource: JSONSchemaSourceData): Promise<void> {
        return this.addSourceSync(schemaSource);
    }

    addSourceSync(schemaSource: JSONSchemaSourceData): void {
        const { name, uris, schema, isConverted } = schemaSource;

        if (isConverted !== true) {
            this._needIR = true;
        }

        let normalizedURIs: URI[];
        if (uris === undefined) {
            normalizedURIs = [new URI(name)];
        } else {
            normalizedURIs = uris.map(uri => {
                const normalizedURI = normalizeURI(uri);
                if (normalizedURI.clone().hash("").toString() === "") {
                    normalizedURI.path(name);
                }
                return normalizedURI;
            });
        }

        if (schema === undefined) {
            assert(uris !== undefined, "URIs must be given if schema source is not specified");
        } else {
            for (let i = 0; i < normalizedURIs.length; i++) {
                const normalizedURI = normalizedURIs[i];
                const uri = normalizedURI.clone().hash("");
                const path = uri.path();
                let suffix = 0;
                do {
                    if (suffix > 0) {
                        uri.path(`${path}-${suffix}`);
                    }
                    suffix++;
                } while (this._schemaInputs.has(uri.toString()));
                this._schemaInputs.set(uri.toString(), schema);
                normalizedURIs[i] = uri.hash(normalizedURI.hash());
            }
        }

        // FIXME: Why do we need both _schemaSources and _schemaInputs?
        for (const normalizedURI of normalizedURIs) {
            this._schemaSources.push([normalizedURI, schemaSource]);
        }
    }

    singleStringSchemaSource(): string | undefined {
        if (!this._schemaSources.every(([_, { schema }]) => typeof schema === "string")) {
            return undefined;
        }
        const set = new Set(this._schemaSources.map(([_, { schema }]) => schema as string));
        if (set.size === 1) {
            return defined(iterableFirst(set));
        }
        return undefined;
    }
}
