import { arrayIntercalate } from "collection-utils";

import {
    minMaxItemsForType,
    minMaxLengthForType,
    minMaxValueForType,
    patternForType,
} from "../../attributes/Constraints.js";
import { ConvenienceRenderer } from "../../ConvenienceRenderer.js";
import { type Name, type Namer, funPrefixNamer } from "../../Naming.js";
import type { RenderContext } from "../../Renderer.js";
import type { OptionValues } from "../../RendererOptions/index.js";
import type { Sourcelike } from "../../Source.js";
import { acronymStyle } from "../../support/Acronyms.js";
import {
    allLowerWordStyle,
    capitalize,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16StringEscape,
} from "../../support/Strings.js";
import { panic } from "../../support/Support.js";
import type { TargetLanguage } from "../../TargetLanguage.js";
import {
    type ArrayType,
    type ClassProperty,
    type ClassType,
    type ObjectType,
    PrimitiveType,
    type Type,
    UnionType,
} from "../../Type/index.js";
import {
    directlyReachableSingleNamedType,
    matchType,
} from "../../Type/TypeUtils.js";
import { isES3IdentifierStart } from "../JavaScript/unicodeMaps.js";
import { legalizeName } from "../JavaScript/utils.js";

import type { javaScriptPropTypesOptions } from "./language.js";

const identityNamingFunction = funPrefixNamer("properties", (s) => s);

