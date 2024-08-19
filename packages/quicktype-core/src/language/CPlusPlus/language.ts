import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { type NamingStyle } from "../../support/Strings";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { CPlusPlusRenderer } from "./CPlusPlusRenderer";

const pascalValue: [string, NamingStyle] = ["pascal-case", "pascal"];
const originalValue: [string, NamingStyle] = ["original-case", "original"];
const underscoreValue: [string, NamingStyle] = ["underscore-case", "underscore"];
const camelValue: [string, NamingStyle] = ["camel-case", "camel"];
const upperUnderscoreValue: [string, NamingStyle] = ["upper-underscore-case", "upper-underscore"];
const pascalUpperAcronymsValue: [string, NamingStyle] = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"];
const camelUpperAcronymsValue: [string, NamingStyle] = ["camel-case-upper-acronyms", "camel-upper-acronyms"];

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type,  whether to generate single or multiple source files",
        [
            ["single-source", true],
            ["multi-source", false]
        ],
        "single-source",
        "secondary"
    ),
    includeLocation: new EnumOption(
        "include-location",
        "Whether json.hpp is to be located globally or locally",
        [
            ["local-include", true],
            ["global-include", false]
        ],
        "local-include",
        "secondary"
    ),
    codeFormat: new EnumOption(
        "code-format",
        "Generate classes with getters/setters, instead of structs",
        [
            ["with-struct", false],
            ["with-getter-setter", true]
        ],
        "with-getter-setter"
    ),
    wstring: new EnumOption(
        "wstring",
        "Store strings using Utf-16 std::wstring, rather than Utf-8 std::string",
        [
            ["use-string", false],
            ["use-wstring", true]
        ],
        "use-string"
    ),
    westConst: new EnumOption(
        "const-style",
        "Put const to the left/west (const T) or right/east (T const)",
        [
            ["west-const", true],
            ["east-const", false]
        ],
        "west-const"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    enumType: new StringOption("enum-type", "Type of enum class", "NAME", "int", "secondary"),
    typeNamingStyle: new EnumOption<NamingStyle>("type-style", "Naming style for types", [
        pascalValue,
        originalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    memberNamingStyle: new EnumOption<NamingStyle>("member-style", "Naming style for members", [
        underscoreValue,
        pascalValue,
        originalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    enumeratorNamingStyle: new EnumOption<NamingStyle>("enumerator-style", "Naming style for enumerators", [
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        originalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    ]),
    boost: new BooleanOption("boost", "Require a dependency on boost. Without boost, C++17 is required", true),
    hideNullOptional: new BooleanOption("hide-null-optional", "Hide null value for optional field", false)
};

export class CPlusPlusTargetLanguage extends TargetLanguage {
    public constructor(displayName = "C++", names: string[] = ["c++", "cpp", "cplusplus"], extension = "cpp") {
        super(displayName, names, extension);
    }

    protected getOptions(): Array<Option<FixMeOptionsAnyType>> {
        return [
            cPlusPlusOptions.justTypes,
            cPlusPlusOptions.namespace,
            cPlusPlusOptions.codeFormat,
            cPlusPlusOptions.wstring,
            cPlusPlusOptions.westConst,
            cPlusPlusOptions.typeSourceStyle,
            cPlusPlusOptions.includeLocation,
            cPlusPlusOptions.typeNamingStyle,
            cPlusPlusOptions.memberNamingStyle,
            cPlusPlusOptions.enumeratorNamingStyle,
            cPlusPlusOptions.enumType,
            cPlusPlusOptions.boost,
            cPlusPlusOptions.hideNullOptional
        ];
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer(renderContext: RenderContext, untypedOptionValues: FixMeOptionsType): CPlusPlusRenderer {
        return new CPlusPlusRenderer(this, renderContext, getOptionValues(cPlusPlusOptions, untypedOptionValues));
    }
}
