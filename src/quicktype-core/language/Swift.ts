import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType, ArrayType, MapType, TypeKind, ClassProperty } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { BooleanOption, EnumOption, Option, StringOption, OptionValues, getOptionValues } from "../RendererOptions";
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
    camelCase,
    addPrefixIfNecessary
} from "../support/Strings";
import { RenderContext } from "../Renderer";
import { arrayIntercalate } from "../support/Containers";

const MAX_SAMELINE_PROPERTIES = 4;

export const swiftOptions = {
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    convenienceInitializers: new BooleanOption("initializers", "Convenience initializers", true),
    urlSession: new BooleanOption("url-session", "URLSession task extensions", false),
    alamofire: new BooleanOption("alamofire", "Alamofire extensions", false),
    namedTypePrefix: new StringOption("type-prefix", "Prefix for type names", "PREFIX", "", "secondary"),
    useClasses: new EnumOption("struct-or-class", "Structs or classes", [["struct", false], ["class", true]]),
    dense: new EnumOption("density", "Code density", [["dense", true], ["normal", false]], "dense", "secondary"),
    accessLevel: new EnumOption(
        "access-level",
        "Access level",
        [["internal", "internal"], ["public", "public"]],
        "internal",
        "secondary"
    )
};

export class SwiftTargetLanguage extends TargetLanguage {
    constructor() {
        super("Swift", ["swift", "swift4"], "swift");
    }

