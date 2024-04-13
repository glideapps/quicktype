import { arrayIntercalate } from "collection-utils";

import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../Naming";
import { type RenderContext } from "../Renderer";
import { BooleanOption, EnumOption, type Option, type OptionValues, getOptionValues } from "../RendererOptions";
import { type Sourcelike, modifySource } from "../Source";
import { AcronymStyleOptions, acronymOption, acronymStyle } from "../support/Acronyms";
import { ConvertersOptions, convertersOption } from "../support/Converters";
import {
    allLowerWordStyle,
    camelCase,
    capitalize,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16LegalizeCharacters,
    utf16StringEscape
} from "../support/Strings";
import { panic } from "../support/Support";
import { TargetLanguage } from "../TargetLanguage";
import {
    type ClassProperty,
    type ClassType,
    type ObjectType,
    type PrimitiveStringTypeKind,
    type TransformedStringTypeKind,
    type Type
} from "../Type";
import { type StringTypeMapping } from "../TypeBuilder";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../types";
import { directlyReachableSingleNamedType, matchType } from "../TypeUtils";

import { isES3IdentifierPart, isES3IdentifierStart } from "./JavaScriptUnicodeMaps";

export const javaScriptOptions = {
    acronymStyle: acronymOption(AcronymStyleOptions.Pascal),
    runtimeTypecheck: new BooleanOption("runtime-typecheck", "Verify JSON.parse results at runtime", true),
    runtimeTypecheckIgnoreUnknownProperties: new BooleanOption(
        "runtime-typecheck-ignore-unknown-properties",
        "Ignore unknown properties when verifying at runtime",
        false,
        "secondary"
    ),
    converters: convertersOption(),
    rawType: new EnumOption<"json" | "any">(
        "raw-type",
        "Type of raw input (json by default)",
        [
            ["json", "json"],
            ["any", "any"]
        ],
        "json",
        "secondary"
    )
};

export interface JavaScriptTypeAnnotations {
    any: string;
    anyArray: string;
    anyMap: string;
    boolean: string;
    never: string;
    string: string;
    stringArray: string;
}

export class JavaScriptTargetLanguage extends TargetLanguage {
    public constructor(displayName = "JavaScript", names: string[] = ["javascript", "js", "jsx"], extension = "js") {
        super(displayName, names, extension);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            javaScriptOptions.runtimeTypecheck,
            javaScriptOptions.runtimeTypecheckIgnoreUnknownProperties,
            javaScriptOptions.acronymStyle,
            javaScriptOptions.converters,
            javaScriptOptions.rawType
        ];
    }

    public get stringTypeMapping(): StringTypeMapping {
        const mapping: Map<TransformedStringTypeKind, PrimitiveStringTypeKind> = new Map();
        const dateTimeType = "date-time";
        mapping.set("date", dateTimeType);
        mapping.set("date-time", dateTimeType);
        return mapping;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    public get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): JavaScriptRenderer {
        return new JavaScriptRenderer(this, renderContext, getOptionValues(javaScriptOptions, untypedOptionValues));
    }
}

export const legalizeName = utf16LegalizeCharacters(isES3IdentifierPart);

const identityNamingFunction = funPrefixNamer("properties", s => s);

