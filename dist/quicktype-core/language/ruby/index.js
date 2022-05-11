"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const unicode = require("@mark.probst/unicode-properties");
const Source_1 = require("../../Source");
const Naming_1 = require("../../Naming");
const ConvenienceRenderer_1 = require("../../ConvenienceRenderer");
const TargetLanguage_1 = require("../../TargetLanguage");
const RendererOptions_1 = require("../../RendererOptions");
const keywords = require("./keywords");
const Type_1 = require("../../Type");
const TypeUtils_1 = require("../../TypeUtils");
const Strings_1 = require("../../support/Strings");
function unicodeEscape(codePoint) {
    return "\\u{" + Strings_1.intToHex(codePoint, 0) + "}";
}
const stringEscape = Strings_1.utf32ConcatMap(Strings_1.escapeNonPrintableMapper(Strings_1.isPrintable, unicodeEscape));
var Strictness;
(function (Strictness) {
    Strictness["Strict"] = "Strict::";
    Strictness["Coercible"] = "Coercible::";
    Strictness["None"] = "Types::";
})(Strictness = exports.Strictness || (exports.Strictness = {}));
exports.rubyOptions = {
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    strictness: new RendererOptions_1.EnumOption("strictness", "Type strictness", [
        ["strict", Strictness.Strict],
        ["coercible", Strictness.Coercible],
        ["none", Strictness.None]
    ])
};
class RubyTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Ruby", ["ruby"], "rb");
    }
    getOptions() {
        return [exports.rubyOptions.justTypes, exports.rubyOptions.strictness];
    }
    get supportsOptionalClassProperties() {
        return true;
    }
    get defaultIndentation() {
        return "  ";
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new RubyRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.rubyOptions, untypedOptionValues));
    }
}
exports.RubyTargetLanguage = RubyTargetLanguage;
function isStartCharacter(utf16Unit) {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}
function isPartCharacter(utf16Unit) {
    const category = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}