    protected getOptions(): Option<any>[] {
        return [
            swiftOptions.justTypes,
            swiftOptions.useClasses,
            swiftOptions.dense,
            swiftOptions.convenienceInitializers,
            swiftOptions.accessLevel,
            swiftOptions.urlSession,
            swiftOptions.alamofire,
            swiftOptions.namedTypePrefix
        ];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: { [name: string]: any }): SwiftRenderer {
        return new SwiftRenderer(this, renderContext, getOptionValues(swiftOptions, untypedOptionValues));
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

function swiftNameStyle(prefix: string, isUpper: boolean, original: string): string {
    const words = splitIntoWords(original);
    const combined = combineWords(
        words,
        legalizeName,
        isUpper ? firstUpperWordStyle : allLowerWordStyle,
        firstUpperWordStyle,
        isUpper ? allUpperWordStyle : allLowerWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
    return addPrefixIfNecessary(prefix, combined);
}

function unicodeEscape(codePoint: number): string {
    return "\\u{" + intToHex(codePoint, 0) + "}";
}

const stringEscape = utf32ConcatMap(escapeNonPrintableMapper(isPrintable, unicodeEscape));

const lowerNamingFunction = funPrefixNamer("lower", s => swiftNameStyle("", false, s));

export class SwiftRenderer extends ConvenienceRenderer {
    private _needAny: boolean = false;
    private _needNull: boolean = false;

    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof swiftOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        if (this._options.alamofire) {
            return ["DataRequest", ...keywords];
        }
        return keywords;
    }

    protected forbiddenForObjectProperties(_c: ClassType, _classNamed: Name): ForbiddenWordsInfo {
        return { names: ["fromURL", "json"], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("upper", s => swiftNameStyle(this._options.namedTypePrefix, true, s));
    }

    protected namerForObjectProperty(): Namer {
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

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, "/// ");
    }

    private emitBlock = (line: Sourcelike, f: () => void): void => {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    };

    private emitBlockWithAccess(line: Sourcelike, f: () => void): void {
        this.emitBlock([this.accessLevel, line], f);
    }

    private justTypesCase = (justTypes: Sourcelike, notJustTypes: Sourcelike): Sourcelike => {
        if (this._options.justTypes) return justTypes;
        else return notJustTypes;
    };

    protected swiftType(t: Type, withIssues: boolean = false, noOptional: boolean = false): Sourcelike {
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
    }

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
            this.emitCommentLines(this.leadingComments);
        } else if (!this._options.justTypes) {
            this.emitLine("// To parse the JSON, add this file to your project and do:");
            this.emitLine("//");
            this.forEachTopLevel("none", (t, name) => {
                if (this._options.convenienceInitializers && !(t instanceof EnumType)) {
                    this.emitLine("//   let ", modifySource(camelCase, name), " = try ", name, "(json)");
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

            if (this._options.urlSession) {
                this.emitLine("//");
                this.emitLine("// To read values from URLs:");
                this.forEachTopLevel("none", (_, name) => {
                    const lowerName = modifySource(camelCase, name);
                    this.emitLine("//");
                    this.emitLine(
                        "//   let task = URLSession.shared.",
                        lowerName,
                        "Task(with: url) { ",
                        lowerName,
                        ", response, error in"
                    );
                    this.emitLine("//     if let ", lowerName, " = ", lowerName, " {");
                    this.emitLine("//       ...");
                    this.emitLine("//     }");
                    this.emitLine("//   }");
                    this.emitLine("//   task.resume()");
                });
            }

            if (this._options.alamofire) {
                this.emitLine("//");
                this.emitLine("// To parse values from Alamofire responses:");
                this.forEachTopLevel("none", (_, name) => {
                    this.emitLine("//");
                    this.emitLine("//   Alamofire.request(url).response", name, " { response in");
                    this.emitLine("//     if let ", modifySource(camelCase, name), " = response.result.value {");
                    this.emitLine("//       ...");
                    this.emitLine("//     }");
                    this.emitLine("//   }");
                });
            }
        }
        this.ensureBlankLine();
        this.emitLine("import Foundation");
        if (!this._options.justTypes && this._options.alamofire) {
            this.emitLine("import Alamofire");
        }
    };

    private renderTopLevelAlias = (t: Type, name: Name): void => {
        this.emitLine("typealias ", name, " = ", this.swiftType(t, true));
    };

    private getProtocolString = (): Sourcelike => {
        let protocols: string[] = [];
        if (!this._options.justTypes) {
            protocols.push("Codable");
        }
        return protocols.length > 0 ? ": " + protocols.join(", ") : "";
    };

    private getEnumPropertyGroups(c: ClassType) {
        type PropertyGroup = { name: Name; label?: string }[];

        let groups: PropertyGroup[] = [];
        let group: PropertyGroup = [];

        this.forEachClassProperty(c, "none", (name, jsonName) => {
            const label = stringEscape(jsonName);
            const redundant = this.sourcelikeToString(name) === label;

            if (this._options.dense && redundant) {
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
    }

    /// Access level with trailing space (e.g. "public "), or empty string
    private get accessLevel(): string {
        return this._options.accessLevel === "internal"
            ? "" // internal is default, so we don't have to emit it
            : this._options.accessLevel + " ";
    }

    private renderClassDefinition = (c: ClassType, className: Name): void => {
        const swiftType = (p: ClassProperty) => {
            if (p.isOptional) {
                return [this.swiftType(p.type, true, true), "?"];
            } else {
                return this.swiftType(p.type, true);
            }
        };

        this.emitDescription(this.descriptionForType(c));

        const isClass = this._options.useClasses || this.isCycleBreakerType(c);
        const structOrClass = isClass ? "class" : "struct";
        this.emitBlockWithAccess([structOrClass, " ", className, this.getProtocolString()], () => {
            if (this._options.dense) {
                let lastProperty: ClassProperty | undefined = undefined;
                let lastNames: Name[] = [];

                const emitLastProperty = () => {
                    if (lastProperty === undefined) return;

                    let sources: Sourcelike[] = [[this.accessLevel, "let "]];
                    lastNames.forEach((n, i) => {
                        if (i > 0) sources.push(", ");
                        sources.push(n);
                    });
                    sources.push(": ");
                    sources.push(swiftType(lastProperty));
                    this.emitLine(sources);

                    lastProperty = undefined;
                    lastNames = [];
                };

                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const description = this.descriptionForClassProperty(c, jsonName);
                    if (
                        !p.equals(lastProperty) ||
                        lastNames.length >= MAX_SAMELINE_PROPERTIES ||
                        description !== undefined
                    ) {
                        emitLastProperty();
                    }
                    if (lastProperty === undefined) {
                        lastProperty = p;
                    }
                    lastNames.push(name);
                    if (description !== undefined) {
                        this.emitDescription(description);
                        emitLastProperty();
                    }
                });
                emitLastProperty();
            } else {
                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const description = this.descriptionForClassProperty(c, jsonName);
                    this.emitDescription(description);
                    this.emitLine(this.accessLevel, "let ", name, ": ", swiftType(p));
                });
            }

            if (!this._options.justTypes) {
                const groups = this.getEnumPropertyGroups(c);
                const allPropertiesRedundant = groups.every(group => {
                    return group.every(p => p.label === undefined);
                });
                if (!allPropertiesRedundant && c.getProperties().size > 0) {
                    this.ensureBlankLine();
                    this.emitBlock("enum CodingKeys: String, CodingKey", () => {
                        for (const group of groups) {
                            const { name, label } = group[0];
                            if (label !== undefined) {
                                this.emitLine("case ", name, ' = "', label, '"');
                            } else {
                                const names = arrayIntercalate<Sourcelike>(", ", group.map(p => p.name));
                                this.emitLine("case ", names);
                            }
                        }
                    });
                }
            }

            // this main initializer must be defined within the class
            // declaration since it assigns let constants
            if (isClass) {
                // Make an initializer that initalizes all fields
                this.ensureBlankLine();
                let properties: Sourcelike[] = [];
                this.forEachClassProperty(c, "none", (name, _, p) => {
                    if (properties.length > 0) properties.push(", ");
                    properties.push(name, ": ", swiftType(p));
                });
                this.emitBlockWithAccess(["init(", ...properties, ")"], () => {
                    this.forEachClassProperty(c, "none", name => {
                        this.emitLine("self.", name, " = ", name);
                    });
                });
            }
        });
    };

    private emitConvenienceInitializersExtension = (c: ClassType, className: Name): void => {
        const isClass = this._options.useClasses || this.isCycleBreakerType(c);
        const convenience = isClass ? "convenience " : "";

        this.emitBlockWithAccess(["extension ", className], () => {
            if (isClass) {
                this.emitBlockWithAccess("convenience init(data: Data) throws", () => {
                    this.emitLine("let me = try JSONDecoder().decode(", this.swiftType(c), ".self, from: data)");
                    let args: Sourcelike[] = [];
                    this.forEachClassProperty(c, "none", name => {
                        if (args.length > 0) args.push(", ");
                        args.push(name, ": ", "me.", name);
                    });
                    this.emitLine("self.init(", ...args, ")");
                });
            } else {
                this.emitBlockWithAccess("init(data: Data) throws", () => {
                    this.emitLine("self = try JSONDecoder().decode(", this.swiftType(c), ".self, from: data)");
                });
            }
            this.ensureBlankLine();
            this.emitBlockWithAccess(
                [convenience, "init(_ json: String, using encoding: String.Encoding = .utf8) throws"],
                () => {
                    this.emitBlock("guard let data = json.data(using: encoding) else", () => {
                        this.emitLine(`throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)`);
                    });
                    this.emitLine("try self.init(data: data)");
                }
            );
            this.ensureBlankLine();
            this.emitBlockWithAccess([convenience, `init(fromURL url: URL) throws`], () => {
                this.emitLine("try self.init(data: try Data(contentsOf: url))");
            });

            // Convenience serializers
            this.ensureBlankLine();
            this.emitBlockWithAccess(`func jsonData() throws -> Data`, () => {
                this.emitLine("return try JSONEncoder().encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlockWithAccess(`func jsonString(encoding: String.Encoding = .utf8) throws -> String?`, () => {
                this.emitLine("return String(data: try self.jsonData(), encoding: encoding)");
            });
        });
    };

    private renderEnumDefinition = (e: EnumType, enumName: Name): void => {
        this.emitDescription(this.descriptionForType(e));

        if (this._options.justTypes) {
            this.emitBlockWithAccess(["enum ", enumName], () => {
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine("case ", name);
                });
            });
        } else {
            this.emitBlockWithAccess(["enum ", enumName, ": String, Codable"], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ' = "', stringEscape(jsonName), '"');
                });
            });
        }
    };

    private renderUnionDefinition = (u: UnionType, unionName: Name): void => {
        function sortBy(t: Type): string {
            const kind = t.kind;
            if (kind === "class") return kind;
            return "_" + kind;
        }

        const renderUnionCase = (t: Type): void => {
            this.emitBlock(["if let x = try? container.decode(", this.swiftType(t), ".self)"], () => {
                this.emitLine("self = .", this.nameForUnionMember(u, t), "(x)");
                this.emitLine("return");
            });
        };

        this.emitDescription(this.descriptionForType(u));

        const indirect = this.isCycleBreakerType(u) ? "indirect " : "";
        const [maybeNull, nonNulls] = removeNullFromUnion(u, sortBy);
        this.emitBlockWithAccess([indirect, "enum ", unionName, this.getProtocolString()], () => {
            this.forEachUnionMember(u, nonNulls, "none", null, (name, t) => {
                this.emitLine("case ", name, "(", this.swiftType(t), ")");
            });
            if (maybeNull !== null) {
                this.emitLine("case ", this.nameForUnionMember(u, maybeNull));
            }

            if (!this._options.justTypes) {
                this.ensureBlankLine();
                this.emitBlockWithAccess("init(from decoder: Decoder) throws", () => {
                    this.emitLine("let container = try decoder.singleValueContainer()");
                    const boolMember = u.findMember("bool");
                    if (boolMember !== undefined) renderUnionCase(boolMember);
                    const integerMember = u.findMember("integer");
                    if (integerMember !== undefined) renderUnionCase(integerMember);
                    for (const t of nonNulls) {
                        if (t.kind === "bool" || t.kind === "integer") continue;
                        renderUnionCase(t);
                    }
                    if (maybeNull !== null) {
                        this.emitBlock("if container.decodeNil()", () => {
                            this.emitLine("self = .", this.nameForUnionMember(u, maybeNull));
                            this.emitLine("return");
                        });
                    }
                    this.emitDecodingError(unionName);
                });
                this.ensureBlankLine();
                this.emitBlockWithAccess("func encode(to encoder: Encoder) throws", () => {
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

        this.emitBlockWithAccess(["extension ", extensionSource], () => {
            this.emitBlock(["init(data: Data) throws"], () => {
                this.emitLine("self = try JSONDecoder().decode(", name, ".self, from: data)");
            });
            this.ensureBlankLine();
            this.emitBlockWithAccess("init(_ json: String, using encoding: String.Encoding = .utf8) throws", () => {
                this.emitBlock("guard let data = json.data(using: encoding) else", () => {
                    this.emitLine(`throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)`);
                });
                this.emitLine("try self.init(data: data)");
            });
            this.ensureBlankLine();
            this.emitBlockWithAccess(`init(fromURL url: URL) throws`, () => {
                this.emitLine("try self.init(data: try Data(contentsOf: url))");
            });
            this.ensureBlankLine();
            this.emitBlockWithAccess("func jsonData() throws -> Data", () => {
                this.emitLine("return try JSONEncoder().encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlockWithAccess("func jsonString(encoding: String.Encoding = .utf8) throws -> String?", () => {
                this.emitLine("return String(data: try self.jsonData(), encoding: encoding)");
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
            this.emitMultiline(`${this.accessLevel}class JSONNull: Codable {
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

${this.accessLevel}class JSONAny: Codable {
    ${this.accessLevel}let value: Any
    
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

    protected emitMark(line: Sourcelike, horizontalLine: boolean = false) {
        this.emitLine("// MARK:", horizontalLine ? " - " : " ", line);
    }

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

        if (!this._options.justTypes) {
            // FIXME: We emit only the MARK line for top-level-enum.schema
            if (this._options.convenienceInitializers) {
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

        if (this._options.urlSession) {
            this.ensureBlankLine();
            this.emitMark("URLSession response handlers", true);
            this.ensureBlankLine();
            this.emitURLSessionExtension();
        }

        if (this._options.alamofire) {
            this.ensureBlankLine();
            this.emitMark("Alamofire response handlers", true);
            this.ensureBlankLine();
            this.emitAlamofireExtension();
        }
    }

    private emitURLSessionExtension() {
        this.ensureBlankLine();
        this.emitBlockWithAccess("extension URLSession", () => {
            this
                .emitMultiline(`fileprivate func codableTask<T: Codable>(with url: URL, completionHandler: @escaping (T?, URLResponse?, Error?) -> Void) -> URLSessionDataTask {
    return self.dataTask(with: url) { data, response, error in
        guard let data = data, error == nil else {
            completionHandler(nil, response, error)
            return
        }
        completionHandler(try? JSONDecoder().decode(T.self, from: data), response, nil)
    }
}`);
            this.ensureBlankLine();
            this.forEachTopLevel("leading-and-interposing", (_, name) => {
                this.emitBlockWithAccess(
                    [
                        "func ",
                        modifySource(camelCase, name),
                        "Task(with url: URL, completionHandler: @escaping (",
                        name,
                        "?, URLResponse?, Error?) -> Void) -> URLSessionDataTask"
                    ],
                    () => {
                        this.emitLine(`return self.codableTask(with: url, completionHandler: completionHandler)`);
                    }
                );
            });
        });
    }

    private emitAlamofireExtension() {
        this.ensureBlankLine();
        this.emitBlockWithAccess("extension DataRequest", () => {
            this
                .emitMultiline(`fileprivate func decodableResponseSerializer<T: Decodable>() -> DataResponseSerializer<T> {
    return DataResponseSerializer { _, response, data, error in
        guard error == nil else { return .failure(error!) }
        
        guard let data = data else {
            return .failure(AFError.responseSerializationFailed(reason: .inputDataNil))
        }
        
        return Result { try JSONDecoder().decode(T.self, from: data) }
    }
}

@discardableResult
fileprivate func responseDecodable<T: Decodable>(queue: DispatchQueue? = nil, completionHandler: @escaping (DataResponse<T>) -> Void) -> Self {
    return response(queue: queue, responseSerializer: decodableResponseSerializer(), completionHandler: completionHandler)
}`);
            this.ensureBlankLine();
            this.forEachTopLevel("leading-and-interposing", (_, name) => {
                this.emitLine("@discardableResult");
                this.emitBlockWithAccess(
                    [
                        "func response",
                        name,
                        "(queue: DispatchQueue? = nil, completionHandler: @escaping (DataResponse<",
                        name,
                        ">) -> Void) -> Self"
                    ],
                    () => {
                        this.emitLine(`return responseDecodable(queue: queue, completionHandler: completionHandler)`);
                    }
                );
            });
        });
    }
}
