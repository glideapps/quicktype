"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TargetLanguage_1 = require("../TargetLanguage");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Naming_1 = require("../Naming");
const Source_1 = require("../Source");
const Strings_1 = require("../support/Strings");
const ConvenienceRenderer_1 = require("../ConvenienceRenderer");
const RendererOptions_1 = require("../RendererOptions");
const Support_1 = require("../support/Support");
const unicode = require("@mark.probst/unicode-properties");
const DEBUG = false;
const DEFAULT_CLASS_PREFIX = "QT";
exports.objcOptions = {
    features: new RendererOptions_1.EnumOption("features", "Interface and implementation", [
        ["all", { interface: true, implementation: true }],
        ["interface", { interface: true, implementation: false }],
        ["implementation", { interface: false, implementation: true }]
    ]),
    justTypes: new RendererOptions_1.BooleanOption("just-types", "Plain types only", false),
    marshallingFunctions: new RendererOptions_1.BooleanOption("functions", "C-style functions", false),
    classPrefix: new RendererOptions_1.StringOption("class-prefix", "Class prefix", "PREFIX", DEFAULT_CLASS_PREFIX),
    extraComments: new RendererOptions_1.BooleanOption("extra-comments", "Extra comments", false)
};
class ObjectiveCTargetLanguage extends TargetLanguage_1.TargetLanguage {
    constructor() {
        super("Objective-C", ["objc", "objective-c", "objectivec"], "m");
    }
    getOptions() {
        return [
            exports.objcOptions.justTypes,
            exports.objcOptions.classPrefix,
            exports.objcOptions.features,
            exports.objcOptions.extraComments,
            exports.objcOptions.marshallingFunctions
        ];
    }
    makeRenderer(renderContext, untypedOptionValues) {
        return new ObjectiveCRenderer(this, renderContext, RendererOptions_1.getOptionValues(exports.objcOptions, untypedOptionValues));
    }
}
exports.ObjectiveCTargetLanguage = ObjectiveCTargetLanguage;
function typeNameStyle(prefix, original) {
    const words = Strings_1.splitIntoWords(original);
    const result = Strings_1.combineWords(words, legalizeName, Strings_1.firstUpperWordStyle, Strings_1.firstUpperWordStyle, Strings_1.allUpperWordStyle, Strings_1.allUpperWordStyle, "", isStartCharacter);
    return Strings_1.addPrefixIfNecessary(prefix, result);
}
function propertyNameStyle(original, isBool = false) {
    // Objective-C developers are uncomfortable with property "id"
    // so we use an alternate name in this special case.
    if (original === "id") {
        original = "identifier";
    }
    let words = Strings_1.splitIntoWords(original);
    if (isBool) {
        if (words.length === 0) {
            words = [{ word: "flag", isAcronym: false }];
        }
        else if (!words[0].isAcronym && booleanPrefixes.indexOf(words[0].word) < 0) {
            words = [{ word: "is", isAcronym: false }, ...words];
        }
    }
    // Properties cannot even begin with any of the forbidden names
    // For example, properies named new* are treated differently by ARC
    if (words.length > 0 && forbiddenPropertyNames.indexOf(words[0].word) >= 0) {
        words = [{ word: "the", isAcronym: false }, ...words];
    }
    return Strings_1.combineWords(words, legalizeName, Strings_1.allLowerWordStyle, Strings_1.firstUpperWordStyle, Strings_1.allLowerWordStyle, Strings_1.allUpperWordStyle, "", isStartCharacter);
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
function isStartCharacter(utf16Unit) {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}
function isPartCharacter(utf16Unit) {
    const category = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}
const legalizeName = Strings_1.utf16LegalizeCharacters(isPartCharacter);
const staticEnumValuesIdentifier = "values";
const forbiddenForEnumCases = ["new", staticEnumValuesIdentifier];
function splitExtension(filename) {
    const i = filename.lastIndexOf(".");
    const extension = i !== -1 ? filename.split(".").pop() : "m";
    filename = i !== -1 ? filename.substr(0, i) : filename;
    return [filename, extension === undefined ? "m" : extension];
}
class ObjectiveCRenderer extends ConvenienceRenderer_1.ConvenienceRenderer {
    constructor(targetLanguage, renderContext, _options) {
        super(targetLanguage, renderContext);
        this._options = _options;
        // Infer the class prefix from a top-level name if it's not given
        if (_options.classPrefix === DEFAULT_CLASS_PREFIX) {
            const aTopLevel = Support_1.defined(collection_utils_1.iterableFirst(this.topLevels.keys()));
            this._classPrefix = this.inferClassPrefix(aTopLevel);
        }
        else {
            this._classPrefix = _options.classPrefix;
        }
    }
    inferClassPrefix(name) {
        const l = name.length;
        let firstNonUpper = 0;
        while (firstNonUpper < l && Strings_1.fastIsUpperCase(name.charCodeAt(firstNonUpper))) {
            firstNonUpper += 1;
        }
        if (firstNonUpper < 2)
            return DEFAULT_CLASS_PREFIX;
        return name.substr(0, firstNonUpper - 1);
    }
    forbiddenNamesForGlobalNamespace() {
        return keywords;
    }
    forbiddenForObjectProperties(_c, _className) {
        return { names: forbiddenPropertyNames, includeGlobalForbidden: true };
    }
    forbiddenForEnumCases(_e, _enumName) {
        return { names: forbiddenForEnumCases, includeGlobalForbidden: true };
    }
    makeNamedTypeNamer() {
        return Naming_1.funPrefixNamer("types", rawName => typeNameStyle(this._classPrefix, rawName));
    }
    namerForObjectProperty(_, p) {
        // TODO why is underscore being removed?
        return new Naming_1.Namer("properties", s => propertyNameStyle(s, p.type.kind === "bool"), [
            "_",
            "the",
            "one",
            "some",
            "another"
        ]);
    }
    makeUnionMemberNamer() {
        return null;
    }
    makeEnumCaseNamer() {
        return new Naming_1.Namer("enum-cases", propertyNameStyle, []);
    }
    namedTypeToNameForTopLevel(type) {
        return type;
    }
    emitDescriptionBlock(lines) {
        this.emitCommentLines(lines, "/// ");
    }
    emitBlock(line, f) {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }
    emitMethod(declaration, f) {
        this.emitLine(declaration);
        this.emitLine("{");
        this.indent(f);
        this.emitLine("}");
    }
    emitExtraComments(...comments) {
        if (!this._options.extraComments)
            return;
        for (const comment of comments) {
            this.emitLine("// ", comment);
        }
    }
    startFile(basename, extension) {
        Support_1.assert(this._currentFilename === undefined, "Previous file wasn't finished");
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.${extension}`;
    }
    finishFile() {
        super.finishFile(Support_1.defined(this._currentFilename));
        this._currentFilename = undefined;
    }
    memoryAttribute(t, isNullable) {
        return TypeUtils_1.matchType(t, _anyType => "copy", _nullType => "copy", _boolType => (isNullable ? "strong" : "assign"), _integerType => (isNullable ? "strong" : "assign"), _doubleType => (isNullable ? "strong" : "assign"), _stringType => "copy", _arrayType => "copy", _classType => "strong", _mapType => "copy", _enumType => "assign", unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            return nullable !== null ? this.memoryAttribute(nullable, true) : "copy";
        });
    }
    objcType(t, nullableOrBoxed = false) {
        return TypeUtils_1.matchType(t, _anyType => ["id", ""], 
        // For now, we're treating nulls just like any
        _nullType => ["id", ""], _boolType => (nullableOrBoxed ? ["NSNumber", " *"] : ["BOOL", ""]), _integerType => (nullableOrBoxed ? ["NSNumber", " *"] : ["NSInteger", ""]), _doubleType => (nullableOrBoxed ? ["NSNumber", " *"] : ["double", ""]), _stringType => ["NSString", " *"], arrayType => {
            const itemType = arrayType.items;
            const itemTypeName = this.objcType(itemType, true);
            // NSArray<id>* === NSArray*
            if (TypeUtils_1.isAnyOrNull(itemType)) {
                return ["NSArray", " *"];
            }
            return [["NSArray<", itemTypeName, ">"], " *"];
        }, classType => [this.nameForNamedType(classType), " *"], mapType => [["NSDictionary<NSString *, ", this.objcType(mapType.values, true), ">"], " *"], enumType => [this.nameForNamedType(enumType), " *"], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            return nullable !== null ? this.objcType(nullable, true) : ["id", ""];
        });
    }
    jsonType(t) {
        return TypeUtils_1.matchType(t, _anyType => ["id", ""], 
        // For now, we're treating nulls just like any
        _nullType => ["id", ""], _boolType => ["NSNumber", " *"], _integerType => ["NSNumber", " *"], _doubleType => ["NSNumber", " *"], _stringType => ["NSString", " *"], _arrayType => ["NSArray", " *"], _classType => ["NSDictionary<NSString *, id>", " *"], mapType => [["NSDictionary<NSString *, ", this.jsonType(mapType.values), ">"], " *"], _enumType => ["NSString", " *"], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            return nullable !== null ? this.jsonType(nullable) : ["id", ""];
        });
    }
    fromDynamicExpression(t, ...dynamic) {
        return TypeUtils_1.matchType(t, _anyType => dynamic, _nullType => dynamic, _boolType => dynamic, _integerType => dynamic, _doubleType => dynamic, _stringType => dynamic, arrayType => ["map(", dynamic, ", λ(id x, ", this.fromDynamicExpression(arrayType.items, "x"), "))"], classType => ["[", this.nameForNamedType(classType), " fromJSONDictionary:", dynamic, "]"], mapType => ["map(", dynamic, ", λ(id x, ", this.fromDynamicExpression(mapType.values, "x"), "))"], enumType => ["[", this.nameForNamedType(enumType), " withValue:", dynamic, "]"], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            return nullable !== null ? this.fromDynamicExpression(nullable, dynamic) : dynamic;
        });
    }
    toDynamicExpression(t, typed) {
        return TypeUtils_1.matchType(t, _anyType => ["NSNullify(", typed, ")"], _nullType => ["NSNullify(", typed, ")"], 
        // Sadly, KVC
        _boolType => [typed, ` ? @YES : @NO`], _integerType => typed, _doubleType => typed, _stringType => typed, arrayType => {
            if (this.implicitlyConvertsFromJSON(arrayType)) {
                // TODO check each value type
                return typed;
            }
            return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(arrayType.items, "x"), "))"];
        }, _classType => ["[", typed, " JSONDictionary]"], mapType => {
            if (this.implicitlyConvertsFromJSON(mapType)) {
                // TODO check each value type
                return typed;
            }
            return ["map(", typed, ", λ(id x, ", this.toDynamicExpression(mapType.values, "x"), "))"];
        }, _enumType => ["[", typed, " value]"], unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                if (this.implicitlyConvertsFromJSON(nullable)) {
                    return ["NSNullify(", typed, ")"];
                }
                else {
                    return ["NSNullify(", this.toDynamicExpression(nullable, typed), ")"];
                }
            }
            else {
                // TODO support unions
                return typed;
            }
        });
    }
    implicitlyConvertsFromJSON(t) {
        if (t instanceof Type_1.ClassType) {
            return false;
        }
        else if (t instanceof Type_1.EnumType) {
            return false;
        }
        else if (t instanceof Type_1.ArrayType) {
            return this.implicitlyConvertsFromJSON(t.items);
        }
        else if (t instanceof Type_1.MapType) {
            return this.implicitlyConvertsFromJSON(t.values);
        }
        else if (t.isPrimitive()) {
            return true;
        }
        else if (t instanceof Type_1.UnionType) {
            const nullable = TypeUtils_1.nullableFromUnion(t);
            if (nullable !== null) {
                return this.implicitlyConvertsFromJSON(nullable);
            }
            else {
                // We don't support unions yet, so this is just untyped
                return true;
            }
        }
        else {
            return false;
        }
    }
    implicitlyConvertsToJSON(t) {
        return this.implicitlyConvertsFromJSON(t) && "bool" !== t.kind;
    }
    emitPropertyAssignment(propertyName, jsonName, propertyType) {
        const name = ["_", propertyName];
        TypeUtils_1.matchType(propertyType, anyType => this.emitLine(name, " = ", this.fromDynamicExpression(anyType, name), ";"), nullType => this.emitLine(name, " = ", this.fromDynamicExpression(nullType, name), ";"), boolType => this.emitLine(name, " = ", this.fromDynamicExpression(boolType, name), ";"), integerType => this.emitLine(name, " = ", this.fromDynamicExpression(integerType, name), ";"), doubleType => this.emitLine(name, " = ", this.fromDynamicExpression(doubleType, name), ";"), stringType => this.emitLine(name, " = ", this.fromDynamicExpression(stringType, name), ";"), arrayType => this.emitLine(name, " = ", this.fromDynamicExpression(arrayType, name), ";"), classType => this.emitLine(name, " = ", this.fromDynamicExpression(classType, ["(id)", name]), ";"), mapType => {
            const itemType = mapType.values;
            this.emitLine(name, " = map(", name, ", ", ["λ(id x, ", this.fromDynamicExpression(itemType, "x"), ")"], ");");
        }, enumType => this.emitLine(name, " = ", this.fromDynamicExpression(enumType, ["(id)", name]), ";"), unionType => {
            const nullable = TypeUtils_1.nullableFromUnion(unionType);
            if (nullable !== null) {
                this.emitPropertyAssignment(propertyName, jsonName, nullable);
            }
            else {
                // TODO This is a union, but for now we just leave it dynamic
                this.emitLine(name, " = ", this.fromDynamicExpression(unionType, name), ";");
            }
        });
    }
    emitPrivateClassInterface(_, name) {
        this.emitLine("@interface ", name, " (JSONConversion)");
        this.emitLine("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict;");
        this.emitLine("- (NSDictionary *)JSONDictionary;");
        this.emitLine("@end");
    }
    pointerAwareTypeName(t) {
        const name = t instanceof Type_1.Type ? this.objcType(t) : t;
        const isPointer = name[1] !== "";
        return isPointer ? name : [name, " "];
    }
    emitNonClassTopLevelTypedef(t, name) {
        let nonPointerTypeName = this.objcType(t)[0];
        this.emitLine("typedef ", nonPointerTypeName, " ", name, ";");
    }
    topLevelFromDataPrototype(name) {
        return [name, " *_Nullable ", name, "FromData(NSData *data, NSError **error)"];
    }
    topLevelFromJSONPrototype(name) {
        return [name, " *_Nullable ", name, "FromJSON(NSString *json, NSStringEncoding encoding, NSError **error)"];
    }
    topLevelToDataPrototype(name, pad = false) {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? Strings_1.repeatString(" ", this.sourcelikeToString(name).length - "NSData".length) : "";
        return ["NSData", padding, " *_Nullable ", name, "ToData(", name, " *", parameter, ", NSError **error)"];
    }
    topLevelToJSONPrototype(name, pad = false) {
        const parameter = this.variableNameForTopLevel(name);
        const padding = pad ? Strings_1.repeatString(" ", this.sourcelikeToString(name).length - "NSString".length) : "";
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
    emitTopLevelFunctionDeclarations(_, name) {
        this.emitLine(this.topLevelFromDataPrototype(name), ";");
        this.emitLine(this.topLevelFromJSONPrototype(name), ";");
        this.emitLine(this.topLevelToDataPrototype(name, true), ";");
        this.emitLine(this.topLevelToJSONPrototype(name, true), ";");
    }
    emitTryCatchAsError(inTry, inCatch) {
        this.emitLine("@try {");
        this.indent(inTry);
        this.emitLine("} @catch (NSException *exception) {");
        this.indent(() => {
            this.emitLine(`*error = [NSError errorWithDomain:@"JSONSerialization" code:-1 userInfo:@{ @"exception": exception }];`);
            inCatch();
        });
        this.emitLine("}");
    }
    emitTopLevelFunctions(t, name) {
        const parameter = this.variableNameForTopLevel(name);
        this.ensureBlankLine();
        this.emitMethod(this.topLevelFromDataPrototype(name), () => {
            this.emitTryCatchAsError(() => {
                this.emitLine("id json = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:error];");
                this.emitLine("return *error ? nil : ", this.fromDynamicExpression(t, "json"), ";");
            }, () => this.emitLine("return nil;"));
        });
        this.ensureBlankLine();
        this.emitMethod(this.topLevelFromJSONPrototype(name), () => {
            this.emitLine("return ", name, "FromData([json dataUsingEncoding:encoding], error);");
        });
        this.ensureBlankLine();
        this.emitMethod(this.topLevelToDataPrototype(name), () => {
            this.emitTryCatchAsError(() => {
                this.emitLine("id json = ", this.toDynamicExpression(t, parameter), ";");
                this.emitLine("NSData *data = [NSJSONSerialization dataWithJSONObject:json options:kNilOptions error:error];");
                this.emitLine("return *error ? nil : data;");
            }, () => this.emitLine("return nil;"));
        });
        this.ensureBlankLine();
        this.emitMethod(this.topLevelToJSONPrototype(name), () => {
            this.emitLine("NSData *data = ", name, "ToData(", parameter, ", error);");
            this.emitLine("return data ? [[NSString alloc] initWithData:data encoding:encoding] : nil;");
        });
    }
    emitClassInterface(t, className) {
        const isTopLevel = collection_utils_1.mapContains(this.topLevels, t);
        this.emitDescription(this.descriptionForType(t));
        this.emitLine("@interface ", className, " : NSObject");
        if (DEBUG)
            this.emitLine("@property NSDictionary<NSString *, id> *_json;");
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
            if (t.getProperties().size > 0)
                this.ensureBlankLine();
            this.emitLine("+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;");
            this.emitLine("+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error;");
            this.emitLine("- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error;");
            this.emitLine("- (NSData *_Nullable)toData:(NSError *_Nullable *)error;");
        }
        this.emitLine("@end");
    }
    hasIrregularProperties(t) {
        let irregular = false;
        this.forEachClassProperty(t, "none", (name, jsonName) => {
            irregular = irregular || Strings_1.stringEscape(jsonName) !== this.sourcelikeToString(name);
        });
        return irregular;
    }
    hasUnsafeProperties(t) {
        let unsafe = false;
        this.forEachClassProperty(t, "none", (_, __, property) => {
            unsafe = unsafe || !this.implicitlyConvertsToJSON(property.type);
        });
        return unsafe;
    }
    // TODO Implement NSCopying
    emitClassImplementation(t, className) {
        const isTopLevel = collection_utils_1.mapContains(this.topLevels, t);
        const hasIrregularProperties = this.hasIrregularProperties(t);
        const hasUnsafeProperties = this.hasUnsafeProperties(t);
        this.emitLine("@implementation ", className);
        if (!this._options.justTypes) {
            this.emitMethod("+ (NSDictionary<NSString *, NSString *> *)properties", () => {
                this.emitLine("static NSDictionary<NSString *, NSString *> *properties;");
                this.emitLine("return properties = properties ? properties : @{");
                this.indent(() => {
                    this.forEachClassProperty(t, "none", (name, jsonName) => this.emitLine(`@"${Strings_1.stringEscape(jsonName)}": @"`, name, `",`));
                });
                this.emitLine("};");
            });
            this.ensureBlankLine();
            if (isTopLevel) {
                this.emitMethod("+ (_Nullable instancetype)fromData:(NSData *)data error:(NSError *_Nullable *)error", () => {
                    this.emitLine("return ", className, "FromData(data, error);");
                });
                this.ensureBlankLine();
                this.emitMethod("+ (_Nullable instancetype)fromJSON:(NSString *)json encoding:(NSStringEncoding)encoding error:(NSError *_Nullable *)error", () => {
                    this.emitLine("return ", className, "FromJSON(json, encoding, error);");
                });
                this.ensureBlankLine();
            }
            this.emitMethod("+ (instancetype)fromJSONDictionary:(NSDictionary *)dict", () => {
                this.emitLine("return dict ? [[", className, " alloc] initWithJSONDictionary:dict] : nil;");
            });
            this.ensureBlankLine();
            this.emitMethod("- (instancetype)initWithJSONDictionary:(NSDictionary *)dict", () => {
                this.emitBlock("if (self = [super init])", () => {
                    if (DEBUG)
                        this.emitLine("__json = dict;");
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
                this.emitLine("id dict = [[self dictionaryWithValuesForKeys:", className, ".properties.allValues] mutableCopy];");
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
                                const key = Strings_1.stringEscape(jsonKey);
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
                this.emitMethod(`- (NSString *_Nullable)toJSON:(NSStringEncoding)encoding error:(NSError *_Nullable *)error`, () => {
                    this.emitLine("return ", className, "ToJSON(self, encoding, error);");
                });
            }
        }
        this.emitLine("@end");
    }
    emitMark(label) {
        this.ensureBlankLine();
        this.emitLine(`#pragma mark - ${label}`);
        this.ensureBlankLine();
    }
    variableNameForTopLevel(name) {
        const camelCaseName = Source_1.modifySource(serialized => {
            // 1. remove class prefix
            serialized = serialized.substr(this._classPrefix.length);
            // 2. camel case
            return Strings_1.camelCase(serialized);
        }, name);
        return camelCaseName;
    }
    emitPseudoEnumInterface(enumType, enumName) {
        this.emitDescription(this.descriptionForType(enumType));
        this.emitLine("@interface ", enumName, " : NSObject");
        this.emitLine("@property (nonatomic, readonly, copy) NSString *value;");
        this.emitLine("+ (instancetype _Nullable)withValue:(NSString *)value;");
        this.forEachEnumCase(enumType, "none", (name, _) => {
            this.emitLine("+ (", enumName, " *)", name, ";");
        });
        this.emitLine("@end");
    }
    emitPseudoEnumImplementation(enumType, enumName) {
        this.emitLine("@implementation ", enumName);
        const instances = [enumName, ".", staticEnumValuesIdentifier];
        this.emitMethod(["+ (NSDictionary<NSString *, ", enumName, " *> *)", staticEnumValuesIdentifier], () => {
            this.emitLine("static NSDictionary<NSString *, ", enumName, " *> *", staticEnumValuesIdentifier, ";");
            this.emitLine("return ", staticEnumValuesIdentifier, " = ", staticEnumValuesIdentifier, " ? ", staticEnumValuesIdentifier, " : @{");
            this.indent(() => {
                this.forEachEnumCase(enumType, "none", (_, jsonValue) => {
                    const value = ['@"', Strings_1.stringEscape(jsonValue), '"'];
                    this.emitLine(value, ": [[", enumName, " alloc] initWithValue:", value, "],");
                });
            });
            this.emitLine("};");
        });
        this.ensureBlankLine();
        this.forEachEnumCase(enumType, "none", (name, jsonValue) => {
            this.emitLine("+ (", enumName, " *)", name, " { return ", instances, '[@"', Strings_1.stringEscape(jsonValue), '"]; }');
        });
        this.ensureBlankLine();
        this.emitMethod("+ (instancetype _Nullable)withValue:(NSString *)value", () => this.emitLine("return ", instances, "[value];"));
        this.ensureBlankLine();
        this.emitMethod("- (instancetype)initWithValue:(NSString *)value", () => {
            this.emitLine("if (self = [super init]) _value = value;");
            this.emitLine("return self;");
        });
        this.ensureBlankLine();
        this.emitLine("- (NSUInteger)hash { return _value.hash; }");
        this.emitLine("@end");
    }
    emitSourceStructure(proposedFilename) {
        const fileMode = proposedFilename !== "stdout";
        if (!fileMode) {
            // We don't have a filename, so we use a top-level name
            const firstTopLevel = Support_1.defined(collection_utils_1.mapFirst(this.topLevels));
            proposedFilename = this.sourcelikeToString(this.nameForNamedType(firstTopLevel)) + ".m";
        }
        const [filename, extension] = splitExtension(proposedFilename);
        if (this._options.features.interface) {
            this.startFile(filename, "h");
            if (this.leadingComments !== undefined) {
                this.emitCommentLines(this.leadingComments);
            }
            else if (!this._options.justTypes) {
                this.emitCommentLines(["To parse this JSON:", ""]);
                this.emitLine("//   NSError *error;");
                this.forEachTopLevel("none", (t, topLevelName) => {
                    const fromJsonExpression = t instanceof Type_1.ClassType
                        ? ["[", topLevelName, " fromJSON:json encoding:NSUTF8Encoding error:&error];"]
                        : [topLevelName, "FromJSON(json, NSUTF8Encoding, &error);"];
                    this.emitLine("//   ", topLevelName, " *", this.variableNameForTopLevel(topLevelName), " = ", fromJsonExpression);
                });
            }
            this.ensureBlankLine();
            this.emitLine(`#import <Foundation/Foundation.h>`);
            this.ensureBlankLine();
            // Emit @class declarations for top-level array+maps and classes
            this.forEachNamedType("none", (_, className) => this.emitLine("@class ", className, ";"), (_, enumName) => this.emitLine("@class ", enumName, ";"), () => null);
            this.ensureBlankLine();
            this.ensureBlankLine();
            this.emitLine("NS_ASSUME_NONNULL_BEGIN");
            this.ensureBlankLine();
            if (this.haveEnums) {
                this.emitMark("Boxed enums");
                this.forEachEnum("leading-and-interposing", (t, n) => this.emitPseudoEnumInterface(t, n));
            }
            // Emit interfaces for top-level array+maps and classes
            this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitNonClassTopLevelTypedef(t, n), t => !(t instanceof Type_1.ClassType));
            const hasTopLevelNonClassTypes = collection_utils_1.iterableSome(this.topLevels, ([_, t]) => !(t instanceof Type_1.ClassType));
            if (!this._options.justTypes && (hasTopLevelNonClassTypes || this._options.marshallingFunctions)) {
                this.ensureBlankLine();
                this.emitMark("Top-level marshaling functions");
                this.forEachTopLevel("leading-and-interposing", (t, n) => this.emitTopLevelFunctionDeclarations(t, n), 
                // Objective-C developers get freaked out by C functions, so we don't
                // declare them for top-level object types (we always need them for non-object types)
                t => this._options.marshallingFunctions || !(t instanceof Type_1.ClassType));
            }
            this.emitMark("Object interfaces");
            this.forEachNamedType("leading-and-interposing", (c, className) => this.emitClassInterface(c, className), () => null, () => null);
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
                this.emitBlock("static id NSNullify(id _Nullable x)", () => this.emitLine("return (x == nil || x == NSNull.null) ? NSNull.null : x;"));
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_BEGIN");
                this.ensureBlankLine();
                // We wouldn't need to emit these private iterfaces if we emitted implementations in forward-order
                // but the code is more readable and explicit if we do this.
                if (this._options.extraComments) {
                    this.emitMark("Private model interfaces");
                }
                this.forEachNamedType("leading-and-interposing", (c, className) => this.emitPrivateClassInterface(c, className), () => null, () => null);
                if (this.haveEnums) {
                    if (this._options.extraComments) {
                        this.ensureBlankLine();
                        this.emitExtraComments("These enum-like reference types are needed so that enum", "values can be contained by NSArray and NSDictionary.");
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
            this.forEachNamedType("leading-and-interposing", (c, className) => this.emitClassImplementation(c, className), () => null, () => null);
            if (!this._options.justTypes) {
                this.ensureBlankLine();
                this.emitLine("NS_ASSUME_NONNULL_END");
            }
            this.finishFile();
        }
    }
    get needsMap() {
        // TODO this isn't complete (needs union support, for example)
        function needsMap(t) {
            return (t instanceof Type_1.MapType ||
                t instanceof Type_1.ArrayType ||
                (t instanceof Type_1.ClassType && collection_utils_1.mapSome(t.getProperties(), p => needsMap(p.type))));
        }
        return collection_utils_1.iterableSome(this.typeGraph.allTypesUnordered(), needsMap);
    }
    emitMapFunction() {
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
exports.ObjectiveCRenderer = ObjectiveCRenderer;
