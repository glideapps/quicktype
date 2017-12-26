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
    removeNullFromUnion,
    TypeKind
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import { Namespace, Name, Namer, funPrefixNamer, FixedName } from "../Naming";
import { BooleanOption, EnumOption } from "../RendererOptions";
import { Sourcelike, maybeAnnotated, modifySource } from "../Source";
import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../Annotation";
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
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allLowerWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";

export default class SwiftTargetLanguage extends TargetLanguage {
    private readonly _justTypesOption = new BooleanOption("just-types", "Plain types only", false);
    private readonly _classOption = new EnumOption("struct-or-class", "Generate structs or classes", [
        ["struct", false],
        ["class", true]
    ]);

    private readonly _denseOption = new EnumOption("density", "Code density", [["normal", false], ["dense", true]]);

    constructor() {
        super("Swift", ["swift", "swift4"], "swift");
        this.setOptions([this._justTypesOption, this._classOption, this._denseOption]);
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

const upperNamingFunction = funPrefixNamer(s => swiftNameStyle(true, s));
const lowerNamingFunction = funPrefixNamer(s => swiftNameStyle(false, s));

class SwiftRenderer extends ConvenienceRenderer {
    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        private readonly _useClasses: boolean,
        private readonly _dense: boolean
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
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumNamed: Name): { names: Name[]; namespaces: Namespace[] } {
        return { names: [], namespaces: [this.globalNamespace] };
    }

    protected topLevelNameStyle(rawName: string): string {
        return swiftNameStyle(true, rawName);
    }

    protected get namedTypeNamer(): Namer {
        return upperNamingFunction;
    }

    protected get classPropertyNamer(): Namer {
        return lowerNamingFunction;
    }

    protected get unionMemberNamer(): Namer {
        return lowerNamingFunction;
    }

    protected get enumCaseNamer(): Namer {
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
            _anyType => maybeAnnotated(withIssues, anyTypeIssueAnnotation, this.swift3OrPlainCase("Any?", "JSONAny")),
            _nullType =>
                maybeAnnotated(withIssues, nullTypeIssueAnnotation, this.swift3OrPlainCase("NSNull", "JSONNull?")),
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
                if (nullable) return [this.swiftType(nullable, withIssues), "?"];
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
                this.emitLine("//   let ", modifySource(camelCase, name), " = ", name, ".from(json: jsonString)!");
            });
        }
        this.ensureBlankLine();
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
            this.forEachClassProperty(c, "none", (name, _, t) => {
                this.emitLine("let ", name, ": ", this.swiftType(t, true));
            });
            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitBlock("enum CodingKeys: String, CodingKey", () => {
                    this.forEachClassProperty(c, "none", (name, jsonName) => {
                        const escaped = stringEscape(jsonName);
                        // TODO make this comparison valid
                        if (name.equals(jsonName)) {
                            this.emitLine("case ", name);
                        } else {
                            this.emitLine("case ", name, ' = "', escaped, '"');
                        }
                    });
                });
            }
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

        const [maybeNull, nonNulls] = removeNullFromUnion(u);
        const codableString = this.getCodableString();
        this.emitBlock(["enum ", unionName, codableString], () => {
            this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                this.emitLine("case ", name, "(", this.swiftType(t), ")");
            });
            if (maybeNull) {
                this.emitLine("case ", this.nameForUnionMember(u, maybeNull));
            }

            if (!this._justTypes) {
                this.ensureBlankLine();
                this.emitBlock("init(from decoder: Decoder) throws", () => {
                    this.emitLine("let container = try decoder.singleValueContainer()");
                    const boolMember = u.findMember("bool");
                    if (boolMember) renderUnionCase(boolMember);
                    const integerMember = u.findMember("integer");
                    if (integerMember) renderUnionCase(integerMember);
                    nonNulls.forEach(t => {
                        if (t.kind === "bool" || t.kind === "integer") return;
                        renderUnionCase(t);
                    });
                    if (maybeNull) {
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
                    if (maybeNull) {
                        this.emitLine("case .", this.nameForUnionMember(u, maybeNull), ":");
                        this.indent(() => this.emitLine("try container.encodeNil()"));
                    }
                    this.emitLine("}");
                });
            }
        });
    };

    private renderTopLevelExtensions4 = (t: Type, _: Name): void => {
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
            this.ensureBlankLine();
            this.emitBlock(["static func from(data: Data) -> ", typeSource, "?"], () => {
                this.emitLine("let decoder = JSONDecoder()");
                this.emitLine("return try? decoder.decode(", typeSource, ".self, from: data)");
            });
            this.ensureBlankLine();
            this.emitBlock(["static func from(url urlString: String) -> ", typeSource, "?"], () => {
                this.emitLine("guard let url = URL(string: urlString) else { return nil }");
                this.emitLine("guard let data = try? Data(contentsOf: url) else { return nil }");
                this.emitLine("return from(data: data)");
            });
            this.ensureBlankLine();
            this.emitBlock("var jsonData: Data?", () => {
                this.emitLine("let encoder = JSONEncoder()");
                this.emitLine("return try? encoder.encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlock("var jsonString: String?", () => {
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
        const anyAndNullSet = this.typeGraph.filterTypes((t): t is Type => t.kind === "any" || t.kind === "null");
        const needAny = anyAndNullSet.some(t => t.kind === "any");
        const needNull = anyAndNullSet.some(t => t.kind === "null");
        if (needAny || needNull) {
            this.emitLine("// Helpers");
            this.ensureBlankLine();
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
            this.ensureBlankLine();
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
            this.ensureBlankLine();
            this.emitMark("Top-level extensions", true);
            this.forEachTopLevel("leading-and-interposing", this.renderTopLevelExtensions4);
            this.ensureBlankLine();
            this.emitSupportFunctions4();
        }
    }
}
