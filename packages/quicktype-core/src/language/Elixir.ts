import unicode from "unicode-properties";

import { Sourcelike, modifySource } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { Option, BooleanOption, EnumOption, OptionValues, getOptionValues, StringOption } from "../RendererOptions";

import * as keywords from "./ruby/keywords";

const forbiddenForObjectProperties = Array.from(new Set([...keywords.keywords, ...keywords.reservedProperties]));

import { Type, EnumType, ClassType, UnionType, ArrayType, MapType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";

import {
    legalizeCharacters,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle,
    utf32ConcatMap,
    isPrintable,
    escapeNonPrintableMapper,
    intToHex,
    snakeCase,
    isLetterOrUnderscore
} from "../support/Strings";
import { RenderContext } from "../Renderer";

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

export enum Strictness {
    Strict = "Strict::",
    Coercible = "Coercible::",
    None = "Types::"
}

export const elixirOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    strictness: new EnumOption("strictness", "Type strictness", [
        ["strict", Strictness.Strict],
        ["coercible", Strictness.Coercible],
        ["none", Strictness.None]
    ]),
    namespace: new StringOption("namespace", "Specify a wrapping Namespace", "NAME", "", "secondary")
};

export class ElixirTargetLanguage extends TargetLanguage {
    constructor() {
        super("Elixir", ["elixir"], "ex");
    }

    protected getOptions(): Option<any>[] {
        return [elixirOptions.justTypes, elixirOptions.strictness, elixirOptions.namespace];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get defaultIndentation(): string {
        return "  ";
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): ElixirRenderer {
        return new ElixirRenderer(this, renderContext, getOptionValues(elixirOptions, untypedOptionValues));
    }
}

const isStartCharacter = isLetterOrUnderscore;

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function simpleNameStyle(original: string, uppercase: boolean): string {
    if (/^[0-9]+$/.test(original)) {
        original = original + "N";
    }
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        uppercase ? firstUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function memberNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        allLowerWordStyle,
        "_",
        isStartCharacter
    );
}

