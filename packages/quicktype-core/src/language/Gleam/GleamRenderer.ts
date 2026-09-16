import {
    ConvenienceRenderer,
    type ForbiddenWordsInfo,
} from "../../ConvenienceRenderer.js";
import { DependencyName, type Name, type Namer } from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
} from "../../Type/TypeUtils.js";
import {
    ClassType,
    type EnumType,
    type Type,
    UnionType,
} from "../../Type/index.js";

import {
    forbiddenModuleNames,
    jsonValueNames,
    keywords,
    preludeNames,
} from "./constants.js";
import {
    type Doc,
    MAX_WIDTH,
    call,
    flat,
    hugCall,
    isCollection,
    lambda,
    list,
    render,
    seq,
    text,
    tuple,
} from "./pretty.js";
import {
    gleamStringEscape,
    pascalNamingFunction,
    snakeNamingFunction,
} from "./utils.js";

interface NamedTypeFunctions {
    decoder: DependencyName;
    encoder: DependencyName;
}

export class GleamRenderer extends ConvenienceRenderer {
    private readonly _namedTypeFunctions = new Map<Name, NamedTypeFunctions>();

    private readonly _topLevelFunctions = new Map<Name, NamedTypeFunctions>();

    private _needsJsonValue = false;

    private _needsOption = false;

