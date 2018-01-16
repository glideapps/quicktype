"use strict";

import { includes, startsWith } from "lodash";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, nullableFromUnion, matchType, ArrayType, MapType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Namespace, Name, Namer, funPrefixNamer } from "../Naming";
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
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { StringOption, BooleanOption, EnumOption } from "../RendererOptions";

const unicode = require("unicode-properties");

type OutputFeatures = { interface: boolean; implementation: boolean };

export default class ObjectiveCTargetLanguage extends TargetLanguage {
    private readonly _featuresOption = new EnumOption("features", "Interface and implementation", [
        ["all", { interface: true, implementation: true }],
        ["interface", { interface: true, implementation: false }],
        ["implementation", { interface: false, implementation: true }]
    ]);
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    private readonly _classPrefixOption = new StringOption("class-prefix", "Class prefix", "PREFIX", "QT");
    private readonly _extraCommentsOption = new BooleanOption("extra-comments", "Extra comments", false);

    constructor() {
        super("Objective-C", ["objc", "objective-c", "objectivec"], "m");
        this.setOptions([
            this._justTypesOption,
            this._classPrefixOption,
            this._featuresOption,
            this._extraCommentsOption
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
    "_Bool",
    "_Complex",
    "_Imaginary",
    "atomic",
    "auto",
    "break",
    "case ",
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
    "float ",
    "for ",
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
    "true",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while"
];

const propertySafeKeywords = [
    "BOOL",
    "Class",
    "bycopy",
    "byref",
    "decimal",
    "id",
    "IMP",
    "in",
    "inout",
    "NO",
    "NULL",
    "oneway",
    "out",
    "Protocol",
    "SEL",
    "self",
    "super",
    "YES"
];

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

class ObjectiveCRenderer extends ConvenienceRenderer {
    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _classPrefix: string,
        private readonly _features: OutputFeatures,
        private readonly _extraComments: boolean
    ) {
        super(graph, leadingComments);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(
        _c: ClassType,
        _classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.forbiddenWordsNamespace] };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.forbiddenWordsNamespace] };
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

    private emitExtraComments = (...comments: Sourcelike[]) => {
        if (!this._extraComments) return;
        for (const comment of comments) {
            this.emitLine("// ", comment);
        }
    };

    private objcType = (t: Type): [Sourcelike, string] => {
        return matchType<[Sourcelike, string]>(
            t,
            _anyType => ["id", ""],
            // For now, we're treating nulls just like any
            _nullType => ["id", ""],
            _boolType => ["NSBoolean", " *"],
            _integerType => ["NSNumber", " *"],
            _doubleType => ["NSNumber", " *"],
            _stringType => ["NSString", " *"],
            arrayType => {
                const itemType = arrayType.items;
                const itemTypeName = this.objcType(itemType);
                // NSArray<id>* === NSArray*
                if (isAnyOrNull(itemType)) {
                    return ["NSArray", " *"];
                }
                return [["NSArray<", itemTypeName, ">"], " *"];
            },
            classType => [this.nameForNamedType(classType), " *"],
            mapType => [["NSDictionary<NSString *, ", this.objcType(mapType.values), ">"], " *"],
            // TODO Support enums
            _enumType => ["NSString", " *"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.objcType(nullable) : ["id", ""];
            }
        );
    };

