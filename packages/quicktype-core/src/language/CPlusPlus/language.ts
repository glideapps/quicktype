import { type RenderContext } from "../../Renderer";
import { BooleanOption, EnumOption, type Option, StringOption, getOptionValues } from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import { type FixMeOptionsAnyType, type FixMeOptionsType } from "../../types";

import { CPlusPlusRenderer } from "./CPlusPlusRenderer";

// FIXME: share with CJSON
const pascalValue = ["pascal-case", "pascal"] as const;
const underscoreValue = ["underscore-case", "underscore"] as const;
const camelValue = ["camel-case", "camel"] as const;
const upperUnderscoreValue = ["upper-underscore-case", "upper-underscore"] as const;
const pascalUpperAcronymsValue = ["pascal-case-upper-acronyms", "pascal-upper-acronyms"] as const;
const camelUpperAcronymsValue = ["camel-case-upper-acronyms", "camel-upper-acronyms"] as const;

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type,  whether to generate single or multiple source files",
        {
            "single-source": true,
            "multi-source": false
        } as const,
        "single-source",
        "secondary"
    ),
    includeLocation: new EnumOption(
        "include-location",
        "Whether json.hpp is to be located globally or locally",
        {
            "local-include": true,
            "global-include": false
        } as const,
        "local-include",
        "secondary"
    ),
    codeFormat: new EnumOption(
        "code-format",
        "Generate classes with getters/setters, instead of structs",
        {
            "with-struct": false,
            "with-getter-setter": true
        } as const,
        "with-getter-setter"
    ),
    wstring: new EnumOption(
        "wstring",
        "Store strings using Utf-16 std::wstring, rather than Utf-8 std::string",
        {
            "use-string": false,
            "use-wstring": true
        } as const,
        "use-string"
    ),
    westConst: new EnumOption(
        "const-style",
        "Put const to the left/west (const T) or right/east (T const)",
        {
            "west-const": true,
            "east-const": false
        } as const,
        "west-const"
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption("namespace", "Name of the generated namespace(s)", "NAME", "quicktype"),
    enumType: new StringOption("enum-type", "Type of enum class", "NAME", "int", "secondary"),
    typeNamingStyle: new EnumOption("type-style", "Naming style for types", {
        pascalValue,
        underscoreValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    }),
    memberNamingStyle: new EnumOption("member-style", "Naming style for members", {
        underscoreValue,
        pascalValue,
        camelValue,
        upperUnderscoreValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    }),
    enumeratorNamingStyle: new EnumOption("enumerator-style", "Naming style for enumerators", {
        upperUnderscoreValue,
        underscoreValue,
        pascalValue,
        camelValue,
        pascalUpperAcronymsValue,
        camelUpperAcronymsValue
    }),
    boost: new BooleanOption("boost", "Require a dependency on boost. Without boost, C++17 is required", true),
    hideNullOptional: new BooleanOption("hide-null-optional", "Hide null value for optional field", false)
};

export const cPlusPlusLanguageConfig = {
    displayName: "C++",
    names: ["c++", "cpp", "cplusplus"],
    extension: "cpp"
} as const;

export class CPlusPlusTargetLanguage extends TargetLanguage<typeof cPlusPlusLanguageConfig> {
    public constructor() {
        super(cPlusPlusLanguageConfig);
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
