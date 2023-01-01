import { iterableSome, iterableFirst, mapContains, mapFirst, mapSome } from "collection-utils";

import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, ArrayType, MapType, UnionType, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, isAnyOrNull } from "../TypeUtils";
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
    stringEscape,
    addPrefixIfNecessary,
    repeatString,
    fastIsUpperCase
} from "../support/Strings";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { StringOption, BooleanOption, EnumOption, Option, getOptionValues, OptionValues } from "../RendererOptions";
import { assert, defined } from "../support/Support";
import { RenderContext } from "../Renderer";

const unicode = require("@mark.probst/unicode-properties");

export type MemoryAttribute = "assign" | "strong" | "copy";
export type OutputFeatures = { interface: boolean; implementation: boolean };

const DEBUG = false;
const DEFAULT_CLASS_PREFIX = "QT";

export const objcOptions = {
    features: new EnumOption("features", "Interface and implementation", [
        ["all", { interface: true, implementation: true }],
        ["interface", { interface: true, implementation: false }],
        ["implementation", { interface: false, implementation: true }]
    ]),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    marshallingFunctions: new BooleanOption("functions", "C-style functions", false),
    classPrefix: new StringOption("class-prefix", "Class prefix", "PREFIX", DEFAULT_CLASS_PREFIX),
    extraComments: new BooleanOption("extra-comments", "Extra comments", false)
};

export class ObjectiveCTargetLanguage extends TargetLanguage {
    constructor() {
        super("Objective-C", ["objc", "objective-c", "objectivec"], "m");
    }

    protected getOptions(): Option<any>[] {
        return [
            objcOptions.justTypes,
            objcOptions.classPrefix,
            objcOptions.features,
            objcOptions.extraComments,
            objcOptions.marshallingFunctions
        ];
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): ObjectiveCRenderer {
        return new ObjectiveCRenderer(this, renderContext, getOptionValues(objcOptions, untypedOptionValues));
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
    return addPrefixIfNecessary(prefix, result);
}

function propertyNameStyle(original: string, isBool: boolean = false): string {
    // Objective-C developers are uncomfortable with property "id"
    // so we use an alternate name in this special case.
    if (original === "id") {
        original = "identifier";
    }

    let words = splitIntoWords(original);

    if (isBool) {
        if (words.length === 0) {
            words = [{ word: "flag", isAcronym: false }];
        } else if (!words[0].isAcronym && booleanPrefixes.indexOf(words[0].word) < 0) {
            words = [{ word: "is", isAcronym: false }, ...words];
        }
    }

    // Properties cannot even begin with any of the forbidden names
    // For example, properies named new* are treated differently by ARC
    if (words.length > 0 && forbiddenPropertyNames.indexOf(words[0].word) >= 0) {
        words = [{ word: "the", isAcronym: false }, ...words];
    }

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

const forbiddenPropertyNames = [
    "id",
    "hash",
    "description",
    "init",
    "copy",
    "mutableCopy",
    "superclass",
    "debugDescription",
    "new"
];

const booleanPrefixes = [
    "is",
    "are",
    "were",
    "was",
    "will",
    "all",
    "some",
    "many",
    "has",
    "have",
    "had",
    "does",
    "do",
    "requires",
    "require",
    "needs",
    "need"
];

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

const staticEnumValuesIdentifier = "values";
const forbiddenForEnumCases = ["new", staticEnumValuesIdentifier];

function splitExtension(filename: string): [string, string] {
    const i = filename.lastIndexOf(".");
    const extension = i !== -1 ? filename.split(".").pop() : "m";
    filename = i !== -1 ? filename.slice(0, i) : filename;
    return [filename, extension === undefined ? "m" : extension];
}

export class ObjectiveCRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;
    private readonly _classPrefix: string;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof objcOptions>
    ) {
        super(targetLanguage, renderContext);

        // Infer the class prefix from a top-level name if it's not given
        if (_options.classPrefix === DEFAULT_CLASS_PREFIX) {
            const aTopLevel = defined(iterableFirst(this.topLevels.keys()));
            this._classPrefix = this.inferClassPrefix(aTopLevel);
        } else {
            this._classPrefix = _options.classPrefix;
        }
    }

    private inferClassPrefix(name: string): string {
        const l = name.length;
        let firstNonUpper = 0;
        while (firstNonUpper < l && fastIsUpperCase(name.charCodeAt(firstNonUpper))) {
            firstNonUpper += 1;
        }
        if (firstNonUpper < 2) return DEFAULT_CLASS_PREFIX;
        return name.slice(0, firstNonUpper - 1);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: forbiddenPropertyNames, includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: forbiddenForEnumCases, includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", rawName => typeNameStyle(this._classPrefix, rawName));
    }

