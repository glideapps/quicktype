import { Type, ClassProperty, ClassType, ObjectType } from "../Type";
import { matchType, directlyReachableSingleNamedType } from "../TypeUtils";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    camelCase
} from "../support/Strings";
import { panic } from "../support/Support";

import { Sourcelike, modifySource } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption, Option, OptionValues, getOptionValues } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { arrayIntercalate } from "../support/Containers";

const unicode = require("unicode-properties");

export const javaScriptOptions = {
    runtimeTypecheck: new BooleanOption("runtime-typecheck", "Verify JSON.parse results at runtime", true)
};

export class JavaScriptTargetLanguage extends TargetLanguage {
    constructor(
        displayName: string = "JavaScript",
        names: string[] = ["javascript", "js", "jsx"],
        extension: string = "js"
    ) {
        super(displayName, names, extension);
    }

    protected getOptions(): Option<any>[] {
        return [javaScriptOptions.runtimeTypecheck];
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    get supportsFullObjectType(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: { [name: string]: any }
    ): JavaScriptRenderer {
        return new JavaScriptRenderer(this, renderContext, getOptionValues(javaScriptOptions, untypedOptionValues));
    }
}

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return ["Nd", "Pc", "Mn", "Mc"].indexOf(category) >= 0 || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function typeNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        isStartCharacter
    );
}

function propertyNameStyle(original: string): string {
    const escaped = utf16StringEscape(original);
    const quoted = `"${escaped}"`;

    if (original.length === 0) {
        return quoted;
    } else if (!isStartCharacter(original.codePointAt(0) as number)) {
        return quoted;
    } else if (escaped !== original) {
        return quoted;
    } else if (legalizeName(original) !== original) {
        return quoted;
    } else {
        return original;
    }
}

export class JavaScriptRenderer extends ConvenienceRenderer {
    constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _jsOptions: OptionValues<typeof javaScriptOptions>
    ) {
        super(targetLanguage, renderContext);
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", typeNameStyle, []);
    }

    protected namerForObjectProperty(): Namer {
        return new Namer("properties", propertyNameStyle, []);
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return new Namer("enum-cases", typeNameStyle, []);
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

    protected emitDescriptionBlock(lines: string[]): void {
        this.emitCommentLines(lines, " * ", "/**", " */");
    }

    typeMapTypeFor = (t: Type): Sourcelike => {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return ['r("', this.nameForNamedType(t), '")'];
        }
        return matchType<Sourcelike>(
            t,
            _anyType => '"any"',
            _nullType => `null`,
            _boolType => `true`,
            _integerType => `0`,
            _doubleType => `3.14`,
            _stringType => `""`,
            arrayType => ["a(", this.typeMapTypeFor(arrayType.items), ")"],
            _classType => panic("We handled this above"),
            mapType => ["m(", this.typeMapTypeFor(mapType.values), ")"],
            _enumType => panic("We handled this above"),
            unionType => {
                const children = Array.from(unionType.getChildren()).map(this.typeMapTypeFor);
                return ["u(", ...arrayIntercalate(", ", children), ")"];
            }
        );
    };

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        const typeMap = this.typeMapTypeFor(p.type);
        if (!p.isOptional) {
            return typeMap;
        }
        return ["u(undefined, ", typeMap, ")"];
    }

    emitBlock(source: Sourcelike, end: Sourcelike, emit: () => void) {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }

    emitTypeMap = () => {
        const { any: anyAnnotation } = this.typeAnnotations;

        this.emitBlock(`const typeMap${anyAnnotation} = `, ";", () => {
            this.forEachObject("none", (t: ObjectType, name: Name) => {
                const additionalProperties = t.getAdditionalProperties();
                const additional =
                    additionalProperties !== undefined ? this.typeMapTypeFor(additionalProperties) : "false";
                this.emitBlock(['"', name, '": o('], [", ", additional, "),"], () => {
                    this.forEachClassProperty(t, "none", (propName, _propJsonName, property) => {
                        this.emitLine(propName, ": ", this.typeMapTypeForProperty(property), ",");
                    });
                });
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
    };

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

    protected get castFunctionLine(): string {
        return "function cast(obj, typ)";
    }

    protected get typeAnnotations(): {
        any: string;
        anyArray: string;
        anyMap: string;
        string: string;
        stringArray: string;
        boolean: string;
    } {
        return { any: "", anyArray: "", anyMap: "", string: "", stringArray: "", boolean: "" };
    }

    private emitConvertModuleBody(): void {
        this.forEachTopLevel("interposing", (t, name) => {
            this.emitBlock([this.deserializerFunctionLine(t, name), " "], "", () => {
                if (!this._jsOptions.runtimeTypecheck) {
                    this.emitLine("return JSON.parse(json);");
                } else {
                    this.emitLine("return cast(JSON.parse(json), ", this.typeMapTypeFor(t), ");");
                }
            });
            this.ensureBlankLine();

            this.emitBlock([this.serializerFunctionLine(t, name), " "], "", () => {
                this.emitLine("return JSON.stringify(value, null, 2);");
            });
        });
        if (this._jsOptions.runtimeTypecheck) {
            const {
                any: anyAnnotation,
                anyArray: anyArrayAnnotation,
                anyMap: anyMapAnnotation,
                string: stringAnnotation,
                stringArray: stringArrayAnnotation,
                boolean: booleanAnnotation
            } = this.typeAnnotations;
            this.ensureBlankLine();
            this.emitMultiline(`${this.castFunctionLine} {
    if (!isValid(typ, obj)) {
        throw Error(\`Invalid value\`);
    }
    return obj;
}

function isValid(typ${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    if (typ === "any") { return true; }
    if (typ === null) { return val === null; }
    if (typ === false) { return false; }
    while (typeof typ === "object" && typ.ref !== undefined) {
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) { return isValidEnum(typ, val); }
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? isValidUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? isValidArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? isValidObject(typ.props, typ.additional, val)
            : false;
    }
    return isValidPrimitive(typ, val);
}

function isValidPrimitive(typ${stringAnnotation}, val${anyAnnotation}) {
    return typeof typ === typeof val;
}

function isValidUnion(typs${anyArrayAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    // val must validate against one typ in typs
    return typs.some((typ) => isValid(typ, val));
}

function isValidEnum(cases${stringArrayAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    return cases.indexOf(val) !== -1;
}

function isValidArray(typ${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    // val must be an array with no invalid elements
    return Array.isArray(val) && val.every((element) => {
        return isValid(typ, element);
    });
}

function isValidObject(props${anyMapAnnotation}, additional${anyAnnotation}, val${anyAnnotation})${booleanAnnotation} {
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
        return false;
    }
    return Object.getOwnPropertyNames(val).every((key) => {
        const prop = val[key];
        if (Object.prototype.hasOwnProperty.call(props, key)) {
            return isValid(props[key], prop);
        }
        return isValid(additional, prop);
    });
}

function a(typ${anyAnnotation}) {
    return { arrayItems: typ };
}

function u(...typs${anyArrayAnnotation}) {
    return { unionMembers: typs };
}

function o(props${anyMapAnnotation}, additional${anyAnnotation}) {
    return { props, additional };
}

function m(additional${anyAnnotation}) {
    return { props: {}, additional };
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
        this.emitMultiline(`// Converts JSON strings to/from your types`);
        if (this._jsOptions.runtimeTypecheck) {
            this.emitMultiline(`// and asserts the results of JSON.parse at runtime`);
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

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
        } else {
            this.emitUsageComments();
        }

        this.emitTypes();

        this.emitConvertModule();

        this.emitModuleExports();
    }
}
