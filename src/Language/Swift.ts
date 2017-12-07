"use strict";

import { TargetLanguage } from "../TargetLanguage";
import {
    Type,
    NamedType,
    ClassType,
    EnumType,
    UnionType,
    ArrayType,
    MapType,
    matchType,
    nullableFromUnion,
    removeNullFromUnion
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Namespace, Name, Namer, funPrefixNamer } from "../Naming";
import { BooleanOption, EnumOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
import { RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import {
    legalizeCharacters,
    isLetterOrUnderscore,
    isNumeric,
    isDigit,
    utf32ConcatMap,
    escapeNonPrintableMapper,
    isPrintable,
    intToHex,
    decapitalize,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { defined } from "../Support";

export default class SwiftTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption: BooleanOption;
    private readonly _classOption: EnumOption<boolean>;

    constructor() {
        const justTypesOption = new BooleanOption("just-types", "Plain types only", false);
        const classOption = new EnumOption("struct-or-class", "Generate structs or classes", [
            ["struct", false],
            ["class", true]
        ]);
        const options = [justTypesOption, classOption];
        super("Swift", ["swift", "swift4"], "swift", options.map(o => o.definition));
        this._justTypesOption = justTypesOption;
        this._classOption = classOption;
    }

    renderGraph(graph: TypeGraph, optionValues: { [name: string]: any }): RenderResult {
        const renderer = new SwiftRenderer(
            graph,
            this._justTypesOption.getValue(optionValues),
            this._classOption.getValue(optionValues)
        );
        return renderer.render();
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

const upperNamingFunction = funPrefixNamer(s => swiftNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer(s => swiftNameStyle(false, s));

class SwiftRenderer extends ConvenienceRenderer {
    constructor(graph: TypeGraph, private readonly _justTypes: boolean, private readonly _useClasses: boolean) {
        super(graph);
    }

    protected get forbiddenNamesForGlobalNamespace(): string[] {
        return keywords;
    }

    protected forbiddenForProperties(c: ClassType, classNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected forbiddenForCases(e: EnumType, enumNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return swiftNameStyle(true, rawName);
    }

    protected get namedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected get propertyNamer(): Namer {
        return lowerNamingFunction;
    }

    protected get caseNamer(): Namer {
        return lowerNamingFunction;
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private swift3OrPlainCase = (swift3OrPlain: Sourcelike, swift4NonPlain: Sourcelike): Sourcelike => {
        if (this._justTypes) return swift3OrPlain;
        else return swift4NonPlain;
    };

    private swiftType = (t: Type, withIssues: boolean = false): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.swift3OrPlainCase("Any?", "JSONAny")),
            nullType =>
                maybeAnnotated(withIssues, nullTypeIssueAnnotation, this.swift3OrPlainCase("NSNull", "JSONNull?")),
            boolType => "Bool",
            integerType => "Int",
            doubleType => "Double",
            stringType => "String",
            arrayType => ["[", this.swiftType(arrayType.items, withIssues), "]"],
            classType => this.nameForNamedType(classType),
            mapType => ["[String: ", this.swiftType(mapType.values, withIssues), "]"],
            enumType => this.nameForNamedType(enumType),
            unionType => {
                const nullable = nullableFromUnion(unionType);
                if (nullable) return [this.swiftType(nullable, withIssues), "?"];
                return this.nameForNamedType(unionType);
            }
        );
    };

    protected unionFieldName = (fieldType: Type): string => {
        return matchType(
            fieldType,
            anyType => "anything",
            nullType => "null",
            boolType => "bool",
            integerType => "integer",
            doubleType => "double",
            stringType => "string",
            arrayType => this.unionFieldName(arrayType.items) + "Array",
            classType => decapitalize(defined(this.names.get(this.nameForNamedType(classType)))),
            mapType => this.unionFieldName(mapType.values) + "Map",
            enumType => "enumeration",
            unionType => "oneOf"
        );
    };

    private renderHeader = (): void => {
        if (!this._justTypes) {
            this.emitLine("// To parse the JSON, add this file to your project and do:");
            this.emitLine("//");
            this.forEachTopLevel("none", (t, name) => {
                this.emitLine("//   let ", modifySource(camelCase, name), " = ", name, ".from(json: jsonString)!");
            });
            this.emitNewline();
        }
        this.emitLine("import Foundation");
    };

    private renderTopLevelAlias = (t: Type, name: Name): void => {
        this.emitLine("typealias ", name, " = ", this.swiftType(t, true));
    };

    private getCodableString = (): Sourcelike => {
        return this.swift3OrPlainCase("", ": Codable");
    };

    private renderClassDefinition = (c: ClassType, className: Name): void => {
        const structOrClass = this._useClasses ? "class" : "struct";
        const codableString = this.getCodableString();
        this.emitBlock([structOrClass, " ", className, codableString], () => {
            this.forEachProperty(c, "none", (name, jsonName, t) => {
                this.emitLine("let ", name, ": ", this.swiftType(t, true));
            });
        });
    };

    private renderEnumDefinition = (e: EnumType, enumName: Name): void => {
        const codableString = this.getCodableString();
        this.emitBlock(["enum ", enumName, codableString], () => {
            this.forEachCase(e, "none", name => {
                this.emitLine("case ", name);
            });
        });
    };

    private renderUnionDefinition = (u: UnionType, unionName: Name): void => {
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        const codableString = this.getCodableString();
        this.emitBlock(["enum ", unionName, codableString], () => {
            nonNulls.forEach(t => {
                this.emitLine("case ", this.unionFieldName(t), "(", this.swiftType(t), ")");
            });
            if (maybeNull) {
                this.emitLine("case ", this.unionFieldName(maybeNull));
            }
        });
    };

    private renderTopLevelExtensions4 = (t: Type, topLevelName: Name): void => {
        const typeSource = this.swiftType(t);
        let extensionSource: Sourcelike;
        if (t instanceof ArrayType) {
            extensionSource = ["Array where Element == ", this.swiftType(t.items)];
        } else if (t instanceof MapType) {
            extensionSource = ["Dictionary where Key == String, Value == ", this.swiftType(t.values)];
        } else {
            extensionSource = typeSource;
        }

        this.emitBlock(["extension ", extensionSource], () => {
            this.emitBlock(
                ["static func from(json: String, using encoding: String.Encoding = .utf8) -> ", typeSource, "?"],
                () => {
                    this.emitLine("guard let data = json.data(using: encoding) else { return nil }");
                    this.emitLine("return from(data: data)");
                }
            );
            this.emitNewline();
            this.emitBlock(["static func from(data: Data) -> ", typeSource, "?"], () => {
                this.emitLine("let decoder = JSONDecoder()");
                this.emitLine("return try? decoder.decode(", typeSource, ".self, from: data)");
            });
            this.emitNewline();
            this.emitBlock(["static func from(url urlString: String) -> ", typeSource, "?"], () => {
                this.emitLine("guard let url = URL(string: urlString) else { return nil }");
                this.emitLine("guard let data = try? Data(contentsOf: url) else { return nil }");
                this.emitLine("return from(data: data)");
            });
            this.emitNewline();
            this.emitBlock("var jsonData: Data?", () => {
                this.emitLine("let encoder = JSONEncoder()");
                this.emitLine("return try? encoder.encode(self)");
            });
            this.emitNewline();
            this.emitBlock("var jsonString: String?", () => {
                this.emitLine("guard let data = self.jsonData else { return nil }");
                this.emitLine("return String(data: data, encoding: .utf8)");
            });
        });
    };

    private renderClassExtensions4 = (c: ClassType, className: Name): void => {
        if (c.properties.isEmpty()) return;
        this.emitBlock(["extension ", className], () => {
            this.emitBlock("enum CodingKeys: String, CodingKey", () => {
                this.forEachProperty(c, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ' = "', stringEscape(jsonName), '"');
                });
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

    private renderEnumExtensions4 = (e: EnumType, enumName: Name): void => {
        this.emitBlock(["extension ", enumName], () => {
            this.emitBlock("init(from decoder: Decoder) throws", () => {
                this.emitLine("let container = try decoder.singleValueContainer()");
                this.emitBlock(["if let x = try? container.decode(String.self)"], () => {
                    this.emitLine("switch x {");
                    this.forEachCase(e, "none", (name, jsonName) => {
                        this.emitLine('case "', stringEscape(jsonName), '":');
                        this.indent(() => {
                            this.emitLine("self = .", name);
                            this.emitLine("return");
                        });
                    });
                    this.emitLine("default:");
                    this.indent(() => this.emitLine("break"));
                    this.emitLine("}");
                });
                this.emitDecodingError(enumName);
            });
            this.emitNewline();
            this.emitBlock("func encode(to encoder: Encoder) throws", () => {
                this.emitLine("var container = encoder.singleValueContainer()");
                this.emitLine("switch self {");
                this.forEachCase(e, "none", (name, jsonName) => {
                    this.emitLine("case .", name, ":");
                    this.indent(() => this.emitLine('try container.encode("', stringEscape(jsonName), '")'));
                });
                this.emitLine("}");
            });
        });
    };

    private renderUnionCase = (t: Type): void => {
        this.emitBlock(["if let x = try? container.decode(", this.swiftType(t), ".self)"], () => {
            this.emitLine("self = .", this.unionFieldName(t), "(x)");
            this.emitLine("return");
        });
    };

    private renderUnionExtensions4 = (u: UnionType, unionName: Name): void => {
        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        this.emitBlock(["extension ", unionName], () => {
            this.emitBlock("init(from decoder: Decoder) throws", () => {
                this.emitLine("let container = try decoder.singleValueContainer()");
                const boolMember = u.findMember("bool");
                if (boolMember) this.renderUnionCase(boolMember);
                const integerMember = u.findMember("integer");
                if (integerMember) this.renderUnionCase(integerMember);
                nonNulls.forEach(t => {
                    if (t.kind === "bool" || t.kind === "integer") return;
                    this.renderUnionCase(t);
                });
                if (maybeNull) {
                    this.emitBlock("if container.decodeNil()", () => {
                        this.emitLine("self = .", this.unionFieldName(maybeNull));
                        this.emitLine("return");
                    });
                }
                this.emitDecodingError(unionName);
            });
            this.emitNewline();
            this.emitBlock("func encode(to encoder: Encoder) throws", () => {
                this.emitLine("var container = encoder.singleValueContainer()");
                this.emitLine("switch self {");
                nonNulls.forEach(t => {
                    this.emitLine("case .", this.unionFieldName(t), "(let x):");
                    this.indent(() => this.emitLine("try container.encode(x)"));
                });
                if (maybeNull) {
                    this.emitLine("case .", this.unionFieldName(maybeNull), ":");
                    this.indent(() => this.emitLine("try container.encodeNil()"));
                }
                this.emitLine("}");
            });
        });
    };

    private emitSupportFunctions4 = (): void => {
        const anyAndNullSet = this.typeGraph.filterTypes((t): t is Type => t.kind === "any" || t.kind === "null");
        const needAny = anyAndNullSet.some(t => t.kind === "any");
        const needNull = anyAndNullSet.some(t => t.kind === "null");
        if (needAny || needNull) {
            this.emitLine("// Helpers");
            this.emitNewline();
            this.emitMultiline(`class JSONNull: Codable {
    public init() {
    }
    
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
        if (needAny) {
            this.emitNewline();
            this.emitMultiline(`class JSONCodingKey : CodingKey {
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

        this.forEachTopLevel("leading", this.renderTopLevelAlias, t => !this.namedTypeToNameForTopLevel(t));

        this.forEachNamedType(
            "leading-and-interposing",
            false,
            this.renderClassDefinition,
            this.renderEnumDefinition,
            this.renderUnionDefinition
        );

        if (!this._justTypes) {
            this.emitNewline();
            this.emitMark("Top-level extensions", true);
            this.forEachTopLevel("leading-and-interposing", this.renderTopLevelExtensions4);
            this.emitNewline();
            this.emitMark("Codable extensions", true);
            this.forEachNamedType(
                "leading-and-interposing",
                false,
                this.renderClassExtensions4,
                this.renderEnumExtensions4,
                this.renderUnionExtensions4
            );
            this.emitNewline();
            this.emitSupportFunctions4();
        }
    }
}
