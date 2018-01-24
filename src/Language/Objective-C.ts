"use strict";

import * as lo from "lodash";
import { includes, startsWith, repeat } from "lodash";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, nullableFromUnion, matchType, ArrayType, MapType, UnionType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Sourcelike, modifySource } from "../Source";
import {
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    allLowerWordStyle,
    camelCase,
    utf16LegalizeCharacters,
    stringEscape
} from "../Strings";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, BooleanOption, EnumOption } from "../RendererOptions";
import { Set } from "immutable";
import { assert, defined } from "../Support";

const unicode = require("unicode-properties");

type OutputFeatures = { interface: boolean; implementation: boolean };

const DEBUG = false;
const DEFAULT_CLASS_PREFIX = "QT";

export default class ObjectiveCTargetLanguage extends TargetLanguage {
    private readonly _featuresOption = new EnumOption("features", "Interface and implementation", [
        ["all", { interface: true, implementation: true }],
        ["interface", { interface: true, implementation: false }],
        ["implementation", { interface: false, implementation: true }]
    ]);
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    private readonly _emitMarshallingFunctions = new BooleanOption("functions", "C-style functions", false);
    private readonly _classPrefixOption = new StringOption(
        "class-prefix",
        "Class prefix",
        "PREFIX",
        DEFAULT_CLASS_PREFIX
    );
    private readonly _extraCommentsOption = new BooleanOption("extra-comments", "Extra comments", false);

    constructor() {
        super("Objective-C", ["objc", "objective-c", "objectivec"], "m");
        this.setOptions([
            this._justTypesOption,
            this._classPrefixOption,
            this._featuresOption,
            this._extraCommentsOption,
            this._emitMarshallingFunctions
        ]);
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return ObjectiveCRenderer;
    }
}

function typeNameStyle(prefix: string, original: string): string {
    const words = splitIntoWords(original);
    const result = combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
    // Take care not to doubly-prefix type names
    return startsWith(result, prefix) ? result : prefix + result;
}

function propertyNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        allLowerWordStyle,
        firstUpperWordStyle,
        allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

const keywords = [
    /*
    "_Bool",
    "_Complex",
    "_Imaginary",
    */
    "asm",
    "atomic",
    "auto",
    "bool",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "false",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "nil",
    "nonatomic",
    "register",
    "restrict",
    "retain",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "typeof",
    "true",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while"
];

const forbiddenPropertyNames = ["hash", "description", "init", "copy", "mutableCopy", "superclass", "debugDescription"];

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return includes(["Nd", "Pc", "Mn", "Mc"], category) || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function isAnyOrNull(t: Type): boolean {
    return t.kind === "any" || t.kind === "null";
}

const staticEnumValuesIdentifier = "values";
const forbiddenForEnumCases = ["new", staticEnumValuesIdentifier];

class ObjectiveCRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    // enums contained in NSArray or NSDictionary are represented
    // as 'pseudo-enum' reference types. Eventually we may want to
    // support 'natural' enums (NSUInteger) but this isn't implemented yet.
    pseudoEnums: Set<EnumType>;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private _classPrefix: string,
        private readonly _features: OutputFeatures,
        private readonly _extraComments: boolean,
        private readonly _marshalingFunctions: boolean
    ) {
        super(graph, leadingComments);

        // Infer the class prefix from a top-level name if it's not given
        if (this._classPrefix === DEFAULT_CLASS_PREFIX) {
            const aTopLevel = defined(this.topLevels.keySeq().first());
            this._classPrefix = this.inferClassPrefix(aTopLevel);
        }

        this.pseudoEnums = graph
            .allTypesUnordered()
            .filter(t => t instanceof EnumType && this.enumOccursInArrayOrMap(t))
            .map(t => t as EnumType);
    }

    private inferClassPrefix(name: string): string {
        const caps = lo.initial(lo.takeWhile(name, s => s === s.toLocaleUpperCase())).join("");
        return caps.length === 0 ? DEFAULT_CLASS_PREFIX : caps;
    }

    private enumOccursInArrayOrMap(enumType: EnumType): boolean {
        function containedBy(t: Type): boolean {
            return (
                (t instanceof ArrayType && t.items.equals(enumType)) ||
                (t instanceof MapType && t.values.equals(enumType)) ||
                (t instanceof ClassType && t.properties.some(p => containedBy(p.type))) ||
                // TODO support unions
                (t instanceof UnionType && false)
            );
        }
        return this.typeGraph.allTypesUnordered().some(containedBy);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: forbiddenPropertyNames, includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: forbiddenForEnumCases, includeGlobalForbidden: true };
    }

    protected topLevelNameStyle(rawName: string): string {
        return camelCase(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer(rawName => typeNameStyle(this._classPrefix, rawName));
    }

    protected makeClassPropertyNamer(): Namer {
        // TODO why is underscore being removed?
        return new Namer(s => propertyNameStyle(s), ["_", "the", "one", "some", "another"]);
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer(propertyNameStyle, []);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return type;
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private emitMethod(declaration: Sourcelike, f: () => void) {
        this.emitLine(declaration);
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}");
    }

    private emitExtraComments = (...comments: Sourcelike[]) => {
        if (!this._extraComments) return;
        for (const comment of comments) {
            this.emitLine("// ", comment);
        }
    };

    startFile(basename: Sourcelike, extension: string): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.${extension}`;
    }

    finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    private assignRetainOrCopy(t: Type): "assign" | "retain" | "copy" {
        return matchType<"assign" | "retain" | "copy">(
            t,
            _anyType => "copy",
            _nullType => "copy",
            _boolType => "assign",
            _integerType => "assign",
            _doubleType => "assign",
            _stringType => "copy",
            _arrayType => "assign",
            _classType => "retain",
            _mapType => "assign",
            _enumType => "copy",
            _unionType => "copy"
        );
    }

    private objcType = (t: Type, nullableOrBoxed: boolean = false): [Sourcelike, string] => {
        return matchType<[Sourcelike, string]>(
            t,
            _anyType => ["id", ""],
            // For now, we're treating nulls just like any
            _nullType => ["id", ""],
            _boolType => (nullableOrBoxed ? ["NSNumber", " *"] : ["BOOL", ""]),
            _integerType => (nullableOrBoxed ? ["NSNumber", " *"] : ["NSInteger", ""]),
            _doubleType => (nullableOrBoxed ? ["NSNumber", " *"] : ["double", ""]),
            _stringType => ["NSString", " *"],
            arrayType => {
                const itemType = arrayType.items;
                const itemTypeName = this.objcType(itemType, true);
                // NSArray<id>* === NSArray*
                if (isAnyOrNull(itemType)) {
                    return ["NSArray", " *"];
                }
                return [["NSArray<", itemTypeName, ">"], " *"];
            },
            classType => [this.nameForNamedType(classType), " *"],
            mapType => [["NSDictionary<NSString *, ", this.objcType(mapType.values, true), ">"], " *"],
            enumType => [this.nameForNamedType(enumType), " *"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.objcType(nullable, true) : ["id", ""];
            }
        );
    };

    private jsonType = (t: Type): [Sourcelike, string] => {
        return matchType<[Sourcelike, string]>(
            t,
            _anyType => ["id", ""],
            // For now, we're treating nulls just like any
            _nullType => ["id", ""],
            _boolType => ["NSNumber", " *"],
            _integerType => ["NSNumber", " *"],
            _doubleType => ["NSNumber", " *"],
            _stringType => ["NSString", " *"],
            _arrayType => ["NSArray", " *"],
            _classType => ["NSDictionary<NSString *, id>", " *"],
            mapType => [["NSDictionary<NSString *, ", this.jsonType(mapType.values), ">"], " *"],
            _enumType => ["NSString", " *"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.jsonType(nullable) : ["id", ""];
            }
        );
    };

    private fromDynamicExpression = (t: Type, ...dynamic: Sourcelike[]): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => dynamic,
            _nullType => dynamic,
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            arrayType => ["map(", dynamic, ", λ(id x, ", this.fromDynamicExpression(arrayType.items, "x"), "))"],
            classType => ["[", this.nameForNamedType(classType), " fromJSONDictionary:", dynamic, "]"],
            mapType => ["map(", dynamic, ", λ(id x, ", this.fromDynamicExpression(mapType.values, "x"), "))"],
            enumType => ["[", this.nameForNamedType(enumType), " withValue:", dynamic, "]"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.fromDynamicExpression(nullable, dynamic) : dynamic;
            }
        );
    };

    private toDynamicExpression = (t: Type, typed: Sourcelike): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => ["NSNullify(", typed, ")"],
            _nullType => ["NSNullify(", typed, ")"],
            // Sadly, KVC
            _boolType => [typed, ` ? @YES : @NO`],
            _integerType => typed,
            _doubleType => typed,
            _stringType => typed,
            arrayType => {
                if (this.isJSONSafe(arrayType)) {
                    // TODO check each value type
                    return typed;
                }
                return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(arrayType.items, "x"), "))"];
            },
            _classType => ["[", typed, " JSONDictionary]"],
            mapType => {
                if (this.isJSONSafe(mapType)) {
                    // TODO check each value type
                    return typed;
                }
                return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(mapType.values, "x"), "))"];
            },
            _enumType => ["[", typed, " value]"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (this.isJSONSafe(nullable)) {
                        return ["NSNullify(", typed, ")"];
                    } else {
                        return ["NSNullify(", this.toDynamicExpression(nullable, typed), ")"];
                    }
                } else {
                    // TODO support unions
                    return typed;
                }
            }
        );
    };

    private isJSONSafe(t: Type): boolean {
        if (t instanceof ClassType) {
            return false;
        } else if (t instanceof EnumType) {
            return false;
        } else if (t instanceof ArrayType) {
            return this.isJSONSafe(t.items);
        } else if (t instanceof MapType) {
            return this.isJSONSafe(t.values);
        } else if (t.isPrimitive()) {
            return true;
        } else if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) {
                return this.isJSONSafe(nullable);
            } else {
                // We don't support unions yet, so this is just untyped
                return true;
            }
        } else {
            return false;
        }
    }

    private isJSONOutputSafe(t: Type): boolean {
        return this.isJSONSafe(t) && "bool" !== t.kind;
    }

    private emitPropertyAssignment = (propertyName: Name, jsonName: string, propertyType: Type) => {
        const name = ["_", propertyName];
        matchType(
            propertyType,
            anyType => this.emitLine(name, " = ", this.fromDynamicExpression(anyType, name), ";"),
            nullType => this.emitLine(name, " = ", this.fromDynamicExpression(nullType, name), ";"),
            boolType => this.emitLine(name, " = ", this.fromDynamicExpression(boolType, name), ";"),
            integerType => this.emitLine(name, " = ", this.fromDynamicExpression(integerType, name), ";"),
            doubleType => this.emitLine(name, " = ", this.fromDynamicExpression(doubleType, name), ";"),
            stringType => this.emitLine(name, " = ", this.fromDynamicExpression(stringType, name), ";"),
            arrayType => this.emitLine(name, " = ", this.fromDynamicExpression(arrayType, name), ";"),
            classType => this.emitLine(name, " = ", this.fromDynamicExpression(classType, ["(id)", name]), ";"),
            mapType => {
                const itemType = mapType.values;
                this.emitLine(
                    name,
                    " = map(",
                    name,
                    ", ",
                    ["λ(id x, ", this.fromDynamicExpression(itemType, "x"), ")"],
                    ");"
                );
            },
            enumType => this.emitLine(name, " = ", this.fromDynamicExpression(enumType, ["(id)", name]), ";"),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.emitPropertyAssignment(propertyName, jsonName, nullable);
                } else {
                    // TODO This is a union, but for now we just leave it dynamic
                    this.emitLine(name, " = ", this.fromDynamicExpression(unionType, name), ";");
                }
            }
        );
    };

    private emitPrivateClassInterface = (_: ClassType, name: Name): void => {
        this.emitLine("@interface ", name, " (JSONConversion)");
        this.emitLine("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;");
        this.emitLine("- (NSDictionary *)JSONDictionary;");
        this.emitLine("@end");
    };

    private pointerAwareTypeName(t: Type | [Sourcelike, string]): Sourcelike {
        const name = t instanceof Type ? this.objcType(t) : t;
        const isPointer = name[1] !== "";
        return isPointer ? name : [name, " "];
    }

    private emitNonClassTopLevelTypedef(t: Type, name: Name): void {
        let nonPointerTypeName = this.objcType(t)[0];
        this.emitLine("typedef ", nonPointerTypeName, " ", name, ";");
    }

    private topLevelFromDataPrototype(name: Name): Sourcelike {
        return [name, " *_Nullable ", name, "FromData(NSData *data, NSError **error)"];
    }

    private topLevelFromJSONPrototype(name: Name): Sourcelike {
        return [name, " *_Nullable ", name, "FromJSON(NSString *json, NSStringEncoding encoding, NSError **error)"];
    }

    private topLevelToDataPrototype(name: Name, pad: boolean = false): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? repeat(" ", this.sourcelikeToString(name).length - "NSData".length) : "";
        return ["NSData", padding, " *_Nullable ", name, "ToData(", name, " *", parameter, ", NSError **error)"];
    }

    private topLevelToJSONPrototype(name: Name, pad: boolean = false): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? repeat(" ", this.sourcelikeToString(name).length - "NSString".length) : "";
        return [
            "NSString",
            padding,
            " *_Nullable ",
            name,
            "ToJSON(",
            name,
            " *",
            parameter,
            ", NSStringEncoding encoding, NSError **error)"
        ];
    }

    private emitTopLevelFunctionDeclarations(_: Type, name: Name): void {
        this.emitLine(this.topLevelFromDataPrototype(name), ";");
        this.emitLine(this.topLevelFromJSONPrototype(name), ";");
        this.emitLine(this.topLevelToDataPrototype(name, true), ";");
        this.emitLine(this.topLevelToJSONPrototype(name, true), ";");
    }

    private emitTryCatchAsError(inTry: () => void, inCatch: () => void) {
        this.emitLine("@try {");
        this.indent(inTry);
        this.emitLine("} @catch (NSException *exception) {");
        this.indent(() => {
            this.emitLine(
                `*error = [NSError errorWithDomain:@"JSONSerialization" code:-1 userInfo:@{ @"exception": exception }];`
            );
            inCatch();
        });
        this.emitLine("}");
    }

    private emitTopLevelFunctions(t: Type, name: Name): void {
        const parameter = this.variableNameForTopLevel(name);

        this.ensureBlankLine();
        this.emitMethod(this.topLevelFromDataPrototype(name), () => {
            this.emitTryCatchAsError(
                () => {
                    this.emitLine(
                        "id json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];"
                    );
                    this.emitLine("return *error ? nil : ", this.fromDynamicExpression(t, "json"), ";");
                },
                () => this.emitLine("return nil;")
            );
        });

        this.ensureBlankLine();
        this.emitMethod(this.topLevelFromJSONPrototype(name), () => {
            this.emitLine("return ", name, "FromData([json dataUsingEncoding:encoding], error);");
        });

        this.ensureBlankLine();
        this.emitMethod(this.topLevelToDataPrototype(name), () => {
            this.emitTryCatchAsError(
                () => {
                    this.emitLine("id json = ", this.toDynamicExpression(t, parameter), ";");
                    this.emitLine(
                        "NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];"
                    );
                    this.emitLine("return *error ? nil : data;");
                },
                () => this.emitLine("return nil;")
            );
        });

        this.ensureBlankLine();
        this.emitMethod(this.topLevelToJSONPrototype(name), () => {
            this.emitLine("NSData *data = ", name, "ToData(", parameter, ", error);");
            this.emitLine("return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;");
        });
    }

    private emitClassInterface = (t: ClassType, className: Name): void => {
        const isTopLevel = this.topLevels.valueSeq().contains(t);

        this.emitLine("@interface ", className, " : NSObject");
        if (DEBUG) this.emitLine("@property NSDictionary<NSString *, id> *_json;");
        this.forEachClassProperty(t, "none", (name, _json, property) => {
            let attributes = ["nonatomic"];
            // TODO offer a 'readonly' option
            // TODO We must add "copy" if it's NSCopy, otherwise "strong"
            if (property.type.isNullable) {
                attributes.push("nullable");
            }
            attributes.push(this.assignRetainOrCopy(property.type));
            this.emitLine(
                "@property ",
                ["(", attributes.join(", "), ")"],
                " ",
                this.pointerAwareTypeName(property.type),
                name,
                ";"
            );
        });

        if (!this._justTypes && isTopLevel) {
            if (t.properties.count() > 0) this.ensureBlankLine();

            this.emitLine(
                "+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;"
            );
            this.emitLine("+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;");
            this.emitLine(
                "- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;"
            );
            this.emitLine("- (NSData *_Nullable)toData:(NSError *_Nullable *)error;");
        }
        this.emitLine("@end");
    };

    // TODO Implement NSCopying
    private emitClassImplementation = (t: ClassType, className: Name): void => {
        const isTopLevel = this.topLevels.valueSeq().contains(t);

        const [hasIrregularProperties, hasUnsafeProperties] = (() => {
            let irregular = false;
            let unsafe = false;
            this.forEachClassProperty(t, "none", (name, jsonName, property) => {
                unsafe = unsafe || !this.isJSONOutputSafe(property.type);
                irregular = irregular || stringEscape(jsonName) !== this.sourcelikeToString(name);
            });
            return [irregular, unsafe];
        })();

        this.emitLine("@implementation ", className);
        if (!this._justTypes) {
            this.emitMethod("+(NSDictionary<NSString *, NSString *> *)properties", () => {
                this.emitLine("static NSDictionary<NSString *, NSString *> *properties;");
                this.emitLine("return properties = properties ? properties : @{");
                this.indent(() => {
                    this.forEachClassProperty(t, "none", (name, jsonName) =>
                        this.emitLine(`@"${stringEscape(jsonName)}": @"`, name, `",`)
                    );
                });
                this.emitLine("};");
            });
            this.ensureBlankLine();

            if (isTopLevel) {
                this.emitMethod(
                    "+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error",
                    () => {
                        this.emitLine("return ", className, "FromData(data, error);");
                    }
                );
                this.ensureBlankLine();
                this.emitMethod(
                    "+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error",
                    () => {
                        this.emitLine("return ", className, "FromJSON(json, encoding, error);");
                    }
                );
                this.ensureBlankLine();
            }

            this.emitMethod("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict", () => {
                this.emitLine("return dict ? [[", className, " alloc] initWithJSONDictionary:dict] : nil;");
            });
            this.ensureBlankLine();
            this.emitMethod("- (instancetype)initWithJSONDictionary:(NSDictionary *)dict", () => {
                this.emitBlock("if (self = [super init])", () => {
                    if (DEBUG) this.emitLine("__json = dict;");

                    this.emitLine("[self setValuesForKeysWithDictionary:dict];");
                    this.forEachClassProperty(t, "none", (name, jsonName, property) => {
                        if (!this.isJSONSafe(property.type)) {
                            this.emitPropertyAssignment(name, jsonName, property.type);
                        }
                    });
                });
                this.emitLine("return self;");
            });

            if (hasIrregularProperties) {
                this.ensureBlankLine();
                this.emitMethod("-(void)setValue:(nullable id)value forKey:(NSString *)key", () => {
                    this.emitLine("[super setValue:value forKey:", className, ".properties[key]];");
                });
            }

            this.ensureBlankLine();
            this.emitMethod("- (NSDictionary *)JSONDictionary", () => {
                if (!hasIrregularProperties && !hasUnsafeProperties) {
                    this.emitLine("return [self dictionaryWithValuesForKeys:", className, ".properties.allValues];");
                    return;
                }

                this.emitLine(
                    "id dict = [[self dictionaryWithValuesForKeys:",
                    className,
                    ".properties.allValues] mutableCopy];"
                );
                this.ensureBlankLine();

                if (hasIrregularProperties) {
                    this.emitExtraComments("Rewrite property names that differ in JSON");
                    this.emitBlock(["for (id jsonName in ", className, ".properties)"], () => {
                        this.emitLine(`id propertyName = `, className, `.properties[jsonName];`);
                        this.emitBlock(`if (![jsonName isEqualToString:propertyName])`, () => {
                            this.emitLine(`dict[jsonName] = dict[propertyName];`);
                            this.emitLine(`[dict removeObjectForKey:propertyName];`);
                        });
                    });
                }

                if (hasUnsafeProperties) {
                    this.ensureBlankLine();
                    this.emitExtraComments("Map values that need translation");
                    this.emitLine("[dict addEntriesFromDictionary:@{");
                    this.indent(() => {
                        this.forEachClassProperty(t, "none", (propertyName, jsonKey, property) => {
                            if (!this.isJSONOutputSafe(property.type)) {
                                const key = stringEscape(jsonKey);
                                const name = ["_", propertyName];
                                this.emitLine('@"', key, '": ', this.toDynamicExpression(property.type, name), ",");
                            }
                        });
                    });
                    this.emitLine("}];");
                }

                this.ensureBlankLine();
                this.emitLine("return dict;");
            });

            if (isTopLevel) {
                this.ensureBlankLine();
                this.emitMethod(`- (NSData *_Nullable)toData:(NSError *_Nullable *)error`, () => {
                    this.emitLine("return ", className, "ToData(self, error);");
                });
                this.ensureBlankLine();
                this.emitMethod(
                    `- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error`,
                    () => {
                        this.emitLine("return ", className, "ToJSON(self, encoding, error);");
                    }
                );
            }
        }

        this.emitLine("@end");
    };

    private emitMark = (label: string) => {
        this.ensureBlankLine();
        this.emitLine(`// MARK: ${label}`);
        this.ensureBlankLine();
    };

    private variableNameForTopLevel(name: Name): Sourcelike {
        const camelCaseName = modifySource(serialized => {
            // 1. remove class prefix
            serialized = serialized.substr(this._classPrefix.length);
            // 2. camel case
            return camelCase(serialized);
        }, name);
        return camelCaseName;
    }

    private emitPseudoEnumInterface(enumType: EnumType, enumName: Name) {
        this.emitLine("@interface ", enumName, " : NSObject");
        this.emitLine("@property (nonatomic, readonly, copy) NSString *value;");
        this.emitLine("+ (instancetype _Nullable)withValue:(NSString *)value;");
        this.forEachEnumCase(enumType, "none", (name, _) => {
            this.emitLine("+ (", enumName, " *)", name, ";");
        });
        this.emitLine("@end");
    }

    private emitPseudoEnumImplementation(enumType: EnumType, enumName: Name) {
        this.emitLine("@implementation ", enumName);

        const instances = [enumName, ".", staticEnumValuesIdentifier];
        this.emitMethod(["+ (NSDictionary<NSString *, ", enumName, " *> *)", staticEnumValuesIdentifier], () => {
            this.emitLine("static NSDictionary<NSString *, ", enumName, " *> *", staticEnumValuesIdentifier, ";");
            this.emitLine(
                "return ",
                staticEnumValuesIdentifier,
                " = ",
                staticEnumValuesIdentifier,
                " ? ",
                staticEnumValuesIdentifier,
                " : @{"
            );
            this.indent(() => {
                this.forEachEnumCase(enumType, "none", (_, jsonValue) => {
                    const value = ['@"', stringEscape(jsonValue), '"'];
                    this.emitLine(value, ": [[", enumName, " alloc] initWithValue:", value, "],");
                });
            });
            this.emitLine("};");
        });

        this.ensureBlankLine();
        this.forEachEnumCase(enumType, "none", (name, jsonValue) => {
            this.emitLine(
                "+ (",
                enumName,
                " *)",
                name,
                " { return ",
                instances,
                '[@"',
                stringEscape(jsonValue),
                '"]; }'
            );
        });
        this.ensureBlankLine();

        this.emitMethod("+ (instancetype _Nullable)withValue:(NSString *)value", () =>
            this.emitLine("return ", instances, "[value];")
        );

        this.ensureBlankLine();
        this.emitMethod("- (instancetype)initWithValue:(NSString *)value", () => {
            this.emitLine("if (self = [super init]) _value = value;");
            this.emitLine("return self;");
        });
        this.ensureBlankLine();

        this.emitLine("- (NSUInteger)hash { return _value.hash; }");
        this.emitLine("@end");
    }

    splitExtension(filename: string): [string, string] {
        const i = filename.lastIndexOf(".");
        const extension = i !== -1 ? filename.split(".").pop() : "m";
        filename = i !== -1 ? filename.substr(0, i) : filename;
        return [filename, extension === undefined ? "m" : extension];
    }

    protected emitSourceStructure(proposedFilename: string): void {
        const fileMode = proposedFilename !== "stdout";
        if (!fileMode) {
            // We don't have a filename, so we use a top-level name
            proposedFilename = this.sourcelikeToString(this.nameForNamedType(defined(this.topLevels.first()))) + ".m";
        }
        const [filename, extension] = this.splitExtension(proposedFilename);

        if (this._features.interface) {
            this.startFile(filename, "h");

            if (this.leadingComments !== undefined) {
                this.emitCommentLines("// ", this.leadingComments);
            } else if (!this._justTypes) {
                this.emitCommentLines("// ", ["To parse this JSON:", ""]);
                this.emitLine("//   NSError *error;");
                this.forEachTopLevel("none", (t, topLevelName) => {
                    const fromJsonExpression =
                        t instanceof ClassType
                            ? ["[", topLevelName, " fromJSON:json encoding:NSUTF8Encoding error:&error]"]
                            : [topLevelName, "FromJSON(json, NSUTF8Encoding, &error);"];
                    this.emitLine(
                        "//   ",
                        topLevelName,
                        " *",
                        this.variableNameForTopLevel(topLevelName),
                        " = ",
                        fromJsonExpression
                    );
                });
            }

            this.ensureBlankLine();
            this.emitLine(`#import <Foundation/Foundation.h>`);
            this.ensureBlankLine();

            // Emit @class declarations for top-level array+maps and classes
            this.forEachNamedType(
                "none",
                (_, className) => this.emitLine("@class ", className, ";"),
                (_, enumName) => this.emitLine("@class ", enumName, ";"),
                () => null
            );
            this.ensureBlankLine();

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_BEGIN");
            this.ensureBlankLine();

            this.forEachEnum("leading-and-interposing", (t, n) => this.emitPseudoEnumInterface(t, n));

            // Emit interfaces for top-level array+maps and classes
            this.forEachTopLevel(
                "leading-and-interposing",
                (t, n) => this.emitNonClassTopLevelTypedef(t, n),
                t => !(t instanceof ClassType)
            );

            const hasTopLevelNonClassTypes = this.topLevels.some(t => !(t instanceof ClassType));
            if (!this._justTypes && (hasTopLevelNonClassTypes || this._marshalingFunctions)) {
                this.ensureBlankLine();
                this.emitExtraComments("Marshalling functions for top-level types.");
                this.forEachTopLevel(
                    "leading-and-interposing",
                    (t, n) => this.emitTopLevelFunctionDeclarations(t, n),
                    // Objective-C developers get freaked out by C functions, so we don't
                    // declare them for top-level object types (we always need them for non-object types)
                    t => this._marshalingFunctions || !(t instanceof ClassType)
                );
            }
            this.forEachNamedType("leading-and-interposing", this.emitClassInterface, () => null, () => null);

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_END");
            this.finishFile();
        }

        if (this._features.implementation) {
            this.startFile(filename, extension);

            this.emitLine(`#import "${filename}.h"`);
            this.ensureBlankLine();

            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitExtraComments("Shorthand for simple blocks");
                this.emitLine(`#define λ(decl, expr) (^(decl) { return (expr); })`);
                if (this._extraComments) {
                    this.ensureBlankLine();
                }
                this.emitExtraComments("nil → NSNull conversion for JSON dictionaries");
                this.emitLine("#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])");
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_BEGIN");
                this.ensureBlankLine();

                // We wouldn't need to emit these private iterfaces if we emitted implementations in forward-order
                // but the code is more readable and explicit if we do this.
                if (this._extraComments) {
                    this.emitMark("Private model interfaces");
                }

                this.forEachNamedType(
                    "leading-and-interposing",
                    this.emitPrivateClassInterface,
                    () => null,
                    () => null
                );

                if (this.haveEnums) {
                    if (this._extraComments) {
                        this.ensureBlankLine();
                        this.emitExtraComments(
                            "These enum-like reference types are needed so that enum",
                            "values can be contained by NSArray and NSDictionary."
                        );
                        this.ensureBlankLine();
                    }
                    this.forEachEnum("leading-and-interposing", (t, n) => this.emitPseudoEnumImplementation(t, n));
                }

                this.ensureBlankLine();
                this.emitMapFunction();
                this.ensureBlankLine();

                this.emitMark("JSON serialization implementations");
                this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitTopLevelFunctions(t, n));
            }

            this.forEachNamedType("leading-and-interposing", this.emitClassImplementation, () => null, () => null);

            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_END");
            }

            this.finishFile();
        }
    }
    private get needsMap(): boolean {
        // TODO this isn't complete (needs union support, for example)
        function needsMap(t: Type): boolean {
            return (
                t instanceof MapType ||
                t instanceof ArrayType ||
                (t instanceof ClassType && t.properties.some(p => needsMap(p.type)))
            );
        }
        return this.typeGraph.allTypesUnordered().some(needsMap);
    }

    private emitMapFunction = () => {
        if (this.needsMap) {
            this.emitMultiline(`static id map(id collection, id (^f)(id value)) {
    id result = nil;
    if ([collection isKindOfClass:[NSArray class]]) {
        result = [NSMutableArray arrayWithCapacity:[collection count]];
        for (id x in collection) [result addObject:f(x)];
    } else if ([collection isKindOfClass:[NSDictionary class]]) {
        result = [NSMutableDictionary dictionaryWithCapacity:[collection count]];
        for (id key in collection) [result setObject:f([collection objectForKey:key]) forKey:key];
    }
    return result;
}`);
        }
    };
}
