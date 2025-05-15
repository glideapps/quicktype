import type { RenderContext } from "../../Renderer";
import {
    BooleanOption,
    EnumOption,
    StringOption,
    getOptionValues,
} from "../../RendererOptions";
import { TargetLanguage } from "../../TargetLanguage";
import type { FixMeOptionsType } from "../../types";

import { CPlusPlusRenderer } from "./CPlusPlusRenderer";

// FIXME: share with CJSON
const namingStyles = {
    "pascal-case": "pascal",
    "underscore-case": "underscore",
    "camel-case": "camel",
    "upper-underscore-case": "upper-underscore",
    "pascal-case-upper-acronyms": "pascal-upper-acronyms",
    "camel-case-upper-acronyms": "camel-upper-acronyms",
} as const;

export const cPlusPlusOptions = {
    typeSourceStyle: new EnumOption(
        "source-style",
        "Source code generation type,  whether to generate single or multiple source files",
        {
            "single-source": true,
            "multi-source": false,
        } as const,
        "single-source",
        "secondary",
    ),
    includeLocation: new EnumOption(
        "include-location",
        "Whether json.hpp is to be located globally or locally",
        {
            "local-include": true,
            "global-include": false,
        } as const,
        "local-include",
        "secondary",
    ),
    codeFormat: new EnumOption(
        "code-format",
        "Generate classes with getters/setters, instead of structs",
        {
            "with-struct": false,
            "with-getter-setter": true,
        } as const,
        "with-getter-setter",
    ),
    wstring: new EnumOption(
        "wstring",
        "Store strings using Utf-16 std::wstring, rather than Utf-8 std::string",
        {
            "use-string": false,
            "use-wstring": true,
        } as const,
        "use-string",
    ),
    westConst: new EnumOption(
        "const-style",
        "Put const to the left/west (const T) or right/east (T const)",
        {
            "west-const": true,
            "east-const": false,
        } as const,
        "west-const",
    ),
    justTypes: new BooleanOption("just-types", "Plain types only", false),
    namespace: new StringOption(
        "namespace",
        "Name of the generated namespace(s)",
        "NAME",
        "quicktype",
    ),
    enumType: new StringOption(
        "enum-type",
        "Type of enum class",
        "NAME",
        "int",
        "secondary",
    ),
    typeNamingStyle: new EnumOption(
        "type-style",
        "Naming style for types",
        namingStyles,
        "pascal-case",
    ),
    memberNamingStyle: new EnumOption(
        "member-style",
        "Naming style for members",
        namingStyles,
        "underscore-case",
    ),
    enumeratorNamingStyle: new EnumOption(
        "enumerator-style",
        "Naming style for enumerators",
        namingStyles,
        "upper-underscore-case",
    ),
    boost: new BooleanOption(
        "boost",
        "Require a dependency on boost. Without boost, C++17 is required",
        true,
    ),
    hideNullOptional: new BooleanOption(
        "hide-null-optional",
        "Hide null value for optional field",
        false,
    ),
};

export const cPlusPlusLanguageConfig = {
    displayName: "C++",
    names: ["c++", "cpp", "cplusplus"],
    extension: "cpp",
} as const;

export class CPlusPlusTargetLanguage extends TargetLanguage<
    typeof cPlusPlusLanguageConfig
> {
    public constructor() {
        super(cPlusPlusLanguageConfig);
    }

    public getOptions(): typeof cPlusPlusOptions {
        return cPlusPlusOptions;
    }

    public get supportsUnionsWithBothNumberTypes(): boolean {
        return true;
    }

    public get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: FixMeOptionsType,
    ): CPlusPlusRenderer {
        return new CPlusPlusRenderer(
            this,
            renderContext,
            getOptionValues(cPlusPlusOptions, untypedOptionValues),
        );
    }
}