    protected namerForObjectProperty(_: ClassType, p: ClassProperty): Namer {
        // TODO why is underscore being removed?
        return new Namer("properties", s => propertyNameStyle(s, p.type.kind === "bool"), [
            "_",
            "the",
            "one",
            "some",
            "another"
        ]);
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", propertyNameStyle, []);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return type;
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, "/// ");
    }

    protected emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitMethod(declaration: Sourcelike, f: () => void) {
        this.emitLine(declaration);
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}");
    }

    protected emitExtraComments(...comments: Sourcelike[]) {
        if (!this._options.extraComments) return;
        for (const comment of comments) {
            this.emitLine("// ", comment);
        }
    }

    protected startFile(basename: Sourcelike, extension: string): void {
        assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.${extension}`;
    }

    protected finishFile(): void {
        super.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected memoryAttribute(t: Type, isNullable: boolean): MemoryAttribute {
        return matchType<MemoryAttribute>(
            t,
            _anyType => "copy",
            _nullType => "copy",
            _boolType => (isNullable ? "strong" : "assign"),
            _integerType => (isNullable ? "strong" : "assign"),
            _doubleType => (isNullable ? "strong" : "assign"),
            _stringType => "copy",
            _arrayType => "copy",
            _classType => "strong",
            _mapType => "copy",
            _enumType => "assign",
            unionType => {
                const nullable = nullableFromUnion(unionType);
                return nullable !== null ? this.memoryAttribute(nullable, true) : "copy";
            }
        );
    }

    protected objcType(t: Type, nullableOrBoxed: boolean = false): [Sourcelike, string] {
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
    }

    private jsonType(t: Type): [Sourcelike, string] {
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
    }

    protected fromDynamicExpression(t: Type, ...dynamic: Sourcelike[]): Sourcelike {
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
    }

    protected toDynamicExpression(t: Type, typed: Sourcelike): Sourcelike {
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
                if (this.implicitlyConvertsFromJSON(arrayType)) {
                    // TODO check each value type
                    return typed;
                }
                return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(arrayType.items, "x"), "))"];
            },
            _classType => ["[", typed, " JSONDictionary]"],
            mapType => {
                if (this.implicitlyConvertsFromJSON(mapType)) {
                    // TODO check each value type
                    return typed;
                }
                return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(mapType.values, "x"), "))"];
            },
            _enumType => ["[", typed, " value]"],
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) {
                    if (this.implicitlyConvertsFromJSON(nullable)) {
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
    }

    protected implicitlyConvertsFromJSON(t: Type): boolean {
        if (t instanceof ClassType) {
            return false;
        } else if (t instanceof EnumType) {
            return false;
        } else if (t instanceof ArrayType) {
            return this.implicitlyConvertsFromJSON(t.items);
        } else if (t instanceof MapType) {
            return this.implicitlyConvertsFromJSON(t.values);
        } else if (t.isPrimitive()) {
            return true;
        } else if (t instanceof UnionType) {
            const nullable = nullableFromUnion(t);
            if (nullable !== null) {
                return this.implicitlyConvertsFromJSON(nullable);
            } else {
                // We don't support unions yet, so this is just untyped
                return true;
            }
        } else {
            return false;
        }
    }

    protected implicitlyConvertsToJSON(t: Type): boolean {
        return this.implicitlyConvertsFromJSON(t) && "bool" !== t.kind;
    }

    protected emitPropertyAssignment(propertyName: Name, jsonName: string, propertyType: Type) {
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
    }

    protected emitPrivateClassInterface(_: ClassType, name: Name): void {
        this.emitLine("@interface ", name, " (JSONConversion)");
        this.emitLine("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;");
        this.emitLine("- (NSDictionary *)JSONDictionary;");
        this.emitLine("@end");
    }

    protected pointerAwareTypeName(t: Type | [Sourcelike, string]): Sourcelike {
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
        const padding = pad ? repeatString(" ", this.sourcelikeToString(name).length - "NSData".length) : "";
        return ["NSData", padding, " *_Nullable ", name, "ToData(", name, " *", parameter, ", NSError **error)"];
    }

    private topLevelToJSONPrototype(name: Name, pad: boolean = false): Sourcelike {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? repeatString(" ", this.sourcelikeToString(name).length - "NSString".length) : "";
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

    private emitClassInterface(t: ClassType, className: Name): void {
        const isTopLevel = mapContains(this.topLevels, t);

        this.emitDescription(this.descriptionForType(t));

        this.emitLine("@interface ", className, " : NSObject");
        if (DEBUG) this.emitLine("@property NSDictionary<NSString *, id> *_json;");
        this.emitPropertyTable(t, (name, _json, property) => {
            let attributes = ["nonatomic"];
            // TODO offer a 'readonly' option
            // TODO We must add "copy" if it's NSCopy, otherwise "strong"
            if (property.type.isNullable) {
                attributes.push("nullable");
            }
            attributes.push(this.memoryAttribute(property.type, property.type.isNullable));
            return [
                ["@property ", ["(", attributes.join(", "), ")"], " "],
                [this.pointerAwareTypeName(property.type), name, ";"]
            ];
        });

        if (!this._options.justTypes && isTopLevel) {
            if (t.getProperties().size > 0) this.ensureBlankLine();

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
    }

    protected hasIrregularProperties(t: ClassType) {
        let irregular = false;
        this.forEachClassProperty(t, "none", (name, jsonName) => {
            irregular = irregular || stringEscape(jsonName) !== this.sourcelikeToString(name);
        });
        return irregular;
    }

    protected hasUnsafeProperties(t: ClassType) {
        let unsafe = false;
        this.forEachClassProperty(t, "none", (_, __, property) => {
            unsafe = unsafe || !this.implicitlyConvertsToJSON(property.type);
        });
        return unsafe;
    }

    // TODO Implement NSCopying
    private emitClassImplementation(t: ClassType, className: Name): void {
        const isTopLevel = mapContains(this.topLevels, t);

        const hasIrregularProperties = this.hasIrregularProperties(t);
        const hasUnsafeProperties = this.hasUnsafeProperties(t);

        this.emitLine("@implementation ", className);
        if (!this._options.justTypes) {
            this.emitMethod("+ (NSDictionary<NSString *, NSString *> *)properties", () => {
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
                        if (!this.implicitlyConvertsFromJSON(property.type)) {
                            this.emitPropertyAssignment(name, jsonName, property.type);
                        }
                    });
                });
                this.emitLine("return self;");
            });

            this.ensureBlankLine();
            this.emitMethod("- (void)setValue:(nullable id)value forKey:(NSString *)key", () => {
                this.emitLine("id resolved = ", className, ".properties[key];");
                this.emitLine("if (resolved) [super setValue:value forKey:resolved];");
            });

            // setNilValueForKey: is automatically invoked by the NSObject setValue:forKey: when it is passed nil for a scalar (a.k.a. non-nullable) object
            // The approach below sets the scalar to 0 in this case, and therefore assumes an initializer with incomplete data shouldn't be grounds for raising an exception.
            // Put another way, if the initializer didn't have a key at all, there wouldn't be an exception raised, so sending nil for something probably shouldn't cause one.
            this.ensureBlankLine();
            this.emitMethod("- (void)setNilValueForKey:(NSString *)key", () => {
                this.emitLine("id resolved = ", className, ".properties[key];");
                this.emitLine("if (resolved) [super setValue:@(0) forKey:resolved];");
            });

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
                            if (!this.implicitlyConvertsToJSON(property.type)) {
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
    }

    protected emitMark(label: string) {
        this.ensureBlankLine();
        this.emitLine(`#pragma mark - ${label}`);
        this.ensureBlankLine();
    }

    protected variableNameForTopLevel(name: Name): Sourcelike {
        const camelCaseName = modifySource(serialized => {
            // 1. remove class prefix
            serialized = serialized.slice(this._classPrefix.length);
            // 2. camel case
            return camelCase(serialized);
        }, name);
        return camelCaseName;
    }

    private emitPseudoEnumInterface(enumType: EnumType, enumName: Name) {
        this.emitDescription(this.descriptionForType(enumType));

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

    protected emitSourceStructure(proposedFilename: string): void {
        const fileMode = proposedFilename !== "stdout";
        if (!fileMode) {
            // We don't have a filename, so we use a top-level name
            const firstTopLevel = defined(mapFirst(this.topLevels));
            proposedFilename = this.sourcelikeToString(this.nameForNamedType(firstTopLevel)) + ".m";
        }
        const [filename, extension] = splitExtension(proposedFilename);

        if (this._options.features.interface) {
            this.startFile(filename, "h");

            if (this.leadingComments !== undefined) {
                this.emitCommentLines(this.leadingComments);
            } else if (!this._options.justTypes) {
                this.emitCommentLines(["To parse this JSON:", ""]);
                this.emitLine("//   NSError *error;");
                this.forEachTopLevel("none", (t, topLevelName) => {
                    const fromJsonExpression =
                        t instanceof ClassType
                            ? ["[", topLevelName, " fromJSON:json encoding:NSUTF8Encoding error:&error];"]
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
                (_: ClassType, className: Name) => this.emitLine("@class ", className, ";"),
                (_, enumName) => this.emitLine("@class ", enumName, ";"),
                () => null
            );
            this.ensureBlankLine();

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_BEGIN");
            this.ensureBlankLine();

            if (this.haveEnums) {
                this.emitMark("Boxed enums");
                this.forEachEnum("leading-and-interposing", (t, n) => this.emitPseudoEnumInterface(t, n));
            }

            // Emit interfaces for top-level array+maps and classes
            this.forEachTopLevel(
                "leading-and-interposing",
                (t, n) => this.emitNonClassTopLevelTypedef(t, n),
                t => !(t instanceof ClassType)
            );

            const hasTopLevelNonClassTypes = iterableSome(this.topLevels, ([_, t]) => !(t instanceof ClassType));
            if (!this._options.justTypes && (hasTopLevelNonClassTypes || this._options.marshallingFunctions)) {
                this.ensureBlankLine();
                this.emitMark("Top-level marshaling functions");
                this.forEachTopLevel(
                    "leading-and-interposing",
                    (t, n) => this.emitTopLevelFunctionDeclarations(t, n),
                    // Objective-C developers get freaked out by C functions, so we don't
                    // declare them for top-level object types (we always need them for non-object types)
                    t => this._options.marshallingFunctions || !(t instanceof ClassType)
                );
            }

            this.emitMark("Object interfaces");
            this.forEachNamedType("leading-and-interposing", (c: ClassType, className: Name) => this.emitClassInterface(c, className), () => null, () => null);

            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_END");
            this.finishFile();
        }

        if (this._options.features.implementation) {
            this.startFile(filename, extension);

            this.emitLine(`#import "${filename}.h"`);
            this.ensureBlankLine();

            if (!this._options.justTypes) {
                this.ensureBlankLine();
                this.emitExtraComments("Shorthand for simple blocks");
                this.emitLine(`#define λ(decl, expr) (^(decl) { return (expr); })`);
                this.ensureBlankLine();
                this.emitExtraComments("nil → NSNull conversion for JSON dictionaries");
                this.emitBlock("static id NSNullify(id _Nullable x)", () =>
                    this.emitLine("return (x == nil || x == NSNull.null) ? NSNull.null : x;")
                );
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_BEGIN");
                this.ensureBlankLine();

                // We wouldn't need to emit these private iterfaces if we emitted implementations in forward-order
                // but the code is more readable and explicit if we do this.
                if (this._options.extraComments) {
                    this.emitMark("Private model interfaces");
                }

                this.forEachNamedType(
                    "leading-and-interposing",
                    (c: ClassType, className: Name) => this.emitPrivateClassInterface(c, className),
                    () => null,
                    () => null
                );

                if (this.haveEnums) {
                    if (this._options.extraComments) {
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

                this.emitMark("JSON serialization");
                this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitTopLevelFunctions(t, n));
            }

            this.forEachNamedType("leading-and-interposing", (c: ClassType, className: Name) => this.emitClassImplementation(c, className), () => null, () => null);

            if (!this._options.justTypes) {
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
                (t instanceof ClassType && mapSome(t.getProperties(), p => needsMap(p.type)))
            );
        }
        return iterableSome(this.typeGraph.allTypesUnordered(), needsMap);
    }

    protected emitMapFunction() {
        if (this.needsMap) {
            this.emitMultiline(`static id map(id collection, id (^f)(id value)) {
    id result = nil;
    if ([collection isKindOfClass:NSArray.class]) {
        result = [NSMutableArray arrayWithCapacity:[collection count]];
        for (id x in collection) [result addObject:f(x)];
    } else if ([collection isKindOfClass:NSDictionary.class]) {
        result = [NSMutableDictionary dictionaryWithCapacity:[collection count]];
        for (id key in collection) [result setObject:f([collection objectForKey:key]) forKey:key];
    }
    return result;
}`);
        }
    }
}
