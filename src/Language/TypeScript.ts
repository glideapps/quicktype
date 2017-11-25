import * as _ from "lodash";

import {
    TopLevels,
    Type,
    ArrayType,
    MapType,
    UnionType,
    NamedType,
    ClassType,
    nullableFromUnion,
    matchType
} from "../Type";

import {
    utf16LegalizeCharacters,
    pascalCase,
    camelCase,
    startWithLetter,
    stringEscape,
    intercalate,
    panic
} from "../Support";

import { Sourcelike, modifySource } from "../Source";
import { Namer, Name } from "../Naming";
import { Renderer, RenderResult } from "../Renderer";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import TargetLanguage from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";

const unicode = require("unicode-properties");

export default class L extends TargetLanguage {
    static justTypes = new BooleanOption("just-types", "Interfaces only", false);
    static declareUnions = new BooleanOption("explicit-unions", "Explicitly name unions", false);
    static runtimeTypecheck = new BooleanOption("runtime-typecheck", "Assert JSON.parse results at runtime", false);

    constructor() {
        super("TypeScript", ["typescript", "ts"], "ts", [
            L.justTypes.definition,
            L.declareUnions.definition,
            L.runtimeTypecheck.definition
        ]);
    }

    protected get supportsEnums(): boolean {
        return false;
    }

    renderGraph(topLevels: TopLevels, optionValues: { [name: string]: any }): RenderResult {
        return new TypeScriptRenderer(
            topLevels,
            L.justTypes.getValue(optionValues),
            !L.declareUnions.getValue(optionValues),
            L.runtimeTypecheck.getValue(optionValues)
        ).render();
    }
}

function isStartCharacter(utf16Unit: number): boolean {
    return unicode.isAlphabetic(utf16Unit) || utf16Unit === 0x5f; // underscore
}

function isPartCharacter(utf16Unit: number): boolean {
    const category: string = unicode.getCategory(utf16Unit);
    return _.includes(["Nd", "Pc", "Mn", "Mc"], category) || isStartCharacter(utf16Unit);
}

const legalizeName = utf16LegalizeCharacters(isPartCharacter);

function typeNameStyle(original: string): string {
    return startWithLetter(isStartCharacter, true, pascalCase(legalizeName(original)));
}