export class JavaScriptPropTypesRenderer extends ConvenienceRenderer {
    public constructor(
        targetLanguage: TargetLanguage,
        renderContext: RenderContext,
        private readonly _jsOptions: OptionValues<
            typeof javaScriptPropTypesOptions
        >,
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
            isES3IdentifierStart,
        );
    }

    protected makeNamedTypeNamer(): Namer {
        return funPrefixNamer("types", (s) => this.nameStyle(s, true));
    }

    protected namerForObjectProperty(): Namer {
        return identityNamingFunction;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): Namer {
        return funPrefixNamer("enum-cases", (s) => this.nameStyle(s, false));
    }

    protected isImplicitCycleBreaker(_t: Type): boolean {
        return false;
    }

    protected namedTypeToNameForTopLevel(type: Type): Type | undefined {
        return directlyReachableSingleNamedType(type);
    }

    protected makeNameForProperty(
        c: ClassType,
        className: Name,
        p: ClassProperty,
        jsonName: string,
        _assignedName: string | undefined,
    ): Name | undefined {
        // Ignore the assigned name
        return super.makeNameForProperty(c, className, p, jsonName, undefined);
    }

    private typeMapTypeFor(t: Type, required = true): Sourcelike {
        if (["class", "object", "enum"].includes(t.kind)) {
            if (this.isCycleBreakerType(t)) {
                const name = this.nameForNamedType(t);
                return [
                    "(...args) => ",
                    this.sourcelikeToString(["_", name]),
                    "(...args)",
                ];
            }
            return ["_", this.nameForNamedType(t)];
        }

        const stringType = (type: Type): Sourcelike => {
            const [min, max] = minMaxLengthForType(type) ?? [];
            const pattern = patternForType(type);
            if (min === undefined && max === undefined && pattern === undefined)
                return "PropTypes.string";
            return [
                "(props, name) => { const value = props[name]; return value == null || (typeof value === 'string'",
                min === undefined ? "" : [" && value.length >= ", String(min)],
                max === undefined ? "" : [" && value.length <= ", String(max)],
                pattern === undefined
                    ? ""
                    : [
                          ' && new RegExp("',
                          utf16StringEscape(pattern),
                          '").test(value)',
                      ],
                ') ? null : new Error("Expected bounded string"); }',
            ];
        };

        const numberType = (type: Type, integer: boolean): Sourcelike => {
            const [min, max] = minMaxValueForType(type) ?? [];
            if (min === undefined && max === undefined)
                return integer ? "Integer" : "PropTypes.number";
            return [
                "(props, name) => { const value = props[name]; return value == null || (",
                integer
                    ? "Number.isInteger(value)"
                    : "typeof value === 'number'",
                min === undefined ? "" : [" && value >= ", String(min)],
                max === undefined ? "" : [" && value <= ", String(max)],
                ') ? null : new Error("Expected bounded number"); }',
            ];
        };
        const match = matchType<Sourcelike>(
            t,
            (_anyType) => "PropTypes.any",
            (_nullType) => "PropTypes.oneOf([null])",
            (_boolType) => "PropTypes.bool",
            (integerType) => numberType(integerType, true),
            (doubleType) => numberType(doubleType, false),
            (type) => stringType(type),
            (arrayType) => {
                const item = this.typeMapTypeFor(arrayType.items, false);
                const [min, max] = minMaxItemsForType(arrayType) ?? [];
                if (min === undefined && max === undefined)
                    return ["PropTypes.arrayOf(", item, ")"];
                return [
                    "(props, name, ...args) => { const value = props[name]; if (value != null && (",
                    min === undefined
                        ? "false"
                        : ["value.length < ", String(min)],
                    " || ",
                    max === undefined
                        ? "false"
                        : ["value.length > ", String(max)],
                    ')) return new Error("Expected bounded array"); return PropTypes.arrayOf(',
                    item,
                    ")(props, name, ...args); }",
                ];
            },
            (_classType) => panic("Should already be handled."),
            (mapType) => [
                "PropTypes.objectOf(",
                this.typeMapTypeFor(mapType.values, false),
                ")",
            ],
            (_enumType) => panic("Should already be handled."),
            (unionType) => {
                const isNullableEnum =
                    unionType.findMember("enum") !== undefined &&
                    unionType.findMember("null") !== undefined;
                const children = Array.from(unionType.getChildren()).map(
                    (type: Type) =>
                        isNullableEnum && type.kind === "null"
                            ? "PropTypes.oneOf([null])"
                            : this.typeMapTypeFor(type, false),
                );
                return [
                    "PropTypes.oneOfType([",
                    ...arrayIntercalate(", ", children),
                    "])",
                ];
            },
            (transformedStringType) => {
                if (transformedStringType.kind === "uuid") {
                    return '(props, name) => props[name] == null || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(props[name]) ? null : new Error("Expected UUID")';
                }
                if (transformedStringType.kind === "date-time") {
                    return '(props, name) => props[name] == null || !Number.isNaN(Date.parse(props[name])) ? null : new Error("Expected date-time")';
                }
                return "PropTypes.string";
            },
        );

        const allowsNull =
            t.kind === "null" ||
            (t instanceof UnionType && t.findMember("null") !== undefined);
        if (required && allowsNull) {
            return [
                '(props, name, ...args) => props[name] === undefined ? new Error("Expected required property") : PropTypes.oneOfType([',
                match,
                "])(props, name, ...args)",
            ];
        }
        if (required) {
            return ["PropTypes.oneOfType([", match, "]).isRequired"];
        }

        return match;
    }

    private typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        return this.typeMapTypeFor(p.type, !p.isOptional);
    }

    private importStatement(
        lhs: Sourcelike,
        moduleName: Sourcelike,
    ): Sourcelike {
        if (this._jsOptions.moduleSystem) {
            return ["import ", lhs, " from ", moduleName, ";"];
        }

        return ["const ", lhs, " = require(", moduleName, ");"];
    }

    protected emitUsageComments(): void {
        // FIXME: Use the correct type name
        this.emitCommentLines(
            [
                "Example usage:",
                "",
                this.importStatement("{ MyShape }", "./myShape.js"),
                "",
                "class MyComponent extends React.Component {",
                "  //",
                "}",
                "",
                "MyComponent.propTypes = {",
                "  input: MyShape",
                "};",
            ],
            { lineStart: "// " },
        );
    }

    protected emitBlock(
        source: Sourcelike,
        end: Sourcelike,
        emit: () => void,
    ): void {
        this.emitLine(source, "{");
        this.indent(emit);
        this.emitLine("}", end);
    }

    protected emitImports(): void {
        this.ensureBlankLine();
        this.emitLine(this.importStatement("PropTypes", '"prop-types"'));
        if (
            [...this.typeGraph.allTypesUnordered()].some(
                (t) => t.kind === "integer",
            )
        )
            this.emitLine(
                'const Integer = (props, name) => props[name] == null || Number.isInteger(props[name]) ? null : new Error("Expected integer");',
            );
    }

    private emitExport(name: Sourcelike, value: Sourcelike): void {
        if (this._jsOptions.moduleSystem) {
            this.emitLine("export const ", name, " = ", value, ";");
        } else {
            this.emitLine(
                "module.exports = exports = { ",
                name,
                ": ",
                value,
                " };",
            );
        }
    }

    protected emitTypes(): void {
        this.ensureBlankLine();

        this.forEachObject("none", (_type: ObjectType, name: Name) => {
            this.emitLine("let _", name, ";");
        });

        this.forEachEnum("none", (enumType, enumName) => {
            const options: Sourcelike = [];
            this.forEachEnumCase(
                enumType,
                "none",
                (_name: Name, jsonName, _position) => {
                    options.push("'");
                    options.push(utf16StringEscape(jsonName));
                    options.push("'");
                    options.push(", ");
                },
            );
            options.pop();

            this.emitLine([
                "const _",
                enumName,
                " = PropTypes.oneOf([",
                ...options,
                "]);",
            ]);
        });

        const order: number[] = [];
        const mapKey: Name[] = [];
        const mapValue: Sourcelike[][] = [];
        const find = (value: unknown, found: Name[] = []): Name[] => {
            if (mapKey.includes(value as Name)) found.push(value as Name);
            else if (Array.isArray(value))
                for (const v of value) find(v, found);
            else if (value !== null && typeof value === "object")
                for (const v of Object.values(value)) find(v, found);
            return found;
        };
        this.forEachObject("none", (type: ObjectType, name: Name) => {
            mapKey.push(name);
            mapValue.push(this.gatherSource(() => this.emitObject(name, type)));
        });

        const pending = mapKey.map((_, index) => index);
        while (pending.length > 0) {
            const ready = pending.findIndex((index) =>
                find(mapValue[index]).every((name) => {
                    if (name === mapKey[index]) return true;
                    const dependency = mapKey.indexOf(name);
                    return dependency < 0 || order.includes(dependency);
                }),
            );
            const at = ready < 0 ? pending.length - 1 : ready;
            order.push(...pending.splice(at, 1));
        }

        // now emit ordered source
        order.forEach((i) => {
            this.emitGatheredSource(mapValue[i]);
        });

        // now emit top levels
        this.forEachTopLevel("none", (type, name) => {
            if (type instanceof PrimitiveType) {
                this.ensureBlankLine();
                this.emitExport(name, this.typeMapTypeFor(type));
            } else if (type.kind === "array") {
                this.ensureBlankLine();
                this.emitExport(name, [
                    "PropTypes.arrayOf(",
                    this.typeMapTypeFor((type as ArrayType).items),
                    ")",
                ]);
            } else if (type.kind === "map" || type.kind === "union") {
                this.ensureBlankLine();
                this.emitExport(name, this.typeMapTypeFor(type));
            } else {
                this.ensureBlankLine();
                this.emitExport(name, ["_", name]);
            }
        });
    }

    private emitObject(name: Name, t: ObjectType): void {
        this.ensureBlankLine();
        this.emitLine("_", name, " = PropTypes.shape({");
        this.indent(() => {
            this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                const type = this.typeMapTypeForProperty(property);
                const validator =
                    property.isOptional && jsonName in Object.prototype
                        ? [
                              "(props, name, ...args) => Object.prototype.hasOwnProperty.call(props, name) ? ",
                              type,
                              "(props, name, ...args) : null",
                          ]
                        : type;
                this.emitLine(
                    `"${utf16StringEscape(jsonName)}"`,
                    ": ",
                    validator,
                    ",",
                );
            });
        });
        this.emitLine("});");
    }

    protected emitSourceStructure(): void {
        if (this.leadingComments !== undefined) {
            this.emitComments(this.leadingComments);
        } else {
            this.emitUsageComments();
        }

        this.emitImports();

        this.emitTypes();
    }
}
