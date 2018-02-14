import * as _ from "lodash";

import {
    Type,
    ArrayType,
    UnionType,
    ClassType,
    nullableFromUnion,
    matchType,
    EnumType,
    isNamedType,
    directlyReachableSingleNamedType,
    ClassProperty
} from "../Type";
import { TypeGraph } from "../TypeGraph";
import {
    utf16LegalizeCharacters,
    utf16StringEscape,
    splitIntoWords,
    combineWords,
    firstUpperWordStyle,
    allUpperWordStyle,
    camelCase
} from "../Strings";
import { intercalate } from "../Support";

import { Sourcelike, modifySource, MultiWord, singleWord, parenIfNeeded, multiWord } from "../Source";
import { Namer, Name } from "../Naming";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { TargetLanguage } from "../TargetLanguage";
import { BooleanOption } from "../RendererOptions";

const unicode = require("unicode-properties");

export default class L extends TargetLanguage {
    private readonly _justTypes = new BooleanOption("just-types", "Interfaces only", false);
    private readonly _declareUnions = new BooleanOption("explicit-unions", "Explicitly name unions", false);
    private readonly _omitRuntimeTypecheck = new BooleanOption(
        "no-runtime-typecheck",
        "Don't verify JSON.parse results at runtime",
        false
    );

    constructor() {
        super("TypeScript", ["typescript", "ts", "tsx"], "ts");
        this.setOptions([this._justTypes, this._declareUnions, this._omitRuntimeTypecheck]);
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
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

class TypeScriptRenderer extends ConvenienceRenderer {
    private readonly _inlineUnions: boolean;

    constructor(
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        private readonly _justTypes: boolean,
        declareUnions: boolean,
        private readonly _omitRuntimeTypecheck: boolean
    ) {
        super(graph, leadingComments);
        this._inlineUnions = !declareUnions;
    }

    protected topLevelNameStyle(rawName: string): string {
        return typeNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return new Namer("types", typeNameStyle, []);
    }

    protected namerForClassProperty(): Namer {
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

    private emitEnum = (e: EnumType, enumName: Name): void => {
        this.emitBlock(["export enum ", enumName], "", () => {
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                this.emitLine(name, ` = "${utf16StringEscape(jsonName)}",`);
            });
        });
    };

    private sourceFor(t: Type): MultiWord {
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("any"),
            _nullType => singleWord("null"),
            _boolType => singleWord("boolean"),
            _integerType => singleWord("number"),
            _doubleType => singleWord("number"),
            _stringType => singleWord("string"),
            arrayType => {
                const itemType = this.sourceFor(arrayType.items);
                if (
                    (arrayType.items instanceof UnionType && this._inlineUnions) ||
                    arrayType.items instanceof ArrayType
                ) {
                    return singleWord(["Array<", itemType.source, ">"]);
                } else {
                    return singleWord([parenIfNeeded(itemType), "[]"]);
                }
            },
            classType => singleWord(this.nameForNamedType(classType)),
            mapType => singleWord(["{ [key: string]: ", this.sourceFor(mapType.values).source, " }"]),
            enumType => singleWord(this.nameForNamedType(enumType)),
            unionType => {
                if (this._inlineUnions || nullableFromUnion(unionType) !== null) {
                    const children = unionType.children.map(c => parenIfNeeded(this.sourceFor(c)));
                    return multiWord(" | ", ...children.toArray());
                } else {
                    return singleWord(this.nameForNamedType(unionType));
                }
            }
        );
    }