function propertyNameStyle(original: string): string {
    const escaped = stringEscape(original);
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

function noEnums(): never {
    return panic("Error: Enums are not supported in TypeScript yet.");
}

class TypeScriptRenderer extends ConvenienceRenderer {
    constructor(
        topLevels: TopLevels,
        private readonly justTypes: boolean,
        private readonly inlineUnions: boolean,
        private readonly runtimeTypecheck: boolean
    ) {
        super(topLevels);
    }

    protected topLevelNameStyle(rawName: string): string {
        return typeNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return new Namer(typeNameStyle, []);
    }

    protected get propertyNamer(): Namer {
        return new Namer(propertyNameStyle, []);
    }

    protected get caseNamer(): Namer {
        return noEnums();
    }

    protected namedTypeToNameForTopLevel(type: Type): NamedType | null {
        if (type.isNamedType()) {
            return type;
        }
        return null;
    }

    sourceFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => "any",
            nullType => "null",
            boolType => "boolean",
            integerType => "number",
            doubleType => "number",
            stringType => "string",
            arrayType => {
                const itemType = this.sourceFor(arrayType.items);
                if (this.inlineUnions && arrayType.items instanceof UnionType) {
                    const nullable = nullableFromUnion(arrayType.items);
                    if (nullable !== null) {
                        return [this.sourceFor(nullable), "[]"];
                    } else {
                        return ["Array<", itemType, ">"];
                    }
                } else if (arrayType.items instanceof ArrayType) {
                    return ["Array<", itemType, ">"];
                } else {
                    return [itemType, "[]"];
                }
            },
            classType => this.nameForNamedType(classType),
            mapType => ["{ [key: string]: ", this.sourceFor(mapType.values), " }"],
            enumType => noEnums(),
            unionType => {
                if (this.inlineUnions || nullableFromUnion(unionType)) {
                    const children = unionType.children.map(this.sourceFor);
                    return intercalate(" | ", children).toArray();
                } else {
                    return this.nameForNamedType(unionType);
                }
            }
        );
    };

    typeMapTypeFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            anyType => `"undefined"`,
            nullType => `"undefined"`,
            boolType => `"boolean"`,
            integerType => `"number"`,
            doubleType => `"number"`,
            stringType => `"string"`,
            arrayType => ["array(", this.typeMapTypeFor(arrayType.items), ")"],
            classType => ['object("', this.nameForNamedType(classType), '")'],
            mapType => ["map(", this.typeMapTypeFor(mapType.values), ")"],
            enumType => noEnums(),
            unionType => {
                const children = unionType.children.map(this.typeMapTypeFor);
                return ["union(", ...intercalate(", ", children).toArray(), ")"];
            }
        );
    };

    emitBlock = (source: Sourcelike, end: string, emit: () => void) => {
        this.emitLine(source, " {");
        this.indent(emit);
        this.emitLine("}", end);
    };

    emitTypeMap = () => {
        this.emitBlock("const typeMap: any =", ";", () => {
            this.forEachClass("none", (t, name) => {
                this.emitBlock(['"', name, '":'], ",", () => {
                    this.forEachProperty(t, "none", (propName, propJsonName, propType) => {
                        this.emitLine(propName, ": ", this.typeMapTypeFor(propType), ",");
                    });
                });
            });
        });
    };

    private emitClass = (c: ClassType, className: Name) => {
        this.emitBlock(["export interface ", className], "", () => {
            const table: Sourcelike[][] = [];
            this.forEachProperty(c, "none", (name, jsonName, t) => {
                const nullable = t instanceof UnionType && nullableFromUnion(t);
                table.push([[name, nullable ? "?" : "", ": "], [this.sourceFor(nullable || t), ";"]]);
            });
            this.emitTable(table);
        });
    };

    emitConvertModule = () => {
        this.emitMultiline(`// Converts JSON strings to/from your types`);
        if (this.runtimeTypecheck) {
            this.emitMultiline(`// and asserts the results of JSON.parse at runtime`);
        }
        this.emitBlock("export module Convert", "", () => {
            if (this.runtimeTypecheck) {
                this.emitLine("let path: string[] = [];");
                this.emitNewline();
            }
            this.forEachTopLevel("interposing", (t, name) => {
                this.emitBlock(["export function to", name, "(json: string): ", this.sourceFor(t)], "", () => {
                    if (this.runtimeTypecheck) {
                        this.emitLine("return cast(JSON.parse(json), ", this.typeMapTypeFor(t), ");");
                    } else {
                        this.emitLine("return JSON.parse(json);");
                    }
                });
                this.emitNewline();

                const camelCaseName = modifySource(camelCase, name);
                this.emitBlock(
                    ["export function ", camelCaseName, "ToJson(value: ", this.sourceFor(t), "): string"],
                    "",
                    () => {
                        this.emitLine("return JSON.stringify(value, null, 2);");
                    }
                );
            });
            if (this.runtimeTypecheck) {
                this.emitMultiline(`
function cast<T>(obj: any, typ: any): T {
    path = [];
    if (!isValid(typ, obj)) {
        throw \`Invalid value: obj$\{path.join("")\}\`;
    }
    return obj;
}

function isValid(typ: any, val: any): boolean {
    return typ.isUnion  ? isValidUnion(typ.typs, val)
            : typ.isArray  ? isValidArray(typ.typ, val)
            : typ.isMap    ? isValidMap(typ.typ, val)
            : typ.isObject ? isValidObject(typ.cls, val)
            :                isValidPrimitive(typ, val);
}

function isValidPrimitive(typ: string, val: any) {
    if (typ === "undefined") return !val;
    return typ === typeof val;
}

function isValidUnion(typs: any[], val: any): boolean {
    // val must validate against one typ in typs
    return typs.find(typ => isValid(typ, val)) !== undefined;
}

function isValidArray(typ: any, val: any): boolean {
    // val must be an array with no invalid elements
    return Array.isArray(val) && !val.find((element, i) => {
        path.push(\`[$\{i}\]\`);
        if (isValid(typ, element)) {
            path.pop();
            return false;
        } else {
            return true;
        }
    });
}

function isValidMap(typ: any, val: any): boolean {
    // all values in the map must be typ
    for (const prop in val) {
        if (!!prop) continue;
        path.push(\`["$\{prop\}"]\`);
        if (!isValid(typ, val[prop]))
            return false;
        path.pop();
    }
    return true;
}

function isValidObject(className: string, val: any): boolean {
    let typeRep = typeMap[className];
    
    for (const prop in typeRep) {
        if (!!prop) continue;
        path.push(\`.$\{prop\}\`);
        if (!isValid(typeRep[prop], val[prop]))
            return false;
        path.pop();
    }

    return true;
}

function array(typ: any) {
    return { typ, isArray: true };
}

function union(...typs: any[]) {
    return { typs, isUnion: true };
}

function map(typ: any) {
    return { typ, isMap: true };
}

function object(className: string) {
    return { cls: className, isObject: true };
}
`);
                this.emitTypeMap();
            }
        });
    };

    emitUnion = (u: UnionType, unionName: Name) => {
        const children = u.children.map(this.sourceFor);
        this.emitLine("export type ", unionName, " = ", intercalate(" | ", children).toArray(), ";");
    };

    protected emitSourceStructure() {
        if (!this.justTypes) {
            this.emitMultiline(`// To parse this data:
//`);
            const topLevelNames: Sourcelike[] = [];
            this.forEachTopLevel(
                "none",
                (t, name) => {
                    topLevelNames.push(", ", name);
                },
                t => t.isNamedType()
            );

            this.emitLine("//   import { Convert", topLevelNames, ' } from "./file";');
            this.emitLine("//");
            this.forEachTopLevel("none", (t, name) => {
                const camelCaseName = modifySource(camelCase, name);
                this.emitLine("//   const ", camelCaseName, " = Convert.to", name, "(json);");
            });
            if (this.runtimeTypecheck) {
                this.emitLine("//");
                this.emitLine("// These functions will throw an error if the JSON doesn't");
                this.emitLine("// match the expected interface, even if the JSON is valid.");
            }
            this.emitNewline();
        }

        if (!this.inlineUnions && this.haveNamedUnions) {
            this.forEachUnion("none", this.emitUnion);
            this.emitNewline();
        }

        this.forEachClass("interposing", this.emitClass);

        if (!this.justTypes) {
            this.emitNewline();
            this.emitConvertModule();
        }
    }
}
