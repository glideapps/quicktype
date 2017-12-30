import * as _ from "lodash";

import { Type, ArrayType, UnionType, ClassType, nullableFromUnion, matchType, EnumType, isNamedType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import {
    utf16LegalizeCharacters,
    stringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { intercalate } from "../Support";

import { Sourcelike, modifySource } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";

const unicode = require("unicode-properties");

export default class L extends TargetLanguage {
    private readonly _justTypes = new BooleanOption("just-types", "Interfaces only", false);
    private readonly _declareUnions = new BooleanOption("explicit-unions", "Explicitly name unions", false);
    private readonly _runtimeTypecheck = new BooleanOption(
        "runtime-typecheck",
        "Assert JSON.parse results at runtime",
        false
    );

    constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
        this.setOptions([this._justTypes, this._declareUnions, this._runtimeTypecheck]);
    }

    protected get rendererClass(): new (
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return TypeScriptRenderer;
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

class TypeScriptRenderer extends ConvenienceRenderer {
    private readonly _inlineUnions: boolean;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        declareUnions: boolean,
        private readonly _runtimeTypecheck: boolean
    ) {
        super(graph, leadingComments);
        this._inlineUnions = !declareUnions;
    }

    protected topLevelNameStyle(rawName: string): string {
        return typeNameStyle(rawName);
    }

    protected get namedTypeNamer(): Namer {
        return new Namer(typeNameStyle, []);
    }

    protected get classPropertyNamer(): Namer {
        return new Namer(propertyNameStyle, []);
    }

    protected get unionMemberNamer(): null {
        return null;
    }

    protected get enumCaseNamer(): Namer {
        return new Namer(typeNameStyle, []);
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | null {
        if (isNamedType(type)) {
            return type;
        }
        return null;
    }

    private emitEnum = (e: EnumType, enumName: Name): void => {
        this.emitBlock(["export enum ", enumName], "", () => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ` = "${stringEscape(jsonName)}",`);
            });
        });
    };

    sourceFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => "any",
            _nullType => "null",
            _boolType => "boolean",
            _integerType => "number",
            _doubleType => "number",
            _stringType => "string",
            arrayType => {
                const itemType = this.sourceFor(arrayType.items);
                if (this._inlineUnions && arrayType.items instanceof UnionType) {
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
            enumType => this.nameForNamedType(enumType),
            unionType => {
                if (this._inlineUnions || nullableFromUnion(unionType)) {
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
            _anyType => `undefined`,
            _nullType => `undefined`,
            _boolType => `false`,
            _integerType => `0`,
            _doubleType => `3.14`,
            _stringType => `""`,
            arrayType => ["A(", this.typeMapTypeFor(arrayType.items), ")"],
            classType => ['O("', this.nameForNamedType(classType), '")'],
            mapType => ["M(", this.typeMapTypeFor(mapType.values), ")"],
            enumType => ['E("', this.nameForNamedType(enumType), '")'],
            unionType => {
                const children = unionType.children.map(this.typeMapTypeFor);
                return ["U(", ...intercalate(", ", children).toArray(), ")"];
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
                    this.forEachClassProperty(t, "none", (propName, _propJsonName, propType) => {
                        this.emitLine(propName, ": ", this.typeMapTypeFor(propType), ",");
                    });
                });
            });
            this.forEachEnum("none", (e, name) => {
                this.emitLine('"', name, '": [');
                this.indent(() => {
                    this.forEachEnumCase(e, "none", caseName => {
                        this.emitLine(name, ".", caseName, ",");
                    });
                });
                this.emitLine("],");
            });
        });
    };

    private emitClass = (c: ClassType, className: Name) => {
        this.emitBlock(["export interface ", className], "", () => {
            const table: Sourcelike[][] = [];
            this.forEachClassProperty(c, "none", (name, _jsonName, t) => {
                const nullable = t instanceof UnionType && nullableFromUnion(t);
                table.push([[name, nullable ? "?" : "", ": "], [this.sourceFor(nullable || t), ";"]]);
            });
            this.emitTable(table);
        });
    };

    emitConvertModule = () => {
        this.emitMultiline(`// Converts JSON strings to/from your types`);
        if (this._runtimeTypecheck) {
            this.emitMultiline(`// and asserts the results of JSON.parse at runtime`);
        }
        this.emitBlock("export module Convert", "", () => {
            if (this._runtimeTypecheck) {
                this.emitLine("let path: string[] = [];");
                this.ensureBlankLine();
            }
            this.forEachTopLevel("interposing", (t, name) => {
                this.emitBlock(["export function to", name, "(json: string): ", this.sourceFor(t)], "", () => {
                    if (this._runtimeTypecheck) {
                        this.emitLine("return cast(JSON.parse(json), ", this.typeMapTypeFor(t), ");");
                    } else {
                        this.emitLine("return JSON.parse(json);");
                    }
                });
                this.ensureBlankLine();

                const camelCaseName = modifySource(camelCase, name);
                this.emitBlock(
                    ["export function ", camelCaseName, "ToJson(value: ", this.sourceFor(t), "): string"],
                    "",
                    () => {
                        this.emitLine("return JSON.stringify(value, null, 2);");
                    }
                );
            });
            if (this._runtimeTypecheck) {
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
            : typ.isEnum   ? isValidEnum(typ.name, val)
            : typ.isObject ? isValidObject(typ.cls, val)
            :                isValidPrimitive(typ, val);
}

function isValidPrimitive(typ: string, val: any) {
    return typeof typ === typeof val;
}

function isValidUnion(typs: any[], val: any): boolean {
    // val must validate against one typ in typs
    return typs.find(typ => isValid(typ, val)) !== undefined;
}

function isValidEnum(enumName: string, val: any): boolean {
    const cases = typeMap[enumName];
    return cases.indexOf(val) !== -1;
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
    for (const prop of Object.keys(val)) {
        if (prop === undefined) continue;
        path.push(\`["$\{prop\}"]\`);
        if (!isValid(typ, val[prop]))
            return false;
        path.pop();
    }
    return true;
}

function isValidObject(className: string, val: any): boolean {
    let typeRep = typeMap[className];
    
    for (const prop of Object.keys(typeRep)) {
        if (prop === undefined) continue;
        path.push(\`.$\{prop\}\`);
        if (!isValid(typeRep[prop], val[prop]))
            return false;
        path.pop();
    }

    return true;
}

function A(typ: any) {
    return { typ, isArray: true };
}

function E(name: string) {
    return { name, isEnum: true };
}

function U(...typs: any[]) {
    return { typs, isUnion: true };
}

function M(typ: any) {
    return { typ, isMap: true };
}

function O(className: string) {
    return { cls: className, isObject: true };
}
`);
                this.emitTypeMap();
            }
        });
    };

    emitUnion = (u: UnionType, unionName: Name) => {
        if (this._inlineUnions) {
            return;
        }
        const children = u.children.map(this.sourceFor);
        this.emitLine("export type ", unionName, " = ", intercalate(" | ", children).toArray(), ";");
    };

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines("// ", this.leadingComments);
        } else if (!this._justTypes) {
            this.emitMultiline(`// To parse this data:
//`);
            const topLevelNames: Sourcelike[] = [];
            this.forEachTopLevel(
                "none",
                (_t, name) => {
                    topLevelNames.push(", ", name);
                },
                isNamedType
            );

            this.emitLine("//   import { Convert", topLevelNames, ' } from "./file";');
            this.emitLine("//");
            this.forEachTopLevel("none", (_t, name) => {
                const camelCaseName = modifySource(camelCase, name);
                this.emitLine("//   const ", camelCaseName, " = Convert.to", name, "(json);");
            });
            if (this._runtimeTypecheck) {
                this.emitLine("//");
                this.emitLine("// These functions will throw an error if the JSON doesn't");
                this.emitLine("// match the expected interface, even if the JSON is valid.");
            }
        }

        this.forEachNamedType("leading-and-interposing", false, this.emitClass, this.emitEnum, this.emitUnion);

        if (!this._justTypes) {
            this.ensureBlankLine();
            this.emitConvertModule();
        }
    }
}