export class ElixirRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof elixirOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected get commentLineStart(): string {
        return "# ";
    }

    protected get needsTypeDeclarationBeforeUse(): boolean {
        return true;
    }

    // protected canBeForwardDeclared(t: Type): boolean {
    //     return "class" === t.kind;
    // }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords.globals.concat(["Types", "JSON", "Dry", "Constructor", "Self"]);
    }

    protected forbiddenForObjectProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: forbiddenForObjectProperties, includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", n => simpleNameStyle(n, true), []);
    }

    protected namerForObjectProperty(): Namer {
        return new Namer("properties", memberNameStyle, []);
    }

    protected makeUnionMemberNamer(): Namer {
        return new Namer("properties", memberNameStyle, []);
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", n => simpleNameStyle(n, true), []);
    }

    private dryType(t: Type, isOptional = false): Sourcelike {
        const optional = isOptional ? ".optional" : "";
        return matchType<Sourcelike>(
            t,
            _anyType => ["Types::Any", optional],
            _nullType => ["Types::Nil", optional],
            _boolType => ["Types::Bool", optional],
            _integerType => ["Types::Integer", optional],
            _doubleType => ["Types::Double", optional],
            _stringType => ["Types::String", optional],
            arrayType => ["Types.Array(", this.dryType(arrayType.items), ")", optional],
            classType => [this.nameForNamedType(classType), optional],
            mapType => ["Types::Hash.meta(of: ", this.dryType(mapType.values), ")", optional],
            enumType => ["Types::", this.nameForNamedType(enumType), optional],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return [this.dryType(nullable), ".optional"];
                }
                return ["Types.Instance(", this.nameForNamedType(unionType), ")", optional];
            }
        );
    }

    private exampleUse(t: Type, exp: Sourcelike, depth = 6, optional = false): Sourcelike {
        if (depth-- <= 0) {
            return exp;
        }

        const safeNav = optional ? "&" : "";

        return matchType<Sourcelike>(
            t,
            _anyType => exp,
            _nullType => [exp, ".nil?"],
            _boolType => exp,
            _integerType => [exp, ".even?"],
            _doubleType => exp,
            _stringType => exp,
            arrayType => this.exampleUse(arrayType.items, [exp, safeNav, ".first"], depth),
            classType => {
                let info: { name: Name; prop: ClassProperty } | undefined;
                this.forEachClassProperty(classType, "none", (name, _json, prop) => {
                    if (["class", "map", "array"].indexOf(prop.type.kind) >= 0) {
                        info = { name, prop };
                    } else if (info === undefined) {
                        info = { name, prop };
                    }
                });
                if (info !== undefined) {
                    return this.exampleUse(info.prop.type, [exp, safeNav, ".", info.name], depth, info.prop.isOptional);
                }
                return exp;
            },
            mapType => this.exampleUse(mapType.values, [exp, safeNav, `["…"]`], depth),
            enumType => {
                let name: Name | undefined;
                // FIXME: This is a terrible way to get the first enum case name.
                this.forEachEnumCase(enumType, "none", theName => {
                    if (name === undefined) {
                        name = theName;
                    }
                });
                if (name !== undefined) {
                    return [exp, " == ", this.nameForNamedType(enumType), "::", name];
                }
                return exp;
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (["class", "map", "array"].indexOf(nullable.kind) >= 0) {
                        return this.exampleUse(nullable, exp, depth, true);
                    }
                    return [exp, ".nil?"];
                }
                return exp;
            }
        );
    }

    private jsonSample(t: Type): Sourcelike {
        function inner() {
            if (t instanceof ArrayType) {
                return "[…]";
            } else if (t instanceof MapType) {
                return "{…}";
            } else if (t instanceof ClassType) {
                return "{…}";
            } else {
                return "…";
            }
        }
        return `"${inner()}"`;
    }

    private fromDynamic(t: Type, e: Sourcelike, optional = false, castPrimitives = false): Sourcelike {
        const primitiveCast = [this.dryType(t, optional), "[", e, "]"];
        const primitive = castPrimitives ? primitiveCast : e;
        const safeAccess = optional ? "&" : "";
        return matchType<Sourcelike>(
            t,
            _anyType => primitive,
            _nullType => primitive,
            _boolType => primitive,
            _integerType => primitive,
            _doubleType => primitive,
            _stringType => primitive,
            arrayType => [e, safeAccess, ".map { |x| ", this.fromDynamic(arrayType.items, "x", false, true), " }"],
            classType => {
                const expression = [this.nameForNamedType(classType), ".from_dynamic!(", e, ")"];
                return optional ? [e, " ? ", expression, " : nil"] : expression;
            },
            mapType => [
                ["Types::Hash", optional ? ".optional" : "", "[", e, "]"],
                safeAccess,
                ".map { |k, v| [k, ",
                this.fromDynamic(mapType.values, "v", false, true),
                "] }",
                safeAccess,
                ".to_h"
            ],
            enumType => {
                const expression = ["Types::", this.nameForNamedType(enumType), "[", e, "]"];
                return optional ? [e, ".nil? ? nil : ", expression] : expression;
            },
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.fromDynamic(nullable, e, true);
                }
                const expression = [this.nameForNamedType(unionType), ".from_dynamic!(", e, ")"];
                return optional ? [e, " ? ", expression, " : nil"] : expression;
            }
        );
    }

    private toDynamic(t: Type, e: Sourcelike, optional = false): Sourcelike {
        if (this.marshalsImplicitlyToDynamic(t)) {
            return e;
        }
        return matchType<Sourcelike>(
            t,
            _anyType => e,
            _nullType => e,
            _boolType => e,
            _integerType => e,
            _doubleType => e,
            _stringType => e,
            arrayType => [e, optional ? "&" : "", ".map { |x| ", this.toDynamic(arrayType.items, "x"), " }"],
            _classType => [e, optional ? "&" : "", ".to_dynamic"],
            mapType => [e, optional ? "&" : "", ".map { |k, v| [k, ", this.toDynamic(mapType.values, "v"), "] }.to_h"],
            _enumType => e,
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.toDynamic(nullable, e, true);
                }
                if (this.marshalsImplicitlyToDynamic(unionType)) {
                    return e;
                }
                return [e, optional ? "&" : "", ".to_dynamic"];
            }
        );
    }

    private marshalsImplicitlyToDynamic(t: Type): boolean {
        return matchType<boolean>(
            t,
            _anyType => true,
            _nullType => true,
            _boolType => true,
            _integerType => true,
            _doubleType => true,
            _stringType => true,
            arrayType => this.marshalsImplicitlyToDynamic(arrayType.items),
            _classType => false,
            mapType => this.marshalsImplicitlyToDynamic(mapType.values),
            _enumType => true,
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.marshalsImplicitlyToDynamic(nullable);
                }
                return false;
            }
        );
    }

    // This is only to be used to allow class properties to possibly
    // marshal implicitly. They are allowed to do this because they will
    // be checked in Dry::Struct.new
    private propertyTypeMarshalsImplicitlyFromDynamic(t: Type): boolean {
        return matchType<boolean>(
            t,
            _anyType => true,
            _nullType => true,
            _boolType => true,
            _integerType => true,
            _doubleType => true,
            _stringType => true,
            arrayType => this.propertyTypeMarshalsImplicitlyFromDynamic(arrayType.items),
            _classType => false,
            // Map properties must be checked because Dry:Types doesn't have a generic Map
            _mapType => false,
            _enumType => true,
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    return this.propertyTypeMarshalsImplicitlyFromDynamic(nullable);
                }
                return false;
            }
        );
    }

    private emitBlock(source: Sourcelike, emit: () => void) {
        this.emitLine(source);
        this.indent(emit);
        this.emitLine("end");
    }

    private emitModule2(emit: () => void) {
        const emitModuleInner = (moduleName: string) => {
            const [firstModule, ...subModules] = moduleName.split("::");
            if (subModules.length > 0) {
                this.emitBlock(["module ", firstModule], () => {
                    emitModuleInner(subModules.join("::"));
                });
            } else {
                this.emitBlock(["module ", moduleName], emit);
            }
        };
        if (this._options.namespace !== undefined && this._options.namespace !== "") {
            emitModuleInner(this._options.namespace);
        } else {
            emit();
        }
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, {
            firstLineStart: '@moduledoc """\n',
            lineStart: "",
            afterComment: '"""'
        });
    }

    private emitModule(c: ClassType, moduleName: Name) {
        this.emitBlock(["defmodule ", moduleName, " do"], () => {
            const structDescription = this.descriptionForType(c) ?? [];
            const attributeDescriptions: Sourcelike[][] = [];

            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const attributeDescription = this.descriptionForClassProperty(c, jsonName);
                if (attributeDescription) {
                    attributeDescriptions.push(["- `:", name, "` - ", attributeDescription]);
                }
            });
            if (structDescription.length || attributeDescriptions.length) {
                this.emitDescription([...structDescription, ...attributeDescriptions]);
                this.ensureBlankLine();
            }

            let table: Sourcelike[][] = [];
            let count = c.getProperties().size;

            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const last = --count === 0;
                const description = this.descriptionForClassProperty(c, jsonName);
                const attribute = [
                    ["attribute :", name, ","],
                    [" ", this.dryType(p.type), p.isOptional ? ".optional" : ""]
                ];
                table.push(attribute);
            });
            if (table.length > 0) {
                this.emitTable(table);
            }

            if (this._options.justTypes) {
                return;
            }

            this.ensureBlankLine();
            this.emitBlock(["def self.from_dynamic!(d)"], () => {
                this.emitLine("d = Types::Hash[d]");
                this.emitLine("new(");
                this.indent(() => {
                    const inits: Sourcelike[][] = [];
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const dynamic = p.isOptional
                            ? // If key is not found in hash, this will be nil
                              `d["${stringEscape(jsonName)}"]`
                            : // This will raise a runtime error if the key is not found in the hash
                              `d.fetch("${stringEscape(jsonName)}")`;

                        if (this.propertyTypeMarshalsImplicitlyFromDynamic(p.type)) {
                            inits.push([
                                [name, ": "],
                                [dynamic, ","]
                            ]);
                        } else {
                            const expression = this.fromDynamic(p.type, dynamic, p.isOptional);
                            inits.push([
                                [name, ": "],
                                [expression, ","]
                            ]);
                        }
                    });
                    this.emitTable(inits);
                });
                this.emitLine(")");
            });

            this.ensureBlankLine();
            this.emitBlock("def self.from_json!(json)", () => {
                this.emitLine("from_dynamic!(JSON.parse(json))");
            });

            this.ensureBlankLine();
            this.emitBlock(["def to_dynamic"], () => {
                this.emitLine("{");
                this.indent(() => {
                    const inits: Sourcelike[][] = [];
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const expression = this.toDynamic(p.type, name, p.isOptional);
                        inits.push([[`"${stringEscape(jsonName)}"`], [" => ", expression, ","]]);
                    });
                    this.emitTable(inits);
                });
                this.emitLine("}");
            });
            this.ensureBlankLine();
            this.emitBlock("def to_json(options = nil)", () => {
                this.emitLine("JSON.generate(to_dynamic, options)");
            });
        });
    }

    private emitEnum(e: EnumType, enumName: Name) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["module ", enumName], () => {
            const table: Sourcelike[][] = [];
            this.forEachEnumCase(e, "none", (name, json) => {
                table.push([[name], [` = "${stringEscape(json)}"`]]);
            });
            this.emitTable(table);
        });
    }

    private emitUnion(u: UnionType, unionName: Name) {
        this.emitDescription(this.descriptionForType(u));
        this.emitBlock(["class ", unionName, " < Dry::Struct"], () => {
            const table: Sourcelike[][] = [];
            this.forEachUnionMember(u, u.getChildren(), "none", null, (name, t) => {
                table.push([["attribute :", name, ", "], [this.dryType(t, true)]]);
            });
            this.emitTable(table);

            if (this._options.justTypes) {
                return;
            }

            this.ensureBlankLine();
            const [maybeNull, nonNulls] = removeNullFromUnion(u, false);
            this.emitBlock("def self.from_dynamic!(d)", () => {
                const memberNames = Array.from(u.getChildren()).map(member => this.nameForUnionMember(u, member));
                this.forEachUnionMember(u, u.getChildren(), "none", null, (name, t) => {
                    const nilMembers = memberNames
                        .filter(n => n !== name)
                        .map(memberName => [", ", memberName, ": nil"]);
                    if (this.propertyTypeMarshalsImplicitlyFromDynamic(t)) {
                        this.emitBlock(["if schema[:", name, "].right.valid? d"], () => {
                            this.emitLine("return new(", name, ": d", nilMembers, ")");
                        });
                    } else {
                        this.emitLine("begin");
                        this.indent(() => {
                            this.emitLine("value = ", this.fromDynamic(t, "d"));
                            this.emitBlock(["if schema[:", name, "].right.valid? value"], () => {
                                this.emitLine("return new(", name, ": value", nilMembers, ")");
                            });
                        });
                        this.emitLine("rescue");
                        this.emitLine("end");
                    }
                });
                this.emitLine(`raise "Invalid union"`);
            });

            this.ensureBlankLine();
            this.emitBlock("def self.from_json!(json)", () => {
                this.emitLine("from_dynamic!(JSON.parse(json))");
            });

            this.ensureBlankLine();
            this.emitBlock("def to_dynamic", () => {
                let first = true;
                this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                    this.emitLine(first ? "if" : "elsif", " ", name, " != nil");
                    this.indent(() => {
                        this.emitLine(this.toDynamic(t, name));
                    });
                    first = false;
                });
                if (maybeNull !== null) {
                    this.emitLine("else");
                    this.indent(() => {
                        this.emitLine("nil");
                    });
                }
                this.emitLine("end");
            });

            this.ensureBlankLine();
            this.emitBlock("def to_json(options = nil)", () => {
                this.emitLine("JSON.generate(to_dynamic, options)");
            });
        });
    }

    private emitTypesModule() {
        this.emitBlock(["module Types"], () => {
            this.emitLine("include Dry.Types(default: :nominal)");

            const declarations: Sourcelike[][] = [];

            if (this._options.strictness !== Strictness.None) {
                let has = { int: false, nil: false, bool: false, hash: false, string: false, double: false };
                this.forEachType(t => {
                    has = {
                        int: has.int || t.kind === "integer",
                        nil: has.nil || t.kind === "null",
                        bool: has.bool || t.kind === "bool",
                        hash: has.hash || t.kind === "map" || t.kind === "class",
                        string: has.string || t.kind === "string" || t.kind === "enum",
                        double: has.double || t.kind === "double"
                    };
                });
                if (has.int) declarations.push([["Integer"], [` = ${this._options.strictness}Integer`]]);
                if (this._options.strictness === Strictness.Strict) {
                    if (has.nil) declarations.push([["Nil"], [` = ${this._options.strictness}Nil`]]);
                }
                if (has.bool) declarations.push([["Bool"], [` = ${this._options.strictness}Bool`]]);
                if (has.hash) declarations.push([["Hash"], [` = ${this._options.strictness}Hash`]]);
                if (has.string) declarations.push([["String"], [` = ${this._options.strictness}String`]]);
                if (has.double)
                    declarations.push([
                        ["Double"],
                        [` = ${this._options.strictness}Float | ${this._options.strictness}Integer`]
                    ]);
            }

            this.forEachEnum("none", (enumType, enumName) => {
                const cases: Sourcelike[][] = [];
                this.forEachEnumCase(enumType, "none", (_name, json) => {
                    cases.push([cases.length === 0 ? "" : ", ", `"${stringEscape(json)}"`]);
                });
                declarations.push([[enumName], [" = ", this._options.strictness, "String.enum(", ...cases, ")"]]);
            });

            if (declarations.length > 0) {
                this.ensureBlankLine();
                this.emitTable(declarations);
            }
        });
    }

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitLine("# TODO: Add comments");
        }
        this.ensureBlankLine();

        this.ensureBlankLine();

        // this.emitModule2(() => {
        // this.emitTypesModule();

        // this.forEachDeclaration("leading-and-interposing", decl => {
        //     if (decl.kind === "forward") {
        //         this.emitCommentLines(["(forward declaration)"]);
        //         this.emitModule2(() => {
        //             this.emitLine("class ", this.nameForNamedType(decl.type), " < Dry::Struct; end");
        //         });
        //     }
        // });

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, n: Name) => this.emitModule(c, n),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
        );

        // if (!this._options.justTypes) {
        //     this.forEachTopLevel(
        //         "leading-and-interposing",
        //         (topLevel, name) => {
        //             const self = modifySource(snakeCase, name);

        //             // The json gem defines to_json on maps and primitives, so we only need to supply
        //             // it for arrays.
        //             const needsToJsonDefined = "array" === topLevel.kind;

        //             const classDeclaration = () => {
        //                 this.emitBlock(["class ", name], () => {
        //                     this.emitBlock(["def self.from_json!(json)"], () => {
        //                         if (needsToJsonDefined) {
        //                             this.emitLine(
        //                                 self,
        //                                 " = ",
        //                                 this.fromDynamic(topLevel, "JSON.parse(json, quirks_mode: true)")
        //                             );
        //                             this.emitBlock([self, ".define_singleton_method(:to_json) do"], () => {
        //                                 this.emitLine("JSON.generate(", this.toDynamic(topLevel, "self"), ")");
        //                             });
        //                             this.emitLine(self);
        //                         } else {
        //                             this.emitLine(
        //                                 this.fromDynamic(topLevel, "JSON.parse(json, quirks_mode: true)")
        //                             );
        //                         }
        //                     });
        //                 });
        //             };

        //             this.emitModule2(() => {
        //                 classDeclaration();
        //             });
        //         },
        //         t => this.namedTypeToNameForTopLevel(t) === undefined
        //     );
        // }
        // });
    }
}
