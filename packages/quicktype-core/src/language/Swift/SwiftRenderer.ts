import { arrayIntercalate } from "collection-utils";

import { anyTypeIssueAnnotation, nullTypeIssueAnnotation } from "../../Annotation";
import { ConvenienceRenderer, type ForbiddenWordsInfo } from "../../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import { type RenderContext } from "../../Renderer";
import { type OptionValues } from "../../RendererOptions";
import { type Sourcelike, maybeAnnotated, modifySource } from "../../Source";
import { acronymStyle } from "../../support/Acronyms";
import { camelCase } from "../../support/Strings";
import { assert, defined, panic } from "../../support/Support";
import { type TargetLanguage } from "../../TargetLanguage";
import {
    ArrayType,
    type ClassProperty,
    type ClassType,
    EnumType,
    MapType,
    type Type,
    type TypeKind,
    type UnionType
} from "../../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../../TypeUtils";

import { keywords } from "./constants";
import { type swiftOptions } from "./language";
import { MAX_SAMELINE_PROPERTIES, type SwiftProperty, stringEscape, swiftNameStyle } from "./utils";

export class SwiftRenderer extends ConvenienceRenderer {
    private _currentFilename: string | undefined;

    private _needAny = false;

    private _needNull = false;

    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _options: OptionValues<typeof swiftOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected forbiddenNamesForGlobalNamespace(): readonly string[] {
        if (this._options.alamofire) {
            return ["DataRequest", ...keywords] as const;
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
        return funPrefixNamer("upper", s =>
            swiftNameStyle(this._options.namedTypePrefix, true, s, acronymStyle(this._options.acronymStyle))
        );
    }

    protected namerForObjectProperty(): Namer {
        return this.lowerNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return this.lowerNamingFunction;
    }

    protected makeEnumCaseNamer(): Namer {
        return this.lowerNamingFunction;
    }

    protected isImplicitCycleBreaker(t: Type): boolean {
        const kind = t.kind;
        return kind === "array" || kind === "map";
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, { lineStart: "/// " });
    }

    private emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    private emitBlockWithAccess(line: Sourcelike, f: () => void): void {
        this.emitBlock([this.accessLevel, line], f);
    }

    private justTypesCase(justTypes: Sourcelike, notJustTypes: Sourcelike): Sourcelike {
        if (this._options.justTypes) return justTypes;
        else return notJustTypes;
    }

    private get lowerNamingFunction(): Namer {
        return funPrefixNamer("lower", s => swiftNameStyle("", false, s, acronymStyle(this._options.acronymStyle)));
    }

    protected swiftPropertyType(p: ClassProperty): Sourcelike {
        if (p.isOptional || (this._options.optionalEnums && p.type.kind === "enum")) {
            return [this.swiftType(p.type, true, true), "?"];
        } else {
            return this.swiftType(p.type, true);
        }
    }

