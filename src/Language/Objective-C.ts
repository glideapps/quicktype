"use strict";

import { includes, startsWith, repeat } from "lodash";
import * as pluralize from "pluralize";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, nullableFromUnion, matchType, ArrayType, MapType, UnionType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Namespace, Name, Namer, funPrefixNamer, keywordNamespace } from "../Naming";
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
import { Set } from "immutable";

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

class ObjectiveCRenderer extends ConvenienceRenderer {
    // enums contained in NSArray or NSDictionary are represented
    // as 'pseudo-enum' reference types. Eventually we may want to
    // support 'natural' enums (NSUInteger) but this isn't implemented yet.
    pseudoEnums: Set<EnumType>;

    private _propertyForbiddenNamespace: Namespace;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _classPrefix: string,
        private readonly _features: OutputFeatures,
        private readonly _extraComments: boolean
    ) {
        super(graph, leadingComments);

        this.pseudoEnums = graph
            .allTypesUnordered()
            .filter(t => t instanceof EnumType && this.enumOccursInArrayOrMap(t))
            .map(t => t as EnumType);
    }

    protected setUpNaming(): Namespace[] {
        this._propertyForbiddenNamespace = keywordNamespace("forbidden-for-properties", forbiddenPropertyNames);
        return super.setUpNaming().concat([this._propertyForbiddenNamespace]);
    }

    private enumOccursInArrayOrMap(enumType: EnumType): boolean {
        function containedBy(t: Type): boolean {
            return (
                (t instanceof ArrayType && t.items.equals(enumType)) ||
                (t instanceof MapType && t.values.equals(enumType)) ||
                (t instanceof ClassType && t.properties.some(containedBy)) ||
                // TODO support unions
                (t instanceof UnionType && false)
            );
        }
        return this.typeGraph.allTypesUnordered().some(containedBy);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(
        _c: ClassType,
        _classNamed: Name
    ): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.forbiddenWordsNamespace, this._propertyForbiddenNamespace] };
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
            enumType => [this.nameForNamedType(enumType), " *"],
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
            enumType => ["NotNil([", this.nameForNamedType(enumType), " withValue:", dynamic, "])"],
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
            _boolType => typed,
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
        } else {
            return false;
        }
    }

    private emitPropertyAssignment = (propertyName: Name, _json: string, propertyType: Type) => {
        const key = stringEscape(_json);
        const name = ["_", propertyName];
        matchType(
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
                    this.fromDynamicExpression(nullType, '[dict objectForKey:@"', key, '" withClass:[NSNull class]]'),
                    ";"
                ),
            boolType =>
                this.emitLine(name, " = ", this.fromDynamicExpression(boolType, '[dict boolForKey:@"', key, '"]'), ";"),
            integerType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(
                        integerType,
                        '[dict objectForKey:@"',
                        key,
                        '" withClass:[NSNumber class]]'
                    ),
                    ";"
                ),
            doubleType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(
                        doubleType,
                        '[dict objectForKey:@"',
                        key,
                        '" withClass:[NSNumber class]]'
                    ),
                    ";"
                ),
            stringType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(
                        stringType,
                        '[dict objectForKey:@"',
                        key,
                        '" withClass:[NSString class]]'
                    ),
                    ";"
                ),
            arrayType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(arrayType, '[dict objectForKey:@"', key, '" withClass:[NSArray class]]'),
                    ";"
                ),
            classType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(
                        classType,
                        '[dict objectForKey:@"',
                        key,
                        '" withClass:[NSDictionary class]]'
                    ),
                    ";"
                ),
            mapType => {
                const itemType = mapType.values;
                if (
                    itemType.isPrimitive() ||
                    // Before union support, we have a lot of untyped data
                    // This ensures that we don't map over unknown elements
                    isAnyOrNull(itemType)
                ) {
                    // TODO check each value type
                    this.emitLine(name, ' = [dict objectForKey:@"', key, '" withClass:[NSDictionary class]];');
                } else {
                    this.emitLine(
                        name,
                        ' = map([dict objectForKey:@"',
                        key,
                        '" withClass:[NSDictionary class]], ',
                        ["λ(id x, ", this.fromDynamicExpression(itemType, "x"), ")"],
                        ");"
                    );
                }
            },
            enumType =>
                this.emitLine(
                    name,
                    " = ",
                    this.fromDynamicExpression(enumType, '[dict objectForKey:@"', key, '" withClass:[NSString class]]'),
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

    private topLevelToDataPrototype(name: Name, pad: boolean = false): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? repeat(" ", this.sourcelikeToString(name).length - "NSData".length) : "";
        return ["NSData", padding, " *", name, "ToData(", name, " *", parameter, ", NSError **error)"];
    }

    private topLevelToJSONPrototype(name: Name, pad: boolean = false): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? repeat(" ", this.sourcelikeToString(name).length - "NSString".length) : "";
        return [
            "NSString",
            padding,
            " *",
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
        this.emitBlock(this.topLevelFromDataPrototype(name), () => {
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
        this.emitBlock(this.topLevelFromJSONPrototype(name), () => {
            this.emitLine("return ", name, "FromData([json dataUsingEncoding:encoding], error);");
        });

        this.ensureBlankLine();
        this.emitBlock(this.topLevelToDataPrototype(name), () => {
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
        this.emitLine("@implementation ", className);
        if (!this._justTypes) {
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
            }

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
                        const name = ["_", propertyName];
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
        this.emitLine();

        const instances = modifySource(
            s => pluralize.plural(this._classPrefix.toLocaleLowerCase() + s.substring(this._classPrefix.length)),
            enumName
        );

        this.emitLine("static NSMutableDictionary<NSString *, ", enumName, " *> *", instances, ";");

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

        this.emitMethod("+ (void)initialize", () => {
            this.emitLine("NSArray<NSString *> *values = @[");
            this.indent(() => {
                this.forEachEnumCase(enumType, "none", (_, jsonValue) => {
                    this.emitLine('@"', stringEscape(jsonValue), '",');
                });
            });
            this.emitLine("];");
            this.emitLine(instances, " = [NSMutableDictionary dictionaryWithCapacity:values.count];");
            this.emitLine(
                "for (NSString *value in values) ",
                instances,
                "[value] = [[",
                enumName,
                " alloc] initWithValue:value];"
            );
        });
        this.ensureBlankLine();

        this.emitLine("+ (instancetype _Nullable)withValue:(NSString *)value { return ", instances, "[value]; }");

        this.ensureBlankLine();
        this.emitMethod("- (instancetype)initWithValue:(NSString *)value", () => {
            this.emitLine("if (self = [super init]) _value = value;");
            this.emitLine("return self;");
        });
        this.ensureBlankLine();

        this.emitLine("- (NSUInteger)hash { return _value.hash; }");
        this.emitLine("@end");
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

        if (!this._features.implementation) {
            this.ensureBlankLine();
            this.emitLine(`#import <Foundation/Foundation.h>`);
            this.ensureBlankLine();
        }

        if (this._features.interface) {
            if (this._features.implementation) {
                this.emitMark("Types");
            }

            this.ensureBlankLine();
            this.emitExtraComments("This clarifies which properties are JSON booleans");
            this.emitLine("typedef NSNumber NSBoolean;");

            // Emit @class declarations for top-level array+maps and classes
            this.ensureBlankLine();
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
            if (!this._justTypes && hasTopLevelNonClassTypes) {
                this.ensureBlankLine();
                this.emitExtraComments("Marshalling functions for non-object top-level types.");
                this.forEachTopLevel(
                    "leading-and-interposing",
                    (t, n) => this.emitTopLevelFunctionDeclarations(t, n),
                    // Objective-C developers get freaked out by C functions, so we don't
                    // declare them for top-level object types (we always need them for non-object types)
                    t => !(t instanceof ClassType)
                );
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
                this.emitLine();
                this.emitExtraComments("NSNull → nil conversion and assertion");
                this.emitLine("#define NSNullify(x) ([x isNotEqualTo:[NSNull null]] ? x : [NSNull null])");
                this.emitLine(`#define NotNil(x) (x ? x : throw(@"Unexpected nil"))`);
                this.emitLine();
                this.emitExtraComments(
                    "Allows us to create throw expressions.",
                    "",
                    "Although exceptions are rarely used in Objective-C, they're used internally",
                    "here to short-circuit recursive JSON processing, then caught at the API",
                    "boundary and convered to NSError."
                );
                this.emitMultiline(`static id _Nullable throw(NSString * _Nullable reason) {
    @throw [NSException exceptionWithName:@"JSONSerialization" reason:reason userInfo:nil];
    return nil;
}`);
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

                this.emitMark("Pseudo-enum implementations");

                this.forEachEnum("leading-and-interposing", (t, n) => this.emitPseudoEnumImplementation(t, n));

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
}

@implementation NSDictionary (JSONConversion)
- (id)objectForKey:(NSString *)key withClass:(Class)cls {
    id value = [self objectForKey:key];
    if ([value isKindOfClass:cls]) return value;
    else return throw([NSString stringWithFormat:@"Expected a %@", cls]);
}

- (NSBoolean *)boolForKey:(NSString *)key {
    id value = [self objectForKey:key];
    if ([value isEqual:@YES] || [value isEqual:@NO]) return value;
    else return throw(@"Expected bool");
}
@end`);
    };
}