const legalizeName = Strings_1.legalizeCharacters(isPartCharacter);
function simpleNameStyle(original, uppercase) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, uppercase ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, uppercase ? Strings_1.firstUpperWordStyle : Strings_1.allLowerWordStyle, Strings_1.allUpperWordStyle, Strings_1.allUpperWordStyle, "", isStartCharacter);
}
function memberNameStyle(original) {
    const words = Strings_1.splitIntoWords(original);
    return Strings_1.combineWords(words, legalizeName, Strings_1.allLowerWordStyle, Strings_1.allLowerWordStyle, Strings_1.allLowerWordStyle, Strings_1.allLowerWordStyle, "_", isStartCharacter);
}
class RubyRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
    }
    get commentLineStart() {
        return "# ";
    }
    get needsTypeDeclarationBeforeUse() {
        return true;
    }
    canBeForwardDeclared(t) {
        return "class" === t.kind;
    }
    forbiddenNamesForGlobalNamespace() {
        return keywords.globals.concat(["Types", "JSON", "Dry", "Constructor"]);
    }
    forbiddenForObjectProperties(_c, _classNamed) {
        return { names: keywords.reservedProperties, includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return new Naming_1.Namer("types", n => simpleNameStyle(n, true), []);
    }
    namerForObjectProperty() {
        return new Naming_1.Namer("properties", memberNameStyle, []);
    }
    makeUnionMemberNamer() {
        return new Naming_1.Namer("properties", memberNameStyle, []);
    }
    makeEnumCaseNamer() {
        return new Naming_1.Namer("enum-cases", n => simpleNameStyle(n, true), []);
    }
    dryType(t, isOptional = false) {
        const optional = isOptional ? ".optional" : "";
        return TypeUtils_1.matchType(t, _anyType => ["Types::Any", optional], _nullType => ["Types::Nil", optional], _boolType => ["Types::Bool", optional], _integerType => ["Types::Int", optional], _doubleType => ["Types::Double", optional], _stringType => ["Types::String", optional], arrayType => ["Types.Array(", this.dryType(arrayType.items), ")", optional], classType => [this.nameForNamedType(classType), optional], mapType => ["Types::Hash.meta(of: ", this.dryType(mapType.values), ")", optional], enumType => ["Types::", this.nameForNamedType(enumType), optional], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                return [this.dryType(nullable), ".optional"];
            }
            return ["Types.Instance(", this.nameForNamedType(unionType), ")", optional];
        });
    }
    exampleUse(t, exp, depth = 6, optional = false) {
        if (depth-- <= 0) {
            return exp;
        }
        const safeNav = optional ? "&" : "";
        return TypeUtils_1.matchType(t, _anyType => exp, _nullType => [exp, ".nil?"], _boolType => exp, _integerType => [exp, ".even?"], _doubleType => exp, _stringType => exp, arrayType => this.exampleUse(arrayType.items, [exp, safeNav, ".first"], depth), classType => {
            let info;
            this.forEachClassProperty(classType, "none", (name, _json, prop) => {
                if (["class", "map", "array"].indexOf(prop.type.kind) >= 0) {
                    info = { name, prop };
                }
                else if (info === undefined) {
                    info = { name, prop };
                }
            });
            if (info !== undefined) {
                return this.exampleUse(info.prop.type, [exp, safeNav, ".", info.name], depth, info.prop.isOptional);
            }
            return exp;
        }, mapType => this.exampleUse(mapType.values, [exp, safeNav, `["…"]`], depth), enumType => {
            let name;
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
        }, unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                if (["class", "map", "array"].indexOf(nullable.kind) >= 0) {
                    return this.exampleUse(nullable, exp, depth, true);
                }
                return [exp, ".nil?"];
            }
            return exp;
        });
    }
    jsonSample(t) {
        function inner() {
            if (t instanceof Type_1.ArrayType) {
                return "[…]";
            }
            else if (t instanceof Type_1.MapType) {
                return "{…}";
            }
            else if (t instanceof Type_1.ClassType) {
                return "{…}";
            }
            else {
                return "…";
            }
        }
        return `"${inner()}"`;
    }
    fromDynamic(t, e, optional = false, castPrimitives = false) {
        const primitiveCast = [this.dryType(t, optional), "[", e, "]"];
        const primitive = castPrimitives ? primitiveCast : e;
        const safeAccess = optional ? "&" : "";
        return TypeUtils_1.matchType(t, _anyType => primitive, _nullType => primitive, _boolType => primitive, _integerType => primitive, _doubleType => primitive, _stringType => primitive, arrayType => [e, safeAccess, ".map { |x| ", this.fromDynamic(arrayType.items, "x", false, true), " }"], classType => {
            const expression = [this.nameForNamedType(classType), ".from_dynamic!(", e, ")"];
            return optional ? [e, " ? ", expression, " : nil"] : expression;
        }, mapType => [
            ["Types::Hash", optional ? ".optional" : "", "[", e, "]"],
            safeAccess,
            ".map { |k, v| [k, ",
            this.fromDynamic(mapType.values, "v", false, true),
            "] }",
            safeAccess,
            ".to_h"
        ], enumType => {
            const expression = ["Types::", this.nameForNamedType(enumType), "[", e, "]"];
            return optional ? [e, ".nil? ? nil : ", expression] : expression;
        }, unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                return this.fromDynamic(nullable, e, true);
            }
            const expression = [this.nameForNamedType(unionType), ".from_dynamic!(", e, ")"];
            return optional ? [e, " ? ", expression, " : nil"] : expression;
        });
    }
    toDynamic(t, e, optional = false) {
        if (this.marshalsImplicitlyToDynamic(t)) {
            return e;
        }
        return TypeUtils_1.matchType(t, _anyType => e, _nullType => e, _boolType => e, _integerType => e, _doubleType => e, _stringType => e, arrayType => [e, optional ? "&" : "", ".map { |x| ", this.toDynamic(arrayType.items, "x"), " }"], _classType => [e, optional ? "&" : "", ".to_dynamic"], mapType => [e, optional ? "&" : "", ".map { |k, v| [k, ", this.toDynamic(mapType.values, "v"), "] }.to_h"], _enumType => e, unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                return this.toDynamic(nullable, e, true);
            }
            if (this.marshalsImplicitlyToDynamic(unionType)) {
                return e;
            }
            return [e, optional ? "&" : "", ".to_dynamic"];
        });
    }
    marshalsImplicitlyToDynamic(t) {
        return TypeUtils_1.matchType(t, _anyType => true, _nullType => true, _boolType => true, _integerType => true, _doubleType => true, _stringType => true, arrayType => this.marshalsImplicitlyToDynamic(arrayType.items), _classType => false, mapType => this.marshalsImplicitlyToDynamic(mapType.values), _enumType => true, unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                return this.marshalsImplicitlyToDynamic(nullable);
            }
            return false;
        });
    }
    // This is only to be used to allow class properties to possibly
    // marshal implicitly. They are allowed to do this because they will
    // be checked in Dry::Struct.new
    propertyTypeMarshalsImplicitlyFromDynamic(t) {
        return TypeUtils_1.matchType(t, _anyType => true, _nullType => true, _boolType => true, _integerType => true, _doubleType => true, _stringType => true, arrayType => this.propertyTypeMarshalsImplicitlyFromDynamic(arrayType.items), _classType => false, 
        // Map properties must be checked because Dry:Types doesn't have a generic Map
        _mapType => false, _enumType => true, unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                return this.propertyTypeMarshalsImplicitlyFromDynamic(nullable);
            }
            return false;
        });
    }
    emitBlock(source, emit) {
        this.emitLine(source);
        this.indent(emit);
        this.emitLine("end");
    }
    emitClass(c, className) {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className, " < Dry::Struct"], () => {
            let table = [];
            let count = c.getProperties().size;
            this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                const last = --count === 0;
                const description = this.descriptionForClassProperty(c, jsonName);
                const attribute = [
                    ["attribute :", name, ","],
                    [" ", this.dryType(p.type), p.isOptional ? ".optional" : ""]
                ];
                if (description !== undefined) {
                    if (table.length > 0) {
                        this.emitTable(table);
                        table = [];
                    }
                    this.ensureBlankLine();
                    this.emitDescriptionBlock(description);
                    this.emitLine(attribute);
                    if (!last) {
                        this.ensureBlankLine();
                    }
                }
                else {
                    table.push(attribute);
                }
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
                    const inits = [];
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
                        }
                        else {
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
                    const inits = [];
                    this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                        const expression = this.toDynamic(p.type, ["@", name], p.isOptional);
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
    emitEnum(e, enumName) {
        this.emitDescription(this.descriptionForType(e));
        this.emitBlock(["module ", enumName], () => {
            const table = [];
            this.forEachEnumCase(e, "none", (name, json) => {
                table.push([[name], [` = "${stringEscape(json)}"`]]);
            });
            this.emitTable(table);
        });
    }
    emitUnion(u, unionName) {
        this.emitDescription(this.descriptionForType(u));
        this.emitBlock(["class ", unionName, " < Dry::Struct"], () => {
            const table = [];
            this.forEachUnionMember(u, u.getChildren(), "none", null, (name, t) => {
                table.push([["attribute :", name, ", "], [this.dryType(t, true)]]);
            });
            this.emitTable(table);
            if (this._options.justTypes) {
                return;
            }
            this.ensureBlankLine();
            const [maybeNull, nonNulls] = TypeUtils_1.removeNullFromUnion(u, false);
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
                    }
                    else {
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
                    this.emitLine(first ? "if" : "elsif", " @", name, " != nil");
                    this.indent(() => {
                        this.emitLine(this.toDynamic(t, ["@", name]));
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
    emitTypesModule() {
        this.emitBlock(["module Types"], () => {
            this.emitLine("include Dry::Types.module");
            const declarations = [];
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
                if (has.int)
                    declarations.push([["Int"], [` = ${this._options.strictness}Int`]]);
                if (this._options.strictness === Strictness.Strict) {
                    if (has.nil)
                        declarations.push([["Nil"], [` = ${this._options.strictness}Nil`]]);
                }
                if (has.bool)
                    declarations.push([["Bool"], [` = ${this._options.strictness}Bool`]]);
                if (has.hash)
                    declarations.push([["Hash"], [` = ${this._options.strictness}Hash`]]);
                if (has.string)
                    declarations.push([["String"], [` = ${this._options.strictness}String`]]);
                if (has.double)
                    declarations.push([
                        ["Double"],
                        [` = ${this._options.strictness}Float | ${this._options.strictness}Int`]
                    ]);
            }
            this.forEachEnum("none", (enumType, enumName) => {
                const cases = [];
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
    emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        }
        else if (!this._options.justTypes) {
            this.emitLine("# This code may look unusually verbose for Ruby (and it is), but");
            this.emitLine("# it performs some subtle and complex validation of JSON data.");
            this.emitLine("#");
            this.emitLine("# To parse this JSON, add 'dry-struct' and 'dry-types' gems, then do:");
            this.emitLine("#");
            this.forEachTopLevel("none", (topLevel, name) => {
                const variable = Source_1.modifySource(Strings_1.snakeCase, name);
                this.emitLine("#   ", variable, " = ", name, ".from_json! ", this.jsonSample(topLevel));
                this.emitLine("#   puts ", this.exampleUse(topLevel, variable));
                this.emitLine("#");
            });
            this.emitLine("# If from_json! succeeds, the value returned matches the schema.");
        }
        this.ensureBlankLine();
        this.emitLine("require 'json'");
        this.emitLine("require 'dry-types'");
        this.emitLine("require 'dry-struct'");
        this.ensureBlankLine();
        this.emitTypesModule();
        this.forEachDeclaration("leading-and-interposing", decl => {
            if (decl.kind === "forward") {
                this.emitCommentLines(["(forward declaration)"]);
                this.emitLine("class ", this.nameForNamedType(decl.type), " < Dry::Struct; end");
            }
        });
        this.forEachNamedType("leading-and-interposing", (c, n) => this.emitClass(c, n), (e, n) => this.emitEnum(e, n), (u, n) => this.emitUnion(u, n));
        if (!this._options.justTypes) {
            this.forEachTopLevel("leading-and-interposing", (topLevel, name) => {
                const self = Source_1.modifySource(Strings_1.snakeCase, name);
                // The json gem defines to_json on maps and primitives, so we only need to supply
                // it for arrays.
                const needsToJsonDefined = "array" === topLevel.kind;
                this.emitBlock(["class ", name], () => {
                    this.emitBlock(["def self.from_json!(json)"], () => {
                        if (needsToJsonDefined) {
                            this.emitLine(self, " = ", this.fromDynamic(topLevel, "JSON.parse(json, quirks_mode: true)"));
                            this.emitBlock([self, ".define_singleton_method(:to_json) do"], () => {
                                this.emitLine("JSON.generate(", this.toDynamic(topLevel, "self"), ")");
                            });
                            this.emitLine(self);
                        }
                        else {
                            this.emitLine(this.fromDynamic(topLevel, "JSON.parse(json, quirks_mode: true)"));
                        }
                    });
                });
            }, t => this.namedTypeToNameForTopLevel(t) === undefined);
        }
    }
}
exports.RubyRenderer = RubyRenderer;