    protected swiftType(t: Type, withIssues = false, noOptional = false): Sourcelike {
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
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "Date";
                } else {
                    return panic(`Transformed string type ${transformedStringType.kind} not supported`);
                }
            }
        );
    }

    protected proposedUnionMemberNameForTypeKind(kind: TypeKind): string | null {
        if (kind === "enum") {
            return "enumeration";
        }

        if (kind === "union") {
            return "one_of";
        }

        return null;
    }

    private renderSingleFileHeaderComments(): void {
        this.emitLineOnce("// This file was generated from JSON Schema using quicktype, do not modify it directly.");
        this.emitLineOnce("// To parse the JSON, add this file to your project and do:");
        this.emitLineOnce("//");
        this.forEachTopLevel("none", (t, topLevelName) => {
            if (this._options.convenienceInitializers && !(t instanceof EnumType)) {
                this.emitLineOnce(
                    "//   let ",
                    modifySource(camelCase, topLevelName),
                    " = try ",
                    topLevelName,
                    "(json)"
                );
            } else {
                this.emitLineOnce(
                    "//   let ",
                    modifySource(camelCase, topLevelName),
                    " = ",
                    "try? JSONDecoder().decode(",
                    topLevelName,
                    ".self, from: jsonData)"
                );
            }
        });
    }

    private renderHeader(type: Type, name: Name): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else if (!this._options.justTypes) {
            if (this._options.multiFileOutput) {
                this.emitLineOnce(
                    "// This file was generated from JSON Schema using quicktype, do not modify it directly."
                );
                this.emitLineOnce("// To parse the JSON, add this file to your project and do:");
                this.emitLineOnce("//");
                if (this._options.convenienceInitializers && !(type instanceof EnumType)) {
                    this.emitLine("//   let ", modifySource(camelCase, name), " = try ", name, "(json)");
                } else {
                    this.emitLine(
                        "//   let ",
                        modifySource(camelCase, name),
                        " = ",
                        "try? newJSONDecoder().decode(",
                        name,
                        ".self, from: jsonData)"
                    );
                }
            }

            if (this._options.alamofire) {
                this.emitLine("//");
                this.emitLine("// To parse values from Alamofire responses:");
                this.emitLine("//");
                this.emitLine("//   Alamofire.request(url).response", name, " { response in");
                this.emitLine("//     if let ", modifySource(camelCase, name), " = response.result.value {");
                this.emitLine("//       ...");
                this.emitLine("//     }");
                this.emitLine("//   }");
            }

            if (this._options.protocol.hashable || this._options.protocol.equatable) {
                this.emitLine("//");
                this.emitLine("// Hashable or Equatable:");
                this.emitLine(
                    "// The compiler will not be able to synthesize the implementation of Hashable or Equatable"
                );
                this.emitLine(
                    "// for types that require the use of JSONAny, nor will the implementation of Hashable be"
                );
                this.emitLine("// synthesized for types that have collections (such as arrays or dictionaries).");
            }
        }

        this.ensureBlankLine();
        this.emitLineOnce("import Foundation");
        if (!this._options.justTypes && this._options.alamofire) {
            this.emitLineOnce("import Alamofire");
        }

        if (this._options.optionalEnums) {
            this.emitLineOnce("import OptionallyDecodable // https://github.com/idrougge/OptionallyDecodable");
        }

        this.ensureBlankLine();
    }

    private renderTopLevelAlias(t: Type, name: Name): void {
        this.emitLine(this.accessLevel, "typealias ", name, " = ", this.swiftType(t, true));
    }

    protected getProtocolsArray(kind: "struct" | "class" | "enum"): string[] {
        const protocols: string[] = [];

        // [Michael Fey (@MrRooni), 2019-4-24] Technically NSObject isn't a "protocol" in this instance, but this felt like the best place to slot in this superclass declaration.
        const isClass = kind === "class";

        if (isClass && this._options.objcSupport) {
            protocols.push("NSObject");
        }

        if (!this._options.justTypes) {
            protocols.push("Codable");
        }

        if (this._options.protocol.hashable) {
            protocols.push("Hashable");
        }

        if (this._options.protocol.equatable) {
            protocols.push("Equatable");
        }

        if (this._options.sendable && (!this._options.mutableProperties || !isClass) && !this._options.objcSupport) {
            protocols.push("Sendable");
        }

        return protocols;
    }

    private getProtocolString(
        kind: "struct" | "class" | "enum",
        baseClass: string | undefined = undefined
    ): Sourcelike {
        let protocols = this.getProtocolsArray(kind);
        if (baseClass) {
            protocols.unshift(baseClass);
        }

        return protocols.length > 0 ? ": " + protocols.join(", ") : "";
    }

    private getEnumPropertyGroups(c: ClassType): typeof groups {
        type PropertyGroup = Array<{ label?: string; name: Name }>;

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

    private get objcMembersDeclaration(): string {
        if (this._options.objcSupport) {
            return "@objcMembers ";
        }

        return "";
    }

    /// startFile takes a file name, appends ".swift" to it and sets it as the current filename.
    protected startFile(basename: Sourcelike): void {
        if (this._options.multiFileOutput === false) {
            return;
        }

        assert(this._currentFilename === undefined, "Previous file wasn't finished: " + this._currentFilename);
        // FIXME: The filenames should actually be Sourcelikes, too
        this._currentFilename = `${this.sourcelikeToString(basename)}.swift`;
        this.initializeEmitContextForFilename(this._currentFilename);
    }

    /// endFile pushes the current file name onto the collection of finished files and then resets the current file name. These finished files are used in index.ts to write the output.
    protected endFile(): void {
        if (this._options.multiFileOutput === false) {
            return;
        }

        this.finishFile(defined(this._currentFilename));
        this._currentFilename = undefined;
    }

    protected propertyLinesDefinition(name: Name, parameter: ClassProperty): Sourcelike {
        const useMutableProperties = this._options.mutableProperties;
        return [
            this.accessLevel,
            useMutableProperties ? "var " : "let ",
            name,
            ": ",
            this.swiftPropertyType(parameter)
        ];
    }

    private renderClassDefinition(c: ClassType, className: Name): void {
        this.startFile(className);

        this.renderHeader(c, className);
        this.emitDescription(this.descriptionForType(c));

        this.emitMark(this.sourcelikeToString(className), true);

        const isClass = this._options.useClasses || this.isCycleBreakerType(c);
        const structOrClass = isClass ? "class" : "struct";

        if (isClass && this._options.objcSupport) {
            // [Michael Fey (@MrRooni), 2019-4-24] Swift 5 or greater, must come before the access declaration for the class.
            this.emitItem(this.objcMembersDeclaration);
        }

        this.emitBlockWithAccess([structOrClass, " ", className, this.getProtocolString(structOrClass)], () => {
            if (this._options.dense) {
                let lastProperty: ClassProperty | undefined = undefined;
                let lastNames: Name[] = [];

                const emitLastProperty = (): void => {
                    if (lastProperty === undefined) return;

                    const useMutableProperties = this._options.mutableProperties;

                    let sources: Sourcelike[] = [
                        [
                            this._options.optionalEnums && lastProperty.type.kind === "enum"
                                ? "@OptionallyDecodable "
                                : "",
                            this.accessLevel,
                            useMutableProperties || (this._options.optionalEnums && lastProperty.type.kind === "enum")
                                ? "var "
                                : "let "
                        ]
                    ];
                    lastNames.forEach((n, i) => {
                        if (i > 0) sources.push(", ");
                        sources.push(n);
                    });
                    sources.push(": ");
                    sources.push(this.swiftPropertyType(lastProperty));
                    this.emitLine(sources);

                    lastProperty = undefined;
                    lastNames = [];
                };

                this.forEachClassProperty(c, "none", (name, jsonName, p) => {
                    const description = this.descriptionForClassProperty(c, jsonName);
                    if (
                        (lastProperty && !p.equals(lastProperty)) ||
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
                    const propertyLines = this.propertyLinesDefinition(name, p);
                    this.emitDescription(description);
                    this.emitLine(propertyLines);
                });
            }

            if (!this._options.justTypes) {
                const groups = this.getEnumPropertyGroups(c);
                const allPropertiesRedundant = groups.every(group => {
                    return group.every(p => p.label === undefined);
                });
                if (!allPropertiesRedundant && c.getProperties().size > 0) {
                    this.ensureBlankLine();
                    let enumDeclaration = this.accessLevel;
                    enumDeclaration += "enum CodingKeys: String, CodingKey";
                    if (this._options.codingKeysProtocol && this._options.codingKeysProtocol.length > 0) {
                        enumDeclaration += ", ";
                        enumDeclaration += this._options.codingKeysProtocol;
                    }

                    this.emitBlock(enumDeclaration, () => {
                        for (const group of groups) {
                            const { name, label } = group[0];
                            if (this._options.explicitCodingKeys && label !== undefined) {
                                this.emitLine("case ", name, ' = "', label, '"');
                            } else {
                                const names = arrayIntercalate<Sourcelike>(
                                    ", ",
                                    group.map(p => p.name)
                                );
                                this.emitLine("case ", names);
                            }
                        }
                    });
                }
            }

            // this main initializer must be defined within the class
            // declaration since it assigns let constants
            if (
                isClass ||
                // Public structs need explicit initializers
                // https://github.com/quicktype/quicktype/issues/899
                this._options.accessLevel === "public"
            ) {
                // Make an initializer that initalizes all fields
                this.ensureBlankLine();
                let initProperties = this.initializableProperties(c);
                let propertiesLines: Sourcelike[] = [];
                for (let property of initProperties) {
                    if (propertiesLines.length > 0) propertiesLines.push(", ");
                    propertiesLines.push(property.name, ": ", this.swiftPropertyType(property.parameter));
                }

                if (this.propertyCount(c) === 0 && this._options.objcSupport) {
                    this.emitBlockWithAccess(["override init()"], () => {
                        return "";
                    });
                } else {
                    this.emitBlockWithAccess(["init(", ...propertiesLines, ")"], () => {
                        for (let property of initProperties) {
                            this.emitLine("self.", property.name, " = ", property.name);
                        }
                    });
                }
            }
        });

        if (!this._options.justTypes) {
            // FIXME: We emit only the MARK line for top-level-enum.schema
            if (this._options.convenienceInitializers) {
                this.ensureBlankLine();
                this.emitMark(this.sourcelikeToString(className) + " convenience initializers and mutators");
                this.ensureBlankLine();
                this.emitConvenienceInitializersExtension(c, className);
                this.ensureBlankLine();
            }
        }

        this.endFile();
    }

    protected initializableProperties(c: ClassType): SwiftProperty[] {
        const properties: SwiftProperty[] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, parameter, position) => {
            const property = { name, jsonName, parameter, position };
            properties.push(property);
        });
        return properties;
    }

    private emitNewEncoderDecoder(): void {
        this.emitBlock("func newJSONDecoder() -> JSONDecoder", () => {
            this.emitLine("let decoder = JSONDecoder()");
            if (!this._options.linux) {
                this.emitBlock("if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *)", () => {
                    this.emitLine("decoder.dateDecodingStrategy = .iso8601");
                });
            } else {
                this.emitMultiline(`decoder.dateDecodingStrategy = .custom({ (decoder) -> Date in
	let container = try decoder.singleValueContainer()
	let dateStr = try container.decode(String.self)

	let formatter = DateFormatter()
	formatter.calendar = Calendar(identifier: .iso8601)
	formatter.locale = Locale(identifier: "en_US_POSIX")
	formatter.timeZone = TimeZone(secondsFromGMT: 0)
	formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
	if let date = formatter.date(from: dateStr) {
			return date
	}
	formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
	if let date = formatter.date(from: dateStr) {
			return date
	}
	throw DecodingError.typeMismatch(Date.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Could not decode date"))
})`);
            }

            this.emitLine("return decoder");
        });
        this.ensureBlankLine();
        this.emitBlock("func newJSONEncoder() -> JSONEncoder", () => {
            this.emitLine("let encoder = JSONEncoder()");
            if (!this._options.linux) {
                this.emitBlock("if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *)", () => {
                    this.emitLine("encoder.dateEncodingStrategy = .iso8601");
                });
            } else {
                this.emitMultiline(`let formatter = DateFormatter()
formatter.calendar = Calendar(identifier: .iso8601)
formatter.locale = Locale(identifier: "en_US_POSIX")
formatter.timeZone = TimeZone(secondsFromGMT: 0)
formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
encoder.dateEncodingStrategy = .formatted(formatter)`);
            }

            this.emitLine("return encoder");
        });
    }

    private emitConvenienceInitializersExtension(c: ClassType, className: Name): void {
        const isClass = this._options.useClasses || this.isCycleBreakerType(c);
        const convenience = isClass ? "convenience " : "";

        this.emitBlockWithAccess(["extension ", className], () => {
            if (isClass) {
                this.emitBlock("convenience init(data: Data) throws", () => {
                    if (this.propertyCount(c) > 0) {
                        this.emitLine("let me = try newJSONDecoder().decode(", this.swiftType(c), ".self, from: data)");
                    } else {
                        this.emitLine("let _ = try newJSONDecoder().decode(", this.swiftType(c), ".self, from: data)");
                    }

                    let args: Sourcelike[] = [];
                    this.forEachClassProperty(c, "none", name => {
                        if (args.length > 0) args.push(", ");
                        args.push(name, ": ", "me.", name);
                    });
                    this.emitLine("self.init(", ...args, ")");
                });
            } else {
                this.emitBlock("init(data: Data) throws", () => {
                    this.emitLine("self = try newJSONDecoder().decode(", this.swiftType(c), ".self, from: data)");
                });
            }

            this.ensureBlankLine();
            this.emitBlock(
                [convenience, "init(_ json: String, using encoding: String.Encoding = .utf8) throws"],
                () => {
                    this.emitBlock("guard let data = json.data(using: encoding) else", () => {
                        this.emitLine('throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)');
                    });
                    this.emitLine("try self.init(data: data)");
                }
            );
            this.ensureBlankLine();
            this.emitBlock([convenience, "init(fromURL url: URL) throws"], () => {
                this.emitLine("try self.init(data: try Data(contentsOf: url))");
            });

            this.ensureBlankLine();
            this.emitConvenienceMutator(c, className);

            // Convenience serializers
            this.ensureBlankLine();
            this.emitBlock("func jsonData() throws -> Data", () => {
                this.emitLine("return try newJSONEncoder().encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlock("func jsonString(encoding: String.Encoding = .utf8) throws -> String?", () => {
                this.emitLine("return String(data: try self.jsonData(), encoding: encoding)");
            });
        });
    }

    private renderEnumDefinition(e: EnumType, enumName: Name): void {
        this.startFile(enumName);

        this.emitLineOnce("import Foundation");
        this.ensureBlankLine();

        this.emitDescription(this.descriptionForType(e));
        const protocolString = this.getProtocolString("enum", "String");

        if (this._options.justTypes) {
            this.emitBlockWithAccess(["enum ", enumName, protocolString], () => {
                this.forEachEnumCase(e, "none", name => {
                    this.emitLine("case ", name);
                });
            });
        } else {
            this.emitBlockWithAccess(["enum ", enumName, protocolString], () => {
                this.forEachEnumCase(e, "none", (name, jsonName) => {
                    this.emitLine("case ", name, ' = "', stringEscape(jsonName), '"');
                });
            });
        }

        this.endFile();
    }

    private renderUnionDefinition(u: UnionType, unionName: Name): void {
        this.startFile(unionName);

        this.emitLineOnce("import Foundation");
        this.ensureBlankLine();

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
        this.emitBlockWithAccess([indirect, "enum ", unionName, this.getProtocolString("enum")], () => {
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
        this.endFile();
    }

    private emitTopLevelMapAndArrayConvenienceInitializerExtensions(t: Type, name: Name): void {
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
                this.emitLine("self = try newJSONDecoder().decode(", name, ".self, from: data)");
            });
            this.ensureBlankLine();
            this.emitBlock("init(_ json: String, using encoding: String.Encoding = .utf8) throws", () => {
                this.emitBlock("guard let data = json.data(using: encoding) else", () => {
                    this.emitLine('throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)');
                });
                this.emitLine("try self.init(data: data)");
            });
            this.ensureBlankLine();
            this.emitBlock("init(fromURL url: URL) throws", () => {
                this.emitLine("try self.init(data: try Data(contentsOf: url))");
            });
            this.ensureBlankLine();
            this.emitBlock("func jsonData() throws -> Data", () => {
                this.emitLine("return try newJSONEncoder().encode(self)");
            });
            this.ensureBlankLine();
            this.emitBlock("func jsonString(encoding: String.Encoding = .utf8) throws -> String?", () => {
                this.emitLine("return String(data: try self.jsonData(), encoding: encoding)");
            });
        });
    }

    private emitDecodingError(name: Name): void {
        this.emitLine(
            "throw DecodingError.typeMismatch(",
            name,
            '.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for ',
            name,
            '"))'
        );
    }

    private readonly emitSupportFunctions4 = (): void => {
        this.startFile("JSONSchemaSupport");

        this.emitLineOnce("import Foundation");

        this.forEachTopLevel(
            "leading",
            (t: Type, name: Name) => this.renderTopLevelAlias(t, name),
            t => this.namedTypeToNameForTopLevel(t) === undefined
        );

        if (this._options.convenienceInitializers) {
            this.ensureBlankLine();
            this.forEachTopLevel("leading-and-interposing", (t: Type, name: Name) =>
                this.emitTopLevelMapAndArrayConvenienceInitializerExtensions(t, name)
            );
        }

        if ((!this._options.justTypes && this._options.convenienceInitializers) || this._options.alamofire) {
            this.ensureBlankLine();
            this.emitMark("Helper functions for creating encoders and decoders", true);
            this.ensureBlankLine();
            this.emitNewEncoderDecoder();
        }

        if (this._options.alamofire) {
            this.ensureBlankLine();
            this.emitMark("Alamofire response handlers", true);
            this.ensureBlankLine();
            this.emitAlamofireExtension();
        }

        // This assumes that this method is called after declarations
        // are emitted.
        if (this._needAny || this._needNull) {
            this.ensureBlankLine();
            this.emitMark("Encode/decode helpers", true);
            this.ensureBlankLine();
            if (this._options.objcSupport) {
                this.emitLine(this.objcMembersDeclaration, this.accessLevel, "class JSONNull: NSObject, Codable {");
            } else {
                this.emitLine(this.accessLevel, "class JSONNull: Codable, Hashable {");
            }

            this.ensureBlankLine();
            this.emitMultiline(`    public static func == (lhs: JSONNull, rhs: JSONNull) -> Bool {
			return true
	}`);

            if (this._options.objcSupport === false) {
                this.ensureBlankLine();
                this.emitMultiline(`    public var hashValue: Int {
			return 0
	}`);

                if (this._options.swift5Support) {
                    this.ensureBlankLine();
                    this.emitMultiline(`    public func hash(into hasher: inout Hasher) {
			// No-op
	}`);
                }
            }

            this.ensureBlankLine();
            if (this._options.objcSupport) {
                this.emitItem("    override ");
            } else {
                this.emitItem("    ");
            }

            this.emitMultiline(`public init() {}
	
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
}`);

            this.ensureBlankLine();
            if (this._options.objcSupport) {
                this.emitLine(this.objcMembersDeclaration, this.accessLevel, "class JSONAny: NSObject, Codable {");
            } else {
                this.emitLine(this.accessLevel, "class JSONAny: Codable {");
            }

            this.ensureBlankLine();
            this.emitMultiline(`    ${this.accessLevel}let value: Any
	
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

        this.endFile();
    };

    private emitConvenienceMutator(c: ClassType, className: Name): void {
        this.emitLine("func with(");
        this.indent(() => {
            this.forEachClassProperty(c, "none", (name, _, p, position) => {
                this.emitLine(
                    name,
                    ": ",
                    this.swiftPropertyType(p),
                    "? = nil",
                    position !== "only" && position !== "last" ? "," : ""
                );
            });
        });
        this.emitBlock([") -> ", className], () => {
            this.emitLine("return ", className, "(");
            this.indent(() => {
                this.forEachClassProperty(c, "none", (name, _, _p, position) => {
                    this.emitLine(
                        name,
                        ": ",
                        name,
                        " ?? self.",
                        name,
                        position !== "only" && position !== "last" ? "," : ""
                    );
                });
            });
            this.emitLine(")");
        });
    }

    protected emitMark(line: Sourcelike, horizontalLine = false): void {
        this.emitLine("// MARK:", horizontalLine ? " - " : " ", line);
    }

    protected emitSourceStructure(): void {
        if (this._options.multiFileOutput === false) {
            this.renderSingleFileHeaderComments();
        }

        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.renderClassDefinition(c, className),
            (e: EnumType, enumName: Name) => this.renderEnumDefinition(e, enumName),
            (u: UnionType, unionName: Name) => this.renderUnionDefinition(u, unionName)
        );

        if (!this._options.justTypes) {
            this.emitSupportFunctions4();
        }
    }

    private emitAlamofireExtension(): void {
        this.ensureBlankLine();
        this.emitBlockWithAccess("extension DataRequest", () => {
            this
                .emitMultiline(`fileprivate func decodableResponseSerializer<T: Decodable>() -> DataResponseSerializer<T> {
	return DataResponseSerializer { _, response, data, error in
			guard error == nil else { return .failure(error!) }
			
			guard let data = data else {
					return .failure(AFError.responseSerializationFailed(reason: .inputDataNil))
			}
			
			return Result { try newJSONDecoder().decode(T.self, from: data) }
	}
}

@discardableResult
fileprivate func responseDecodable<T: Decodable>(queue: DispatchQueue? = nil, completionHandler: @escaping (DataResponse<T>) -> Void) -> Self {
	return response(queue: queue, responseSerializer: decodableResponseSerializer(), completionHandler: completionHandler)
}`);
            this.ensureBlankLine();
            this.forEachTopLevel("leading-and-interposing", (_, name) => {
                this.emitLine("@discardableResult");
                this.emitBlock(
                    [
                        "func response",
                        name,
                        "(queue: DispatchQueue? = nil, completionHandler: @escaping (DataResponse<",
                        name,
                        ">) -> Void) -> Self"
                    ],
                    () => {
                        this.emitLine("return responseDecodable(queue: queue, completionHandler: completionHandler)");
                    }
                );
            });
        });
    }
}