    private _needsDict = false;

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
    ) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return pascalNamingFunction;
    }

    protected namerForObjectProperty(): Namer | null {
        return snakeNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer | null {
        return pascalNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer | null {
        return pascalNamingFunction;
    }

    // Gleam constructors and enum cases all share one module-level value
    // namespace, so they must be globally unique.
    protected get unionMembersInGlobalNamespace(): boolean {
        return true;
    }

    protected get enumCasesInGlobalNamespace(): boolean {
        return true;
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        return [
            ...keywords,
            ...forbiddenModuleNames,
            ...jsonValueNames,
            ...preludeNames,
        ];
    }

    protected forbiddenForObjectProperties(
        _c: ClassType,
        _className: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(
        _u: UnionType,
        _unionName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(
        _e: EnumType,
        _enumName: Name,
    ): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    // Prefix union constructors with the union name so they read well and stay
    // globally unique (e.g. `FooString`, `FooInteger`).
    protected proposeUnionMemberName(
        u: UnionType,
        unionName: Name,
        fieldType: Type,
        lookup: (n: Name) => string,
    ): string {
        const fieldName = super.proposeUnionMemberName(
            u,
            unionName,
            fieldType,
            lookup,
        );
        return `${lookup(unionName)}_${fieldName}`;
    }

    protected makeNamedTypeDependencyNames(
        _t: Type,
        typeName: Name,
    ): DependencyName[] {
        const functions = this.makeConversionNames(typeName);
        this._namedTypeFunctions.set(typeName, functions);
        return [functions.encoder, functions.decoder];
    }

    protected makeTopLevelDependencyNames(
        t: Type,
        topLevelName: Name,
    ): DependencyName[] {
        // Named-type top-levels already have conversion functions from their
        // named-type dependency names; only aliases need their own.
        if (this.namedTypeToNameForTopLevel(t) !== undefined) {
            return [];
        }

        const functions = this.makeConversionNames(topLevelName);
        this._topLevelFunctions.set(topLevelName, functions);
        return [functions.encoder, functions.decoder];
    }

    private makeConversionNames(typeName: Name): NamedTypeFunctions {
        const encoder = new DependencyName(
            snakeNamingFunction,
            typeName.order,
            (lookup) => `${lookup(typeName)}_to_json`,
        );
        const decoder = new DependencyName(
            snakeNamingFunction,
            typeName.order,
            (lookup) => `${lookup(typeName)}_decoder`,
        );
        return { encoder, decoder };
    }

    protected get commentLineStart(): string {
        return "// ";
    }

    private nameToString(name: Name): string {
        return this.sourcelikeToString(name);
    }

    private encoderName(t: Type): string {
        const name = this.nameForNamedType(t);
        const functions = this._namedTypeFunctions.get(name);
        if (functions === undefined) {
            throw new Error(`No conversion functions for type ${name}`);
        }

        return this.nameToString(functions.encoder);
    }

    // Manual, absolute-column line emission. The renderer keeps its own
    // indentation at zero and bakes indentation into the emitted text so that
    // the pretty-printer's byte-exact layout survives to the output.
    private line(indent: number, content = ""): void {
        if (content === "") {
            this.emitLine();
            return;
        }

        this.emitLine(" ".repeat(indent), content);
    }

    private emitDoc(indent: number, doc: Doc): void {
        const rendered = render(doc, indent, indent);
        const full = `${" ".repeat(indent)}${rendered.text}`;
        for (const physicalLine of full.split("\n")) {
            this.emitLine(physicalLine);
        }
    }

    // Emit `lhs <op> rhs`, reproducing how `gleam format` lays out `let` and
    // case-arm right-hand sides: keep a collection literal attached to the
    // operator, but push any other over-long expression to the next line.
    private emitBinding(
        indent: number,
        lhs: string,
        op: string,
        rhs: Doc,
    ): void {
        // A binding moves an over-long right-hand side to the next line (or
        // hugs a collection literal); breaking there does not free a trailing
        // lambda's `}`, so no trailing slack applies to the fit decision.
        const prefix = `${lhs} ${op} `;
        const flatLine = `${prefix}${flat(rhs)}`;
        if (indent + flatLine.length <= MAX_WIDTH) {
            this.line(indent, flatLine);
            return;
        }

        if (isCollection(rhs)) {
            const rendered = render(rhs, indent, indent + prefix.length);
            const full = `${" ".repeat(indent)}${prefix}${rendered.text}`;
            for (const physicalLine of full.split("\n")) {
                this.emitLine(physicalLine);
            }

            return;
        }

        this.line(indent, `${lhs} ${op}`);
        this.emitDoc(indent + 2, rhs);
    }

    private typeDoc(t: Type): Doc {
        return matchType<Doc>(
            t,
            (_anyType) => text("JsonValue"),
            (_nullType) => text("Nil"),
            (_boolType) => text("Bool"),
            (_integerType) => text("Int"),
            (_doubleType) => text("Float"),
            (_stringType) => text("String"),
            (arrayType) => call("List", [this.typeDoc(arrayType.items)]),
            (classType) =>
                text(this.nameToString(this.nameForNamedType(classType))),
            (mapType) =>
                call("dict.Dict", [
                    text("String"),
                    this.typeDoc(mapType.values),
                ]),
            (enumType) =>
                text(this.nameToString(this.nameForNamedType(enumType))),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return call("option.Option", [this.typeDoc(nullable)]);
                }

                const [hasNull] = removeNullFromUnion(unionType);
                const name = text(
                    this.nameToString(this.nameForNamedType(unionType)),
                );
                return hasNull !== null ? call("option.Option", [name]) : name;
            },
        );
    }

    private encodeDoc(t: Type, value: Doc): Doc {
        return matchType<Doc>(
            t,
            (_anyType) => call("json_value_to_json", [value]),
            (_nullType) => text("json.null()"),
            (_boolType) => call("json.bool", [value]),
            (_integerType) => call("json.int", [value]),
            (_doubleType) => call("json.float", [value]),
            (_stringType) => call("json.string", [value]),
            (arrayType) =>
                call("json.array", [value, this.encoderFn(arrayType.items)]),
            (classType) => call(this.encoderName(classType), [value]),
            (mapType) =>
                call("json.dict", [
                    value,
                    lambda("key", text("key")),
                    this.encoderFn(mapType.values),
                ]),
            (enumType) => call(this.encoderName(enumType), [value]),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return call("json.nullable", [
                        value,
                        this.encoderFn(nullable),
                    ]);
                }

                const [hasNull] = removeNullFromUnion(unionType);
                if (hasNull !== null) {
                    return call("json.nullable", [
                        value,
                        text(this.encoderName(unionType)),
                    ]);
                }

                return call(this.encoderName(unionType), [value]);
            },
        );
    }

    // A `fn(a) -> json.Json` value that encodes a `t`.
    private encoderFn(t: Type): Doc {
        return matchType<Doc>(
            t,
            (_anyType) => text("json_value_to_json"),
            (_nullType) => lambda("_", text("json.null()")),
            (_boolType) => text("json.bool"),
            (_integerType) => text("json.int"),
            (_doubleType) => text("json.float"),
            (_stringType) => text("json.string"),
            (arrayType) =>
                lambda(
                    "value",
                    call("json.array", [
                        text("value"),
                        this.encoderFn(arrayType.items),
                    ]),
                ),
            (classType) => text(this.encoderName(classType)),
            (mapType) =>
                lambda(
                    "value",
                    call("json.dict", [
                        text("value"),
                        lambda("key", text("key")),
                        this.encoderFn(mapType.values),
                    ]),
                ),
            (enumType) => text(this.encoderName(enumType)),
            (unionType) => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return lambda(
                        "value",
                        call("json.nullable", [
                            text("value"),
                            this.encoderFn(nullable),
                        ]),
                    );
                }

                const [hasNull] = removeNullFromUnion(unionType);
                if (hasNull !== null) {
                    return lambda(
                        "value",
                        call("json.nullable", [
                            text("value"),
                            text(this.encoderName(unionType)),
                        ]),
                    );
                }

                return text(this.encoderName(unionType));
            },
        );
    }

    // Whether a class property is represented as `option.Option(_)` in Gleam.
    // Both absent (optional) and null (nullable) properties collapse to
    // `Option`.
    private isGleamOptional(t: Type, isOptional: boolean): boolean {
        if (t instanceof UnionType) {
            if (nullableFromUnion(t) !== null) {
                return true;
            }

            const [hasNull] = removeNullFromUnion(t);
            if (hasNull !== null) {
                return true;
            }
        }

        return isOptional;
    }

    // The non-null Gleam type wrapped inside a property's `Option(_)`.
    private innerTypeDoc(t: Type): Doc {
        if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) {
                return this.typeDoc(nullable);
            }

            return text(this.nameToString(this.nameForNamedType(t)));
        }

        return this.typeDoc(t);
    }

    // Encode the non-null representation of `t` (the value already unwrapped
    // from its `Option`).
    private encodeInner(t: Type, value: Doc): Doc {
        if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) {
                return this.encodeDoc(nullable, value);
            }

            return call(this.encoderName(t), [value]);
        }

        return this.encodeDoc(t, value);
    }

    private emitClassType(c: ClassType, className: Name): void {
        const name = this.nameToString(className);
        if (c.getProperties().size === 0) {
            this.line(0, `pub type ${name} {`);
            this.line(2, name);
            this.line(0, "}");
            return;
        }

        const fields: Doc[] = [];
        this.forEachClassProperty(c, "none", (fieldName, _jsonName, p) => {
            const fieldType = this.isGleamOptional(p.type, p.isOptional)
                ? call("option.Option", [this.innerTypeDoc(p.type)])
                : this.typeDoc(p.type);
            fields.push(
                seq(text(`${this.nameToString(fieldName)}: `), fieldType),
            );
        });

        this.line(0, `pub type ${name} {`);
        this.emitDoc(2, call(name, fields));
        this.line(0, "}");
    }

    private emitEnumType(e: EnumType, enumName: Name): void {
        this.line(0, `pub type ${this.nameToString(enumName)} {`);
        this.forEachEnumCase(e, "none", (caseName) => {
            this.line(2, this.nameToString(caseName));
        });
        this.line(0, "}");
    }

    private emitUnionType(u: UnionType, unionName: Name): void {
        const [, nonNulls] = removeNullFromUnion(u);
        this.line(0, `pub type ${this.nameToString(unionName)} {`);
        this.forEachUnionMember(u, nonNulls, "none", null, (memberName, t) => {
            this.emitDoc(
                2,
                call(this.nameToString(memberName), [this.typeDoc(t)]),
            );
        });
        this.line(0, "}");
    }

    private emitTopLevelAlias(t: Type, name: Name): void {
        // `gleam format` always places an aliased type on its own line.
        this.line(0, `pub type ${this.nameToString(name)} =`);
        this.emitDoc(2, this.typeDoc(t));
    }

    // Emit a `pub fn name(value: Type) -> Return {` header, breaking the
    // parameter list onto its own line when the one-line form exceeds the
    // 80-column limit, exactly as `gleam format` does.
    private emitFnHeader(
        fnName: string,
        paramType: string,
        returnType: string,
    ): void {
        // `gleam format` measures the signature width without the trailing
        // ` {` block opener.
        const signature = `pub fn ${fnName}(value: ${paramType}) -> ${returnType}`;
        if (signature.length <= MAX_WIDTH) {
            this.line(0, `${signature} {`);
            return;
        }

        this.line(0, `pub fn ${fnName}(`);
        this.line(2, `value: ${paramType},`);
        this.line(0, `) -> ${returnType} {`);
    }

    private entryDoc(jsonName: string, value: Doc): Doc {
        return tuple([text(`"${gleamStringEscape(jsonName)}"`), value]);
    }

    private emitClassEncoder(c: ClassType, className: Name): void {
        const typeName = this.nameToString(className);
        const encoder = this.encoderName(c);

        const required: Doc[] = [];
        const optional: Array<{ jsonName: string; name: Name; type: Type }> =
            [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            if (this.isGleamOptional(p.type, p.isOptional)) {
                optional.push({ jsonName, name, type: p.type });
            } else {
                required.push(
                    this.entryDoc(
                        jsonName,
                        this.encodeDoc(
                            p.type,
                            text(`value.${this.nameToString(name)}`),
                        ),
                    ),
                );
            }
        });

        this.emitFnHeader(encoder, typeName, "json.Json");
        if (optional.length === 0) {
            this.emitDoc(2, hugCall("json.object", list(required)));
        } else {
            this.emitBinding(2, "let fields", "=", list(required));
            for (const { jsonName, name, type } of optional) {
                this.line(
                    2,
                    `let fields = case value.${this.nameToString(name)} {`,
                );
                this.emitBinding(
                    4,
                    "option.Some(inner)",
                    "->",
                    list(
                        [
                            this.entryDoc(
                                jsonName,
                                this.encodeInner(type, text("inner")),
                            ),
                        ],
                        text("fields"),
                    ),
                );
                this.line(4, "option.None -> fields");
                this.line(2, "}");
            }

            this.emitDoc(2, call("json.object", [text("fields")]));
        }

        this.line(0, "}");
    }

    private emitEnumEncoder(e: EnumType, enumName: Name): void {
        const typeName = this.nameToString(enumName);
        const encoder = this.encoderName(e);
        this.emitFnHeader(encoder, typeName, "json.Json");
        this.line(2, "case value {");
        this.forEachEnumCase(e, "none", (caseName, jsonName) => {
            this.emitBinding(
                4,
                this.nameToString(caseName),
                "->",
                call("json.string", [text(`"${gleamStringEscape(jsonName)}"`)]),
            );
        });
        this.line(2, "}");
        this.line(0, "}");
    }

    private emitUnionEncoder(u: UnionType, unionName: Name): void {
        const typeName = this.nameToString(unionName);
        const encoder = this.encoderName(u);
        const [, nonNulls] = removeNullFromUnion(u);
        this.emitFnHeader(encoder, typeName, "json.Json");
        this.line(2, "case value {");
        this.forEachUnionMember(u, nonNulls, "none", null, (memberName, t) => {
            this.emitBinding(
                4,
                `${this.nameToString(memberName)}(inner)`,
                "->",
                this.encodeDoc(t, text("inner")),
            );
        });
        this.line(2, "}");
        this.line(0, "}");
    }

    private emitTopLevelEncoder(t: Type, name: Name): void {
        const functions = this._topLevelFunctions.get(name);
        if (functions === undefined) {
            return;
        }

        const typeName = this.nameToString(name);
        const encoder = this.nameToString(functions.encoder);
        this.emitFnHeader(encoder, typeName, "json.Json");
        this.emitDoc(2, this.encodeDoc(t, text("value")));
        this.line(0, "}");
    }

    private emitJsonValueType(): void {
        this.line(0, "pub type JsonValue {");
        this.line(2, "JsonNull");
        this.line(2, "JsonBool(Bool)");
        this.line(2, "JsonInt(Int)");
        this.line(2, "JsonFloat(Float)");
        this.line(2, "JsonString(String)");
        this.line(2, "JsonArray(List(JsonValue))");
        this.line(2, "JsonObject(dict.Dict(String, JsonValue))");
        this.line(0, "}");
    }

    private emitJsonValueEncoder(): void {
        this.emitFnHeader("json_value_to_json", "JsonValue", "json.Json");
        this.line(2, "case value {");
        this.line(4, "JsonNull -> json.null()");
        this.line(4, "JsonBool(inner) -> json.bool(inner)");
        this.line(4, "JsonInt(inner) -> json.int(inner)");
        this.line(4, "JsonFloat(inner) -> json.float(inner)");
        this.line(4, "JsonString(inner) -> json.string(inner)");
        this.line(
            4,
            "JsonArray(inner) -> json.array(inner, json_value_to_json)",
        );
        this.emitDoc(
            4,
            seq(
                text("JsonObject(inner) -> "),
                call("json.dict", [
                    text("inner"),
                    lambda("key", text("key")),
                    text("json_value_to_json"),
                ]),
            ),
        );
        this.line(2, "}");
        this.line(0, "}");
    }

    private computeNeeds(): void {
        for (const t of this.typeGraph.allTypesUnordered()) {
            if (t.kind === "any") {
                this._needsJsonValue = true;
            }

            if (t instanceof ClassType) {
                for (const [, p] of t.getProperties()) {
                    if (this.isGleamOptional(p.type, p.isOptional)) {
                        this._needsOption = true;
                    }
                }
            }

            if (t instanceof UnionType) {
                if (nullableFromUnion(t) !== null) {
                    this._needsOption = true;
                } else {
                    const [hasNull] = removeNullFromUnion(t);
                    if (hasNull !== null) {
                        this._needsOption = true;
                    }
                }
            }

            if (t.kind === "map") {
                this._needsDict = true;
            }
        }

        // The `JsonObject` variant of `JsonValue` carries a `Dict`.
        if (this._needsJsonValue) {
            this._needsDict = true;
        }
    }

    protected emitSourceStructure(): void {
        this.computeNeeds();

        this.line(0, "// Generated by quicktype");
        this.line(0, "//");
        this.line(
            0,
            "// Optional and nullable properties both map to `option.Option`,",
        );
        this.line(
            0,
            '// so `{"a": null}` and `{}` are indistinguishable after decoding.',
        );
        this.line(0);

        // Imports must be sorted for `gleam format`.
        if (this._needsDict) {
            this.line(0, "import gleam/dict");
        }

        this.line(0, "import gleam/json");
        if (this._needsOption) {
            this.line(0, "import gleam/option");
        }

        if (this._needsJsonValue) {
            this.line(0);
            this.emitJsonValueType();
        }

        this.forEachObject("none", (c: ClassType, name) => {
            this.line(0);
            this.emitClassType(c, name);
        });
        this.forEachEnum("none", (e, name) => {
            this.line(0);
            this.emitEnumType(e, name);
        });
        this.forEachUnion("none", (u, name) => {
            this.line(0);
            this.emitUnionType(u, name);
        });
        this.forEachTopLevel(
            "none",
            (t, name) => {
                this.line(0);
                this.emitTopLevelAlias(t, name);
            },
            (t) => this.namedTypeToNameForTopLevel(t) === undefined,
        );

        if (this._needsJsonValue) {
            this.line(0);
            this.emitJsonValueEncoder();
        }

        this.forEachObject("none", (c: ClassType, name) => {
            this.line(0);
            this.emitClassEncoder(c, name);
        });
        this.forEachEnum("none", (e, name) => {
            this.line(0);
            this.emitEnumEncoder(e, name);
        });
        this.forEachUnion("none", (u, name) => {
            this.line(0);
            this.emitUnionEncoder(u, name);
        });
        this.forEachTopLevel(
            "none",
            (t, name) => {
                this.line(0);
                this.emitTopLevelEncoder(t, name);
            },
            (t) => this.namedTypeToNameForTopLevel(t) === undefined,
        );
    }
}