export class JavaScriptRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _jsOptions: OptionValues<typeof javaScriptOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected nameStyle(original: string, upper: boolean): string {
        const acronyms = acronymStyle(this._jsOptions.acronymStyle);
        const words = splitIntoWords(original);
        return combineWords(
            words,
            legalizeName,
            upper ? firstUpperWordStyle : allLowerWordStyle,
            firstUpperWordStyle,
            upper ? (s): string => capitalize(acronyms(s)) : allLowerWordStyle,
            acronyms,
            "",
            isES3IdentifierStart
        );
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", s => this.nameStyle(s, true));
    }

    protected namerForObjectProperty(): Namer {
        return identityNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-cases", s => this.nameStyle(s, true));
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected makeNameForProperty(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        _assignedName: string | undefined
    ): Name | undefined {
        // Ignore the assigned name
        return super.makeNameForProperty(c, className, p, jsonName, undefined);
    }

    protected emitDescriptionBlock(lines: Sourcelike[]): void {
        this.emitCommentLines(lines, { lineStart: " * ", beforeComment: "/**", afterComment: " */" });
    }

    private typeMapTypeFor(t: Type): Sourcelike {
        if (["class", "object", "enum"].includes(t.kind)) {
            return ['r("', this.nameForNamedType(t), '")'];
        }

        return matchType<Sourcelike>(
            t,
            _anyType => '"any"',
            _nullType => "null",
            _boolType => "true",
            _integerType => "0",
            _doubleType => "3.14",
            _stringType => '""',
            arrayType => ["a(", this.typeMapTypeFor(arrayType.items), ")"],
            _classType => panic("We handled this above"),
            mapType => ["m(", this.typeMapTypeFor(mapType.values), ")"],
            _enumType => panic("We handled this above"),
            unionType => {
                const children = Array.from(unionType.getChildren()).map((type: Type) => this.typeMapTypeFor(type));
                return ["u(", ...arrayIntercalate(", ", children), ")"];
            },
            transformedStringType => {
                if (transformedStringType.kind === "date-time") {
                    return "Date";
                }

                return '""';
            }
        );
    }

    private typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }

        return ["u(undefined, ", typeMap, ")"];
    }

    protected emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void): void {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }

    private emitTypeMap(): void {
        const { any: anyAnnotation } = this.typeAnnotations;

        this.emitBlock(`const typeMap${anyAnnotation} = `, ";", () => {
            this.forEachObject("none", (t: ObjectType, name: Name) => {
                const additionalProperties = t.getAdditionalProperties();
                const additional =
                    additionalProperties !== undefined ? this.typeMapTypeFor(additionalProperties) : "false";
                this.emitLine('"', name, '": o([');
                this.indent(() => {
                    this.forEachClassProperty(t, "none", (propName, jsonName, property) => {
                        this.emitLine(
                            '{ json: "',
                            utf16StringEscape(jsonName),
                            '", js: "',
                            modifySource(utf16StringEscape, propName),
                            '", typ: ',
                            this.typeMapTypeForProperty(property),
                            " },"
                        );
                    });
                });
                this.emitLine("], ", additional, "),");
            });
            this.forEachEnum("none", (e, name) => {
                this.emitLine('"', name, '": [');
                this.indent(() => {
                    this.forEachEnumCase(e, "none", (_caseName, jsonName) => {
                        this.emitLine(`"${utf16StringEscape(jsonName)}",`);
                    });
                });
                this.emitLine("],");
            });
        });
    }

    protected deserializerFunctionName(name: Name): Sourcelike {
        return ["to", name];
    }

    protected deserializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return ["function ", this.deserializerFunctionName(name), "(json)"];
    }

    protected serializerFunctionName(name: Name): Sourcelike {
        const camelCaseName = modifySource(camelCase, name);
        return [camelCaseName, "ToJson"];
    }

    protected serializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return ["function ", this.serializerFunctionName(name), "(value)"];
    }

    protected get moduleLine(): string | undefined {
        return undefined;
    }

    protected get castFunctionLines(): [string, string] {
        return ["function cast(val, typ)", "function uncast(val, typ)"];
    }

    protected get typeAnnotations(): JavaScriptTypeAnnotations {
        return {
            any: "",
            anyArray: "",
            anyMap: "",
            string: "",
            stringArray: "",
            boolean: "",
            never: ""
        };
    }

    protected emitConvertModuleBody(): void {
        const converter = (t: Type, name: Name): void => {
            const typeMap = this.typeMapTypeFor(t);
            this.emitBlock([this.deserializerFunctionLine(t, name), " "], "", () => {
                const parsedJson = this._jsOptions.rawType === "json" ? "JSON.parse(json)" : "json";
                if (!this._jsOptions.runtimeTypecheck) {
                    this.emitLine("return ", parsedJson, ";");
                } else {
                    this.emitLine("return cast(", parsedJson, ", ", typeMap, ");");
                }
            });
            this.ensureBlankLine();

            this.emitBlock([this.serializerFunctionLine(t, name), " "], "", () => {
                if (this._jsOptions.rawType === "json") {
                    if (!this._jsOptions.runtimeTypecheck) {
                        this.emitLine("return JSON.stringify(value);");
                    } else {
                        this.emitLine("return JSON.stringify(uncast(value, ", typeMap, "), null, 2);");
                    }
                } else {
                    if (!this._jsOptions.runtimeTypecheck) {
                        this.emitLine("return value;");
                    } else {
                        this.emitLine("return uncast(value, ", typeMap, ");");
                    }
                }
            });
        };

        switch (this._jsOptions.converters) {
            case ConvertersOptions.AllObjects:
                this.forEachObject("interposing", converter);
                break;

            default:
                this.forEachTopLevel("interposing", converter);
                break;
        }
    }

    protected emitConvertModuleHelpers(): void {
        if (this._jsOptions.runtimeTypecheck) {
            const {
                any: anyAnnotation,
                anyArray: anyArrayAnnotation,
                anyMap: anyMapAnnotation,
                string: stringAnnotation,
                stringArray: stringArrayAnnotation,
                never: neverAnnotation
            } = this.typeAnnotations;
            this.ensureBlankLine();
            this
                .emitMultiline(`function invalidValue(typ${anyAnnotation}, val${anyAnnotation}, key${anyAnnotation}, parent${anyAnnotation} = '')${neverAnnotation} {
    const prettyTyp = prettyTypeName(typ);
    const parentText = parent ? \` on \${parent}\` : '';
    const keyText = key ? \` for key "\${key}"\` : '';
    throw Error(\`Invalid value\${keyText}\${parentText}. Expected \${prettyTyp} but got \${JSON.stringify(val)}\`);
}

function prettyTypeName(typ${anyAnnotation})${stringAnnotation} {
    if (Array.isArray(typ)) {
        if (typ.length === 2 && typ[0] === undefined) {
            return \`an optional \${prettyTypeName(typ[1])}\`;
        } else {
            return \`one of [\${typ.map(a => { return prettyTypeName(a); }).join(", ")}]\`;
        }
    } else if (typeof typ === "object" && typ.literal !== undefined) {
        return typ.literal;
    } else {
        return typeof typ;
    }
}

function jsonToJSProps(typ${anyAnnotation})${anyAnnotation} {
    if (typ.jsonToJS === undefined) {
        const map${anyAnnotation} = {};
        typ.props.forEach((p${anyAnnotation}) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ${anyAnnotation})${anyAnnotation} {
    if (typ.jsToJSON === undefined) {
        const map${anyAnnotation} = {};
        typ.props.forEach((p${anyAnnotation}) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val${anyAnnotation}, typ${anyAnnotation}, getProps${anyAnnotation}, key${anyAnnotation} = '', parent${anyAnnotation} = '')${anyAnnotation} {
    function transformPrimitive(typ${stringAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key, parent);
    }

    function transformUnion(typs${anyArrayAnnotation}, val${anyAnnotation})${anyAnnotation} {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val, key, parent);
    }

    function transformEnum(cases${stringArrayAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases.map(a => { return l(a); }), val, key, parent);
    }

    function transformArray(typ${anyAnnotation}, val${anyAnnotation})${anyAnnotation} {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue(l("array"), val, key, parent);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val${anyAnnotation})${anyAnnotation} {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue(l("Date"), val, key, parent);
        }
        return d;
    }

    function transformObject(props${anyMapAnnotation}, additional${anyAnnotation}, val${anyAnnotation})${anyAnnotation} {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue(l(ref || "object"), val, key, parent);
        }
        const result${anyAnnotation} = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, key, ref);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = ${
                    this._jsOptions.runtimeTypecheckIgnoreUnknownProperties
                        ? "val[key]"
                        : "transform(val[key], additional, getProps, key, ref)"
                };
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val, key, parent);
    }
    if (typ === false) return invalidValue(typ, val, key, parent);
    let ref${anyAnnotation} = undefined;
    while (typeof typ === "object" && typ.ref !== undefined) {
        ref = typ.ref;
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val, key, parent);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

${this.castFunctionLines[0]} {
    return transform(val, typ, jsonToJSProps);
}

${this.castFunctionLines[1]} {
    return transform(val, typ, jsToJSONProps);
}

function l(typ${anyAnnotation}) {
    return { literal: typ };
}

function a(typ${anyAnnotation}) {
    return { arrayItems: typ };
}

function u(...typs${anyArrayAnnotation}) {
    return { unionMembers: typs };
}

function o(props${anyArrayAnnotation}, additional${anyAnnotation}) {
    return { props, additional };
}

function m(additional${anyAnnotation}) {
    return { props: [], additional };
}

function r(name${stringAnnotation}) {
    return { ref: name };
}
`);
            this.emitTypeMap();
        }
    }

    protected emitConvertModule(): void {
        this.ensureBlankLine();
        this.emitMultiline(
            `// Converts JSON ${this._jsOptions.rawType === "json" ? "strings" : "types"} to/from your types`
        );
        if (this._jsOptions.runtimeTypecheck) {
            this.emitMultiline(
                `// and asserts the results${this._jsOptions.rawType === "json" ? " of JSON.parse" : ""} at runtime`
            );
        }

        const moduleLine = this.moduleLine;
        if (moduleLine === undefined) {
            this.emitConvertModuleBody();
        } else {
            this.emitBlock([moduleLine, " "], "", () => this.emitConvertModuleBody());
        }
    }

    protected emitTypes(): void {
        return;
    }

    protected emitUsageImportComment(): void {
        this.emitLine('//   const Convert = require("./file");');
    }

    protected emitUsageComments(): void {
        this.emitMultiline(`// To parse this data:
//`);

        this.emitUsageImportComment();
        this.emitLine("//");
        this.forEachTopLevel("none", (_t, name) => {
            const camelCaseName = modifySource(camelCase, name);
            this.emitLine("//   const ", camelCaseName, " = Convert.to", name, "(json);");
        });
        if (this._jsOptions.runtimeTypecheck) {
            this.emitLine("//");
            this.emitLine("// These functions will throw an error if the JSON doesn't");
            this.emitLine("// match the expected interface, even if the JSON is valid.");
        }
    }

    protected emitModuleExports(): void {
        this.ensureBlankLine();

        this.emitBlock("module.exports = ", ";", () => {
            this.forEachTopLevel("none", (_, name) => {
                const serializer = this.serializerFunctionName(name);
                const deserializer = this.deserializerFunctionName(name);
                this.emitLine('"', serializer, '": ', serializer, ",");
                this.emitLine('"', deserializer, '": ', deserializer, ",");
            });
        });
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitUsageComments();
        }

        this.emitTypes();

        this.emitConvertModule();

        this.emitConvertModuleHelpers();

        this.emitModuleExports();
    }
}