    private jsonType = (t: Type): [Sourcelike, string] => {
        return matchType<[Sourcelike, string]>(
            t,
            _anyType => ["id", ""],
            // For now, we're treating nulls just like any
            _nullType => ["id", ""],
            _boolType => ["NSBoolean", " *"],
            _integerType => ["NSNumber", " *"],
            _doubleType => ["NSNumber", " *"],
            _stringType => ["NSString", " *"],
            _arrayType => ["NSArray", " *"],
            _classType => ["NSDictionary<NSString *, id>", " *"],
            mapType => [["NSDictionary<NSString *, ", this.jsonType(mapType.values), ">"], " *"],
            // TODO Support enums
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
            arrayType => ["[", dynamic, " map:λ(id x, ", this.fromDynamicExpression(arrayType.items, "x"), ")]"],
            classType => ["[", this.nameForNamedType(classType), " fromJSONDictionary:", dynamic, "]"],
            mapType => ["[", dynamic, " map:λ(id x, ", this.fromDynamicExpression(mapType.values, "x"), ")]"],
            // TODO Support enums
            _enumType => dynamic,
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.fromDynamicExpression(nullable, dynamic) : dynamic;
            }
        );
    };

    private toDynamicExpression = (t: Type, dynamic: Sourcelike): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => ["NSNullify(", dynamic, ")"],
            _nullType => ["NSNullify(", dynamic, ")"],
            _boolType => dynamic,
            _integerType => dynamic,
            _doubleType => dynamic,
            _stringType => dynamic,
            arrayType => {
                if (this.isJSONSafe(arrayType)) {
                    // TODO check each value type
                    return dynamic;
                }
                return ["[", dynamic, " map:λ(id x, ", this.toDynamicExpression(arrayType.items, "x"), ")]"];
            },
            _classType => ["[", dynamic, " JSONDictionary]"],
            mapType => {
                if (this.isJSONSafe(mapType)) {
                    // TODO check each value type
                    return dynamic;
                }
                return ["[", dynamic, " map:λ(id x, ", this.toDynamicExpression(mapType.values, "x"), ")]"];
            },
            // TODO Support enums
            _enumType => dynamic,
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (this.isJSONSafe(nullable)) {
                        return ["NSNullify(", dynamic, ")"];
                    } else {
                        return ["NSNullify(", this.toDynamicExpression(nullable, dynamic), ")"];
                    }
                } else {
                    // TODO support unions
                    return dynamic;
                }
            }
        );
    };

    private isJSONSafe(t: Type): boolean {
        if (t instanceof ClassType) {
            return false;
        } else if (t instanceof EnumType) {
            return true;
        } else if (t instanceof ArrayType) {
            return this.isJSONSafe(t.items);
        } else if (t instanceof MapType) {
            return this.isJSONSafe(t.values);
        } else if (t.isPrimitive()) {
            return true;
        } else {
            return false;
        }
    }

    private safePropertyName = (propertyName: Name) => {
        const isKeyword = includes(propertySafeKeywords, this.sourcelikeToString(propertyName));
        return isKeyword ? ["self.", propertyName] : propertyName;
    };

    private emitPropertyAssignment = (propertyName: Name, _json: string, propertyType: Type) => {
        const key = stringEscape(_json);
        const name = this.safePropertyName(propertyName);
        matchType<void>(
            propertyType,
            anyType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(anyType, '[dict objectForKey:@"', key, '"]'),
                    ";"
                ),
            nullType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(nullType, '[dict objectForKey:@"', key, '"]'),
                    ";"
                ),
            boolType =>
                this.emitLine(name, " = ", this.fromDynamicExpression(boolType, '[dict boolForKey:@"', key, '"]'), ";"),
            integerType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(integerType, '[dict numberForKey:@"', key, '"]'),
                    ";"
                ),
            doubleType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(doubleType, '[dict numberForKey:@"', key, '"]'),
                    ";"
                ),
            stringType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(stringType, '[dict stringForKey:@"', key, '"]'),
                    ";"
                ),
            arrayType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(arrayType, '[dict arrayForKey:@"', key, '"]'),
                    ";"
                ),
            classType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(classType, '[dict dictionaryForKey:@"', key, '"]'),
                    ";"
                ),
            mapType => {
                const itemType = mapType.values;
                if (
                    itemType.isPrimitive() ||
                    // TODO once enums are supported, this will change
                    itemType.kind === "enum" ||
                    // Before union support, we have a lot of untyped data
                    // This ensures that we don't map over unknown elements
                    isAnyOrNull(itemType)
                ) {
                    // TODO check each value type
                    this.emitLine(name, ' = [dict dictionaryForKey:@"', key, '"];');
                } else {
                    this.emitLine(
                        name,
                        ' = [[dict dictionaryForKey:@"',
                        key,
                        '"] map:',
                        ["λ(id x, ", this.fromDynamicExpression(itemType, "x"), ")"],
                        "];"
                    );
                }
            },
            // TODO Support enums
            enumType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(enumType, '[dict stringForKey:@"', key, '"]'),
                    ";"
                ),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    this.ensureBlankLine();
                    // We used to have a NSNullOrNil macro to make this clearer, but we can rely on the
                    // the fact that [nil isNotEqualTo:[NSNull null]] is *false* to not use it
                    this.emitBlock(['if ([[dict objectForKey:@"', key, '"] isNotEqualTo:[NSNull null]])'], () => {
                        this.emitPropertyAssignment(propertyName, _json, nullable);
                    });
                    this.ensureBlankLine();
                } else {
                    // TODO This is a union, but for now we just leave it dynamic
                    this.emitLine(
                        name,
                        " = ",
                        this.fromDynamicExpression(unionType, '[dict objectForKey:@"', key, '"]'),
                        ";"
                    );
                }

                return nullable !== null ? this.objcType(nullable) : "id";
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
        return [name, " *", name, "FromData(NSData *data, NSError **error)"];
    }

    private topLevelFromJSONPrototype(name: Name): Sourcelike {
        return [name, " *", name, "FromJSON(NSString *json, NSStringEncoding encoding, NSError **error)"];
    }

    private topLevelToDataPrototype(name: Name): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        return ["NSData *", name, "ToData(", name, " *", parameter, ", NSError **error)"];
    }

    private topLevelToJSONPrototype(name: Name): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        return ["NSString *", name, "ToJSON(", name, " *", parameter, ", NSStringEncoding encoding, NSError **error)"];
    }

    private emitTopLevelFunctionDeclarations(_: Type, name: Name): void {
        this.emitExtraComments(name);
        this.emitLine(this.topLevelFromDataPrototype(name), ";");
        this.emitLine(this.topLevelFromJSONPrototype(name), ";");
        this.emitLine(this.topLevelToDataPrototype(name), ";");
        this.emitLine(this.topLevelToJSONPrototype(name), ";");
    }
    private emitTopLevelFunctions(t: Type, name: Name): void {
        const parameter = this.variableNameForTopLevel(name);

        this.ensureBlankLine();
        this.emitBlock(this.topLevelFromDataPrototype(name), () => {
            this.emitLine(
                this.pointerAwareTypeName(this.jsonType(t)),
                "json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];"
            );
            this.emitLine("return *error ? nil : ", this.fromDynamicExpression(t, "json"), ";");
        });

        this.ensureBlankLine();
        this.emitBlock(this.topLevelFromJSONPrototype(name), () => {
            this.emitLine("return ", name, "FromData([json dataUsingEncoding:encoding], error);");
        });

        this.ensureBlankLine();
        this.emitBlock(this.topLevelToDataPrototype(name), () => {
            this.emitLine(
                this.pointerAwareTypeName(this.jsonType(t)),
                "json = ",
                this.toDynamicExpression(t, parameter),
                ";"
            );
            this.emitLine(
                "NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];"
            );
            this.emitLine("return *error ? nil : data;");
        });

        this.ensureBlankLine();
        this.emitBlock(this.topLevelToJSONPrototype(name), () => {
            this.emitLine("NSData *data = ", name, "ToData(", parameter, ", error);");
            this.emitLine("return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;");
        });
    }

    private emitClassInterface = (t: ClassType, className: Name): void => {
        const isTopLevel = this.topLevels.valueSeq().contains(t);

        this.emitLine("@interface ", className, " : NSObject");
        this.forEachClassProperty(t, "none", (name, _json, propertyType) => {
            let attributes = ["nonatomic"];
            // TODO offer a 'readonly' option
            // TODO We must add "copy" if it's NSCopy, otherwise "strong"
            if (propertyType.isNullable) {
                attributes.push("nullable");
            }
            this.emitLine(
                "@property ",
                ["(", attributes.join(", "), ")"],
                " ",
                this.pointerAwareTypeName(propertyType),
                name,
                ";"
            );
        });

        if (!this._justTypes && isTopLevel) {
            if (t.properties.count() > 0) this.ensureBlankLine();

            this.emitLine("+ (_Nullable instancetype)fromJSON:(NSString *)json;");
            this.emitLine(
                "+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;"
            );
            this.emitLine("+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;");
            this.emitLine("- (NSString *_Nullable)toJSON;");
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
        this.emitLine("@implementation ", className);

        let propertyNames: Sourcelike[] = [];
        this.forEachClassProperty(t, "none", name => {
            if (propertyNames.length !== 0) {
                propertyNames.push(", ");
            }
            propertyNames.push(name);

            if (propertyNames.length === 5 * 2 - 1) {
                this.emitLine("@synthesize ", propertyNames, ";");
                propertyNames = [];
            }
        });
        if (propertyNames.length !== 0) {
            this.emitLine("@synthesize ", propertyNames, ";");
        }

        if (!this._justTypes) {
            this.ensureBlankLine();
            if (isTopLevel) {
                this.emitBlock(
                    "+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error",
                    () => {
                        this.emitLine("return ", className, "FromData(data, error);");
                    }
                );
                this.ensureBlankLine();
                this.emitBlock(
                    "+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;",
                    () => {
                        this.emitLine("return ", className, "FromJSON(json, encoding, error);");
                    }
                );
                this.ensureBlankLine();
                this.emitBlock("+ (_Nullable instancetype)fromJSON:(NSString *)json", () => {
                    this.emitLine("NSError *error;");
                    this.emitLine("return ", className, "FromJSON(json, NSUTF8StringEncoding, &error);");
                });
            }

            this.ensureBlankLine();
            this.emitBlock("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict", () => {
                this.emitLine("return [[", className, " alloc] initWithJSONDictionary:dict];");
            });
            this.ensureBlankLine();
            this.emitBlock("- (instancetype)initWithJSONDictionary:(NSDictionary *)dict", () => {
                this.emitBlock("if (self = [super init])", () => {
                    this.forEachClassProperty(t, "none", this.emitPropertyAssignment);
                });
                this.emitLine("return self;");
            });
            this.ensureBlankLine();
            this.emitBlock("- (NSDictionary *)JSONDictionary", () => {
                this.emitLine("return @{");
                this.indent(() => {
                    this.forEachClassProperty(t, "none", (propertyName, jsonKey, propertyType) => {
                        const key = stringEscape(jsonKey);
                        const name = this.safePropertyName(propertyName);
                        this.emitLine('@"', key, '": ', this.toDynamicExpression(propertyType, name), ",");
                    });
                });
                this.emitLine("};");
            });

            if (isTopLevel) {
                this.ensureBlankLine();
                this.emitBlock(`- (NSData *_Nullable)toData:(NSError *_Nullable *)error`, () => {
                    this.emitLine("return ", className, "ToData(self, error);");
                });
                this.ensureBlankLine();
                this.emitBlock(
                    `- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error`,
                    () => {
                        this.emitLine("return ", className, "ToJSON(self, encoding, error);");
                    }
                );
                this.ensureBlankLine();
                this.emitBlock(`- (NSString *_Nullable)toJSON`, () => {
                    this.emitLine("NSError *error;");
                    this.emitLine("return ", className, "ToJSON(self, NSUTF8StringEncoding, &error);");
                });
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

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        } else if (!this._justTypes && !this._features.interface) {
            this.emitLine("// Remember to import the companion header like:");
            this.emitLine("// ");
            this.emitLine('//   #import "', this._classPrefix, 'Header.h"');
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

        if (this._features.interface) {
            if (this._features.implementation) {
                this.emitMark("Types");
            }

            this.ensureBlankLine();
            this.emitExtraComments("This clarifies which properties are JSON booleans");
            this.emitLine("typedef NSNumber NSBoolean;");

            // Emit @class declarations for top-level array+maps and classes
            this.ensureBlankLine();
            this.forEachClass("none", (_, name) => this.emitLine("@class ", name, ";"));
            this.ensureBlankLine();

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_BEGIN");
            this.ensureBlankLine();

            // Emit interfaces for top-level array+maps and classes
            this.forEachTopLevel(
                "leading-and-interposing",
                (t, n) => this.emitNonClassTopLevelTypedef(t, n),
                t => !(t instanceof ClassType)
            );

            if (!this._justTypes) {
                this.emitMark("Top-level marshalling functions");
                this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitTopLevelFunctionDeclarations(t, n));
            }
            this.forEachNamedType("leading-and-interposing", this.emitClassInterface, () => null, () => null);

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_END");
        }

        if (this._features.implementation) {
            if (this._features.interface) {
                this.emitMark("Implementation");
            }
            if (!this._justTypes) {
                this.emitExtraComments("Shorthand for simple blocks");
                this.emitLine(`#define λ(decl, expr) (^(decl) { return (expr); })`);
                this.emitLine("#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])");

                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_BEGIN");
                this.ensureBlankLine();

                this.emitDictionaryAndArrayExtensions();

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

                this.emitMark("JSON serialization implementations");
                this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitTopLevelFunctions(t, n));
            }

            this.forEachNamedType("leading-and-interposing", this.emitClassImplementation, () => null, () => null);

            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_END");
            }
        }
    }

    private emitDictionaryAndArrayExtensions = () => {
        this.emitMultiline(`@implementation NSArray (JSONConversion)
- (NSArray *)map:(id (^)(id element))f {
    id result = [NSMutableArray arrayWithCapacity:self.count];
    for (id x in self) [result addObject:f(x)];
    return result;
}
@end

@implementation NSDictionary (JSONConversion)
- (NSDictionary *)map:(id (^)(id value))f {
    id result = [NSMutableDictionary dictionaryWithCapacity:self.count];
    for (id key in self) [result setObject:f([self objectForKey:key]) forKey:key];
    return result;
}

- (NSException *)exceptionForKey:(id)key type:(NSString *)type {
    return [NSException exceptionWithName:@"TypeException"
                                    reason:[NSString stringWithFormat:@"Expected a %@", type]
                                    userInfo:@{ @"dictionary":self, @"key":key }];
}

- (NSString *)stringForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSString class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"string"];
    }
}

- (NSNumber *)numberForKey:(NSString *)key {
    id value = [self objectForKey:key];
    // TODO Could this check be more precise?
    if ([value isKindOfClass:[NSNumber class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"number"];
    }
}

- (NSBoolean *)boolForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isEqual:@(YES)] || [value isEqual:@(NO)]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"bool"];
    }
}

- (NSArray *)arrayForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSArray class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"array"];
    }
}

- (NSDictionary *)dictionaryForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:[NSDictionary class]]) {
        return value;
    } else {
        @throw [self exceptionForKey:key type:@"dictionary"];
    }
}
@end`);
    };
}
