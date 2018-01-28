"use strict";

import { TargetLanguage } from "../TargetLanguage";
import {
    Type,
    ClassType,
    EnumType,
    UnionType,
    ArrayType,
    MapType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion,
    TypeKind,
    ClassProperty
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { BooleanOption, EnumOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    isLetterOrUnderscore,
    isNumeric,
    isDigit,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    intToHex,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { intercalate } from "../Support";
import { List } from "immutable";

const MAX_SAMELINE_PROPERTIES = 4;

type Version = 4 | 4.1;

export default class SwiftTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);

    private readonly _convenienceInitializers = new BooleanOption(
        "initializers",
        "Generate convenience initializers",
        true
    );

    private readonly _classOption = new EnumOption("struct-or-class", "Generate structs or classes", [
        ["struct", false],
        ["class", true]
    ]);

    private readonly _versionOption = new EnumOption<Version>("swift-version", "Swift version", [
        ["4", 4],
        ["4.1", 4.1]
    ]);

    private readonly _denseOption = new EnumOption("density", "Code density", [["dense", true], ["normal", false]]);

    constructor() {
        super("Swift", ["swift", "swift4"], "swift");
        this.setOptions([
            this._justTypesOption,
            this._classOption,
            this._denseOption,
            this._versionOption,
            this._convenienceInitializers
        ]);
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return SwiftRenderer;
    }
}

const keywords = [
    "associatedtype",
    "class",
    "deinit",
    "enum",
    "extension",
    "fileprivate",
    "func",
    "import",
    "init",
    "inout",
    "internal",
    "let",
    "open",
    "operator",
    "private",
    "protocol",
    "public",
    "static",
    "struct",
    "subscript",
    "typealias",
    "var",
    "break",
    "case",
    "continue",
    "default",
    "defer",
    "do",
    "else",
    "fallthrough",
    "for",
    "guard",
    "if",
    "in",
    "repeat",
    "return",
    "switch",
    "where",
    "while",
    "as",
    "Any",
    "catch",
    "false",
    "is",
    "nil",
    "rethrows",
    "super",
    "self",
    "Self",
    "throw",
    "throws",
    "true",
    "try",
    "_",
    "associativity",
    "convenience",
    "dynamic",
    "didSet",
    "final",
    "get",
    "infix",
    "indirect",
    "lazy",
    "left",
    "mutating",
    "nonmutating",
    "optional",
    "override",
    "postfix",
    "precedence",
    "prefix",
    "Protocol",
    "required",
    "right",
    "set",
    "Type",
    "unowned",
    "weak",
    "willSet",
    "String",
    "Int",
    "Double",
    "Bool",
    "Data",
    "CommandLine",
    "FileHandle",
    "JSONSerialization",
    "checkNull",
    "removeNSNull",
    "nilToNSNull",
    "convertArray",
    "convertOptional",
    "convertDict",
    "convertDouble",
    "jsonString",
    "jsonData"
];

function isPartCharacter(codePoint: number): boolean {
    return isLetterOrUnderscore(codePoint) || isNumeric(codePoint);
}

function isStartCharacter(codePoint: number): boolean {
    return isPartCharacter(codePoint) && !isDigit(codePoint);
}

const legalizeName = legalizeCharacters(isPartCharacter);