    typeMapTypeFor = (t: Type): Sourcelike => {
        return matchType<Sourcelike>(
            t,
            _anyType => `undefined`,
            _nullType => `null`,
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

    typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        if (!p.isOptional || p.type.isNullable) {
            return this.typeMapTypeFor(p.type);
        }
        return ["U(null, ", this.typeMapTypeFor(p.type), ")"];
    }

    emitBlock = (source: Sourcelike, end: string, emit: () => void) => {
        this.emitLine(source, " {");
        this.indent(emit);
        this.emitLine("}", end);
    };

    emitTypeMap = () => {
        this.emitBlock("const typeMap: any =", ";", () => {
            this.forEachClass("none", (t, name) => {
                this.emitBlock(['"', name, '":'], ",", () => {
                    this.forEachClassProperty(t, "none", (propName, _propJsonName, property) => {
                        this.emitLine(propName, ": ", this.typeMapTypeForProperty(property), ",");
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
            this.forEachClassProperty(c, "none", (name, _jsonName, p) => {
                const t = p.type;
                let nullable = t instanceof UnionType ? nullableFromUnion(t) : null;
                if (p.isOptional && nullable === null) {
                    nullable = t;
                }
                table.push([
                    [name, nullable !== null ? "?" : "", ": "],
                    [this.sourceFor(nullable !== null ? nullable : t).source, ";"]
                ]);
            });
            this.emitTable(table);
        });
    };

    emitConvertModule = () => {
        this.emitMultiline(`// Converts JSON strings to/from your types`);
        if (!this._omitRuntimeTypecheck) {
            this.emitMultiline(`// and asserts the results of JSON.parse at runtime`);
        }
        this.emitBlock("export module Convert", "", () => {
            this.forEachTopLevel("interposing", (t, name) => {
                this.emitBlock(["export function to", name, "(json: string): ", this.sourceFor(t).source], "", () => {
                    if (this._omitRuntimeTypecheck) {
                        this.emitLine("return JSON.parse(json);");
                    } else {
                        this.emitLine("return cast(JSON.parse(json), ", this.typeMapTypeFor(t), ");");
                    }
                });
                this.ensureBlankLine();

                const camelCaseName = modifySource(camelCase, name);
                this.emitBlock(
                    ["export function ", camelCaseName, "ToJson(value: ", this.sourceFor(t).source, "): string"],
                    "",
                    () => {
                        this.emitLine("return JSON.stringify(value, null, 2);");
                    }
                );
            });
            if (!this._omitRuntimeTypecheck) {
                this.emitMultiline(`
function cast<T>(obj: any, typ: any): T {
    if (!isValid(typ, obj)) {
        throw \`Invalid value\`;
    }
    return obj;
}

function isValid(typ: any, val: any): boolean {
    if (typ === undefined) return true;
    if (typ === null) return val === null || val === undefined;
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
    return Array.isArray(val) && val.every((element, i) => {
        return isValid(typ, element);
    });
}

function isValidMap(typ: any, val: any): boolean {
    if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
    // all values in the map must be typ
    return Object.keys(val).every(prop => {
        if (!Object.prototype.hasOwnProperty.call(val, prop)) return true;
        return isValid(typ, val[prop]);
    });
}

function isValidObject(className: string, val: any): boolean {
    if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
    let typeRep = typeMap[className];
    return Object.keys(typeRep).every(prop => {
        if (!Object.prototype.hasOwnProperty.call(typeRep, prop)) return true;
        return isValid(typeRep[prop], val[prop]);
    });
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
        const children = multiWord(" | ", ...u.children.map(c => parenIfNeeded(this.sourceFor(c))).toArray());
        this.emitLine("export type ", unionName, " = ", children.source, ";");
    };

    protected emitSourceStructure() {
        if (this.leadingComments !== undefined) {
            this.emitCommentLines(this.leadingComments);
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
            if (!this._omitRuntimeTypecheck) {
                this.emitLine("//");
                this.emitLine("// These functions will throw an error if the JSON doesn't");
                this.emitLine("// match the expected interface, even if the JSON is valid.");
            }
        }

        this.forEachNamedType("leading-and-interposing", this.emitClass, this.emitEnum, this.emitUnion);

        if (!this._justTypes) {
            this.ensureBlankLine();
            this.emitConvertModule();
        }
    }
}
