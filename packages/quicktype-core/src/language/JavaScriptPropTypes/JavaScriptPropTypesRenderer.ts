import { arrayIntercalate } from "collection-utils";

import { ConvenienceRenderer } from "../../ConvenienceRenderer";
import { type Name, type Namer, funPrefixNamer } from "../../Naming";
import type { RenderContext } from "../../Renderer";
import type { OptionValues } from "../../RendererOptions";
import type { Sourcelike } from "../../Source";
import { acronymStyle } from "../../support/Acronyms";
import {
    allLowerWordStyle,
    capitalize,
    combineWords,
    firstUpperWordStyle,
    splitIntoWords,
    utf16StringEscape,
} from "../../support/Strings";
import { panic } from "../../support/Support";
import type { TargetLanguage } from "../../TargetLanguage";
import {
    type ArrayType,
    type ClassProperty,
    type ClassType,
    type ObjectType,
    PrimitiveType,
    type Type,
} from "../../Type";
import {
    directlyReachableSingleNamedType,
    matchType,
} from "../../Type/TypeUtils";
import { isES3IdentifierStart } from "../JavaScript/unicodeMaps";
import { legalizeName } from "../JavaScript/utils";

import type { javaScriptPropTypesOptions } from "./language";

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
            return ["_", this.nameForNamedType(t)];
        }

        const match = matchType<Sourcelike>(
            t,
            (_anyType) => "PropTypes.any",
            (_nullType) => "PropTypes.any",
            (_boolType) => "PropTypes.bool",
            (_integerType) => "PropTypes.number",
            (_doubleType) => "PropTypes.number",
            (_stringType) => "PropTypes.string",
            (arrayType) => [
                "PropTypes.arrayOf(",
                this.typeMapTypeFor(arrayType.items, false),
                ")",
            ],
            (_classType) => panic("Should already be handled."),
            (_mapType) => "PropTypes.object",
            (_enumType) => panic("Should already be handled."),
            (unionType) => {
                const children = Array.from(unionType.getChildren()).map(
                    (type: Type) => this.typeMapTypeFor(type, false),
                );
                return [
                    "PropTypes.oneOfType([",
                    ...arrayIntercalate(", ", children),
                    "])",
                ];
            },
            (_transformedStringType) => {
                return "PropTypes.string";
            },
        );

        if (required) {
            return [match];
        }

        return match;
    }

    private typeMapTypeForProperty(p: ClassProperty): Sourcelike {
        return this.typeMapTypeFor(p.type);
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
                (name: Name, _jsonName, _position) => {
                    options.push("'");
                    options.push(name);
                    options.push("'");
                    options.push(", ");
                },
            );
            options.pop();

            this.emitLine([
                "const _",
                enumName,
                " = PropTypes.oneOfType([",
                ...options,
                "]);",
            ]);
        });

        const order: number[] = [];
        const mapKey: Name[] = [];
        const mapValue: Sourcelike[][] = [];
        this.forEachObject("none", (type: ObjectType, name: Name) => {
            mapKey.push(name);
            mapValue.push(this.gatherSource(() => this.emitObject(name, type)));
        });

        // order these
        mapKey.forEach((_, index) => {
            // assume first
            let ordinal = 0;

            // pull out all names
            const source = mapValue[index];
            const names = source.filter((value) => value as Name);

            // must be behind all these names
            names.forEach((name) => {
                const depName = name;

                // find this name's ordinal, if it has already been added
                order.forEach((orderItem) => {
                    const depIndex = orderItem;
                    if (mapKey[depIndex] === depName) {
                        // this is the index of the dependency, so make sure we come after it
                        ordinal = Math.max(ordinal, depIndex + 1);
                    }
                });
            });

            // insert index
            order.splice(ordinal, 0, index);
        });

        // now emit ordered source
        order.forEach((i) => this.emitGatheredSource(mapValue[i]));

        // now emit top levels
        this.forEachTopLevel("none", (type, name) => {
            if (type instanceof PrimitiveType) {
                this.ensureBlankLine();
                this.emitExport(name, this.typeMapTypeFor(type));
            } else {
                if (type.kind === "array") {
                    this.ensureBlankLine();
                    this.emitExport(name, [
                        "PropTypes.arrayOf(",
                        this.typeMapTypeFor((type as ArrayType).items),
                        ")",
                    ]);
                } else {
                    this.ensureBlankLine();
                    this.emitExport(name, ["_", name]);
                }
            }
        });
    }

    private emitObject(name: Name, t: ObjectType): void {
        this.ensureBlankLine();
        this.emitLine("_", name, " = PropTypes.shape({");
        this.indent(() => {
            this.forEachClassProperty(t, "none", (_, jsonName, property) => {
                this.emitLine(
                    `"${utf16StringEscape(jsonName)}"`,
                    ": ",
                    this.typeMapTypeForProperty(property),
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