function swiftNameStyle(isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

const upperNamingFunction = funPrefixNamer("upper", s => swiftNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer("lower", s => swiftNameStyle(false, s));

class SwiftRenderer extends ConvenienceRenderer {
    private _needAny: boolean = false;
    private _needNull: boolean = false;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _useClasses: boolean,
        private readonly _dense: boolean,
        private readonly _version: Version,
        private readonly _convenienceInitializers: boolean
    ) {
        super(graph, leadingComments);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForClassProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: ["fromURL", "json"], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected topLevelNameStyle(rawName: string): string {
        return swiftNameStyle(true, rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected namerForClassProperty(): Namer {
        return lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return lowerNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return lowerNamingFunction;
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private justTypesCase = (justTypes: Sourcelike, notJustTypes: Sourcelike): Sourcelike => {
        if (this._justTypes) return justTypes;
        else return notJustTypes;
    };

    private swiftType = (t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike => {
        const optional = noOptional ? "" : "?";
        return matchType<Sourcelike>(
            t,
            _anyType => {
                this._needAny = true;
                return maybeAnnotated(
                    withIssues,
                    anyTypeIssueAnnotation,
                    this.justTypesCase(["Any", optional], "JSONAny")
                );
            },
            _nullType => {
                this._needNull = true;
                return maybeAnnotated(
                    withIssues,
                    nullTypeIssueAnnotation,
                    this.justTypesCase("NSNull", ["JSONNull", optional])
                );
            },
            _boolType => "Bool",
            _integerType => "Int",
            _doubleType => "Double",
            _stringType => "String",
            arrayType => ["[", this.swiftType(arrayType.items, withIssues), "]"],
            classType => this.nameForNamedType(classType),
            mapType => ["[String: ", this.swiftType(mapType.values, withIssues), "]"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable !== null) return [this.swiftType(nullable, withIssues), optional];
                return this.nameForNamedType(unionType);
            }
        );
    };

    protected proposedUnionMemberNameForTypeKind = (kind: TypeKind): string | null => {
        if (kind === "enum") {
            return "enumeration";
        }
        if (kind === "union") {
            return "one_of";
        }
        return null;
    };

    private renderHeader = (): void => {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        } else if (!this._justTypes) {
            this.emitLine("// To parse the JSON, add this file to your project and do:");
            this.emitLine("//");
            this.forEachTopLevel("none", (_, name) => {
                if (this._convenienceInitializers) {
                    this.emitLine("//   let ", modifySource(camelCase, name), " = ", name, "(json)!");
                } else {
                    this.emitLine(
                        "//   let ",
                        modifySource(camelCase, name),
                        " = ",
                        "try? JSONDecoder().decode(",
                        name,
                        ".self, from: jsonData)"
                    );
                }
            });
        }
        this.ensureBlankLine();
        this.emitLine("import Foundation");
    };

    private renderTopLevelAlias = (t: Type, name: Name): void => {
        this.emitLine("typealias ", name, " = ", this.swiftType(t, true));
    };

    private getProtocolString = (): Sourcelike => {
        let protocols: string[] = [];
        if (this._version > 4) {
            protocols.push("Hashable", "Equatable");
        }
        if (!this._justTypes) {
            protocols.push("Codable");
        }
        return protocols.length > 0 ? ": " + protocols.join(", ") : "";
    };

    getEnumPropertyGroups = (c: ClassType) => {
        type PropertyGroup = { name: Name; label?: string }[];

        let groups: PropertyGroup[] = [];
        let group: PropertyGroup = [];

        this.forEachClassProperty(c, "none", (name, jsonName) => {
            const label = stringEscape(jsonName);
            const redundant = this.sourcelikeToString(name) === label;

            if (this._dense && redundant) {
                group.push({ name });
            } else {
                if (group.length > 0) {
                    groups.push(group);
                    group = [];
                }
                groups.push([{ name, label }]);
            }
        });

        if (group.length > 0) {
            groups.push(group);
        }

        return groups;
    };

    private renderClassDefinition = (c: ClassType, className: Name): void => {
        const swiftType = (p: ClassProperty) => {
            if (p.isOptional) {
                return [this.swiftType(p.type, true, true), "?"];
            } else {
                return this.swiftType(p.type, true);
            }
        };

        const isClass = this._useClasses || this.isCycleBreakerType(c);
        const structOrClass = isClass ? "class" : "struct";
        this.emitBlock([structOrClass, " ", className, this.getProtocolString()], () => {
            if (this._dense) {
                let lastProperty: ClassProperty | undefined = undefined;
                let lastNames: Name[] = [];

                const emitLastProperty = () => {
                    if (lastProperty !== undefined) {
                        let sources: Sourcelike[] = ["let "];
                        lastNames.forEach((n, i) => {
                            if (i > 0) sources.push(", ");
                            sources.push(n);
                        });
                        sources.push(": ");
                        sources.push(swiftType(lastProperty));
                        this.emitLine(sources);
                    }
                };

                this.forEachClassProperty(c, "none", (name, _, p) => {
                    if (lastProperty === undefined) {
                        lastProperty = p;
                    }
                    if (p.equals(lastProperty) && lastNames.length < MAX_SAMELINE_PROPERTIES) {
                        lastNames.push(name);
                    } else {
                        emitLastProperty();
                        lastProperty = p;
                        lastNames = [name];
                    }
                });
                emitLastProperty();
            } else {
                this.forEachClassProperty(c, "none", (name, _, p) => {
                    this.emitLine("let ", name, ": ", swiftType(p));
                });
            }

            if (!this._justTypes) {
                const groups = this.getEnumPropertyGroups(c);
                const allPropertiesRedundant = groups.every(group => {
                    return group.every(p => p.label === undefined);
                });
                if (!allPropertiesRedundant && !c.properties.isEmpty()) {
                    this.ensureBlankLine();
                    this.emitBlock("enum CodingKeys: String, CodingKey", () => {
                        for (const group of groups) {
                            const { name, label } = group[0];
                            if (label !== undefined) {
                                this.emitLine("case ", name, ' = "', label, '"');
                            } else {
                                const names = intercalate<Sourcelike>(", ", List(group.map(p => p.name))).toArray();
                                this.emitLine("case ", ...names);
                            }
                        }
                    });
                }
            }

            // If using classes with convenience initializers,
            // this main initializer must be defined within the class
            // declaration since it assigns let constants
            if (isClass && (this._convenienceInitializers || this._justTypes)) {
                // Make an initializer that initalizes all fields
                this.ensureBlankLine();
                let properties: Sourcelike[] = [];
                this.forEachClassProperty(c, "none", (name, _, p) => {
                    if (properties.length > 0) properties.push(", ");
                    properties.push(name, ": ", swiftType(p));
                });
                this.emitBlock(["init(", ...properties, ")"], () => {
                    this.forEachClassProperty(c, "none", name => {
                        this.emitLine("self.", name, " = ", name);
                    });
                });
            }
        });
    };

    private emitConvenienceInitializersExtension = (c: ClassType, className: Name): void => {
        const isClass = this._useClasses || this.isCycleBreakerType(c);
        this.emitBlock(["extension ", className], () => {
            if (isClass) {
                // Convenience initializers for Json string and data
                this.emitBlock(["convenience init?(data: Data)"], () => {
                    this.emitLine(
                        "guard let me = try? JSONDecoder().decode(",
                        this.swiftType(c),
                        ".self, from: data) else { return nil }"
                    );
                    let args: Sourcelike[] = [];
                    this.forEachClassProperty(c, "none", name => {
                        if (args.length > 0) args.push(", ");
                        args.push(name, ": ", "me.", name);
                    });
                    this.emitLine("self.init(", ...args, ")");
                });
                this.ensureBlankLine();
                this.emitMultiline(`convenience init?(_ json: String, using encoding: String.Encoding = .utf8) {
    guard let data = json.data(using: encoding) else { return nil }
    self.init(data: data)
}`);
                this.ensureBlankLine();
                this.emitMultiline(`convenience init?(fromURL url: String) {
    guard let url = URL(string: url) else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    self.init(data: data)
}`);
            } else {
                // 1. Two convenience initializers for Json string and data
                this.emitBlock(["init?(data: Data)"], () => {
                    this.emitLine(
                        "do {
                            self = try JSONDecoder().decode(",
                        this.swiftType(c),
                        ".self, from: data)
                        }catch {
                            print(error)
                            return nil
                        }"
                    );
                });
                this.ensureBlankLine();
                this.emitBlock(["init?(_ json: String, using encoding: String.Encoding = .utf8)"], () => {
                    this.emitLine("guard let data = json.data(using: encoding) else { return nil }");
                    this.emitLine("self.init(data: data)");
                });
                this.ensureBlankLine();
                this.emitMultiline(`init?(fromURL url: String) {
    guard let url = URL(string: url) else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    self.init(data: data)
}`);
            }

            // Convenience serializers
            this.ensureBlankLine();
            this.emitMultiline(`var jsonData: Data? {
    return try? JSONEncoder().encode(self)
}

var json: String? {
    guard let data = self.jsonData else { return nil }
    return String(data: data, encoding: .utf8)
}`);
        });
    };

    private renderEnumDefinition = (e: EnumType, enumName: Name): void => {
        if (this._justTypes) {
            this.emitBlock(["enum ", enumName], () => {
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine("case ", name);
                });
            });
        } else {
            this.emitBlock(["enum ", enumName, ": String, Codable"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ' = "', stringEscape(jsonName), '"');
                });
            });
        }
    };

    private renderUnionDefinition = (u: UnionType, unionName: Name): void => {
        const renderUnionCase = (t: Type): void => {
            this.emitBlock(["if let x = try? container.decode(", this.swiftType(t), ".self)"], () => {
                this.emitLine("self = .", this.nameForUnionMember(u, t), "(x)");
                this.emitLine("return");
            });
        };

        const indirect = this.isCycleBreakerType(u) ? "indirect " : "";
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock([indirect, "enum ", unionName, this.getProtocolString()], () => {
            this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                this.emitLine("case ", name, "(", this.swiftType(t), ")");
            });
            if (maybeNull !== null) {
                this.emitLine("case ", this.nameForUnionMember(u, maybeNull));
            }

            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitBlock("init(from decoder: Decoder) throws", () => {
                    this.emitLine("let container = try decoder.singleValueContainer()");
                    const boolMember = u.findMember("bool");
                    if (boolMember !== undefined) renderUnionCase(boolMember);
                    const integerMember = u.findMember("integer");
                    if (integerMember !== undefined) renderUnionCase(integerMember);
                    nonNulls.forEach(t => {
                        if (t.kind === "bool" || t.kind === "integer") return;
                        renderUnionCase(t);
                    });
                    if (maybeNull !== null) {
                        this.emitBlock("if container.decodeNil()", () => {
                            this.emitLine("self = .", this.nameForUnionMember(u, maybeNull));
                            this.emitLine("return");
                        });
                    }
                    this.emitDecodingError(unionName);
                });
                this.ensureBlankLine();
                this.emitBlock("func encode(to encoder: Encoder) throws", () => {
                    this.emitLine("var container = encoder.singleValueContainer()");
                    this.emitLine("switch self {");
                    this.forEachUnionMember(u, nonNulls, "none", null, (name, _) => {
                        this.emitLine("case .", name, "(let x):");
                        this.indent(() => this.emitLine("try container.encode(x)"));
                    });
                    if (maybeNull !== null) {
                        this.emitLine("case .", this.nameForUnionMember(u, maybeNull), ":");
                        this.indent(() => this.emitLine("try container.encodeNil()"));
                    }
                    this.emitLine("}");
                });
            }
        });
    };

    private emitTopLevelMapAndArrayConvenienceInitializerExtensions = (t: Type, name: Name): void => {
        let extensionSource: Sourcelike;

        if (t instanceof ArrayType) {
            extensionSource = ["Array where Element == ", name, ".Element"];
        } else if (t instanceof MapType) {
            extensionSource = ["Dictionary where Key == String, Value == ", this.swiftType(t.values)];
        } else {
            return;
        }

        this.emitBlock(["extension ", extensionSource], () => {
            this.emitBlock(["init?(data: Data)"], () => {
               this.emitLine(
                        "do {
                            self = try JSONDecoder().decode(",
                        this.swiftType(c),
                        ".self, from: data)
                        }catch {
                            print(error)
                            return nil
                        }"
                    );
            });
            this.ensureBlankLine();
            this.emitBlock(["init?(_ json: String, using encoding: String.Encoding = .utf8)"], () => {
                this.emitLine("guard let data = json.data(using: encoding) else { return nil }");
                this.emitLine("self.init(data: data)");
            });
            this.ensureBlankLine();
            this.emitMultiline(`init?(fromURL url: String) {
    guard let url = URL(string: url) else { return nil }
    guard let data = try? Data(contentsOf: url) else { return nil }
    self.init(data: data)
}`);
            this.ensureBlankLine();
            this.emitBlock("var jsonData: Data?", () => {
                this.emitLine("return try? JSONEncoder().encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlock("var json: String?", () => {
                this.emitLine("guard let data = self.jsonData else { return nil }");
                this.emitLine("return String(data: data, encoding: .utf8)");
            });
        });
    };

    private emitDecodingError = (name: Name): void => {
        this.emitLine(
            "throw DecodingError.typeMismatch(",
            name,
            '.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for ',
            name,
            '"))'
        );
    };

    private emitSupportFunctions4 = (): void => {
        // This assumes that this method is called after declarations
        // are emitted.
        if (this._needAny || this._needNull) {
            this.emitMark("Encode/decode helpers");
            this.ensureBlankLine();
            this.emitMultiline(`class JSONNull: Codable {
    public init() {}
    
    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if !container.decodeNil() {
            throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}`);
        }
        if (this._needAny) {
            this.ensureBlankLine();
            this.emitMultiline(`class JSONCodingKey: CodingKey {
    let key: String
    
    required init?(intValue: Int) {
        return nil
    }
    
    required init?(stringValue: String) {
        key = stringValue
    }
    
    var intValue: Int? {
        return nil
    }
    
    var stringValue: String {
        return key
    }
}

class JSONAny: Codable {
    public let value: Any
    
    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
        let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
        return DecodingError.typeMismatch(JSONAny.self, context)
    }
    
    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
        let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
        return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if container.decodeNil() {
            return JSONNull()
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if let value = try? container.decodeNil() {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer() {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
        if let value = try? container.decode(Bool.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int64.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeNil(forKey: key) {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer(forKey: key) {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }
    
    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
        var arr: [Any] = []
        while !container.isAtEnd {
            let value = try decode(from: &container)
            arr.append(value)
        }
        return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
        var dict = [String: Any]()
        for key in container.allKeys {
            let value = try decode(from: &container, forKey: key)
            dict[key.stringValue] = value
        }
        return dict
    }
    
    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
        for value in array {
            if let value = value as? Bool {
                try container.encode(value)
            } else if let value = value as? Int64 {
                try container.encode(value)
            } else if let value = value as? Double {
                try container.encode(value)
            } else if let value = value as? String {
                try container.encode(value)
            } else if value is JSONNull {
                try container.encodeNil()
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer()
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }
    
    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
        for (key, value) in dictionary {
            let key = JSONCodingKey(stringValue: key)!
            if let value = value as? Bool {
                try container.encode(value, forKey: key)
            } else if let value = value as? Int64 {
                try container.encode(value, forKey: key)
            } else if let value = value as? Double {
                try container.encode(value, forKey: key)
            } else if let value = value as? String {
                try container.encode(value, forKey: key)
            } else if value is JSONNull {
                try container.encodeNil(forKey: key)
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer(forKey: key)
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
        if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int64 {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else if let value = value as? String {
            try container.encode(value)
        } else if value is JSONNull {
            try container.encodeNil()
        } else {
            throw encodingError(forValue: value, codingPath: container.codingPath)
        }
    }
    
    public required init(from decoder: Decoder) throws {
        if var arrayContainer = try? decoder.unkeyedContainer() {
            self.value = try JSONAny.decodeArray(from: &arrayContainer)
        } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
            self.value = try JSONAny.decodeDictionary(from: &container)
        } else {
            let container = try decoder.singleValueContainer()
            self.value = try JSONAny.decode(from: container)
        }
    }
    
    public func encode(to encoder: Encoder) throws {
        if let arr = self.value as? [Any] {
            var container = encoder.unkeyedContainer()
            try JSONAny.encode(to: &container, array: arr)
        } else if let dict = self.value as? [String: Any] {
            var container = encoder.container(keyedBy: JSONCodingKey.self)
            try JSONAny.encode(to: &container, dictionary: dict)
        } else {
            var container = encoder.singleValueContainer()
            try JSONAny.encode(to: &container, value: self.value)
        }
    }
}`);
        }
    };

    emitMark = (line: Sourcelike, horizontalLine: boolean = false) => {
        this.emitLine("// MARK: ", line, horizontalLine ? " -" : "");
    };

    protected emitSourceStructure(): void {
        this.renderHeader();

        this.forEachTopLevel(
            "leading",
            this.renderTopLevelAlias,
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        this.forEachNamedType(
            "leading-and-interposing",
            this.renderClassDefinition,
            this.renderEnumDefinition,
            this.renderUnionDefinition
        );

        if (!this._justTypes) {
            if (this._convenienceInitializers) {
                this.ensureBlankLine();
                this.emitMark("Convenience initializers");
                this.forEachNamedType(
                    "leading-and-interposing",
                    this.emitConvenienceInitializersExtension,
                    () => undefined,
                    () => undefined
                );
                this.ensureBlankLine();
                this.forEachTopLevel(
                    "leading-and-interposing",
                    this.emitTopLevelMapAndArrayConvenienceInitializerExtensions
                );
            }

            this.ensureBlankLine();
            this.emitSupportFunctions4();
        }
    }
}
