# Extending quicktype functionality with a Custom Renderer

## quicktype Interface

To customise your rendering output, you can extend existing quicktype classes and override existing methods to achieve the behaviour you want.

This process requires 3 main steps:

1. [Extending a `Renderer` Class](#creating-a-custom-renderer)
2. [Wrapping your `Renderer` in a `TargetLanguage` Class](#creating-a-targetlanguage)
3. [Using your new classes in the `quicktype` function](#using-your-custom-language)
4. [Advanced Usage: Creating an entirely new Language](#creating-a-new-language)

## Creating a custom `Renderer`

Adding custom render logic for an existing language often involves extending a Renderer class and simply overriding or amending one of the `emit` methods:

```ts
// MyCustomRenderer.ts
import { CSharpRenderer } from "quicktype-core";

export class MyCustomRenderer extends CSharpRenderer {
    // Add your custom logic here, feel free to reference the source code for how existing methods work
    //
    // ex.
    protected superclassForType(t: Type): Sourcelike | undefined {
        // if the type is a class, it should extend `GameObject` when rendered in C#
        if (t instanceof ClassType) {
            return "GameObject";
        }
        return undefined;
    }
    // See: http://blog.quicktype.io/customizing-quicktype/ for more context
}
```

## Creating a `TargetLanguage`

If you just want to change the rendering logic for an existing language, you can just extend an exported Language class (`CSharpTargetLanguage` in this example) and override the `makeRenderer` method:

```ts
// MyCustomLanguage.ts
import { CSharpTargetLanguage } from "quicktype-core";

import { MyCustomRenderer } from "./MyCustomRenderer";

export class MyCustomLanguage extends CSharpTargetLanguage {
    // `makeRenderer` instantiates the Renderer class for the TargetLanguage
    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: Record<string, unknown>
    ): MyCustomRenderer {
        // use your new custom renderer class here
        return new MyCustomRenderer(this, renderContext, getOptionValues(cSharpOptions, untypedOptionValues));
    }
}
```

## Using your custom Language

```ts
import { quicktype } from "quicktype-core";

import { MyCustomLanguage } from './MyCustomLanguage';

const lang = new MyCustomLanguage();

const lines = await quicktype({
	lang: lang, // use your new TargetLanguage in the `lang` field here
	...
});

console.log(lines);
```

## Creating a new Language

If none of the existing `quicktype` Language classes suit your needs, you can creating your own `TargetLanguge` and `Renderer` classes from scratch. If this satisfies your use cases for a language we don't currently support, please consider opening a PR with your new language and we'd love to take a look.

If you run into any issues, you can open a GitHub issue and we'll help you take a look.

### Creating a `TargetLanguage` from scratch

Instead of just extending an existing language, a new Language requires two additional steps:

-   Defining the language config
-   Adding any language-specific options

```ts
import { TargetLanguage, BooleanOption } from "quicktype-core";

// language config
const brandNewLanguageConfig = {
    displayName: "Scratch", // these can be the same
    names: ["scratch"], // these can be the same
    extension: "sb" // the file extension that this language commonly has
} as const;

// language options
const brandNewLanguageOptions = {
    allowFoo: new BooleanOption(
        "allow-foo", // option name
        "Allows Foo", // description
        true // default value
    )
    // The default available Option classes are: StringOption, BooleanOption, EnumOption
    // Please visit the source code for more examples and usage
};

class BrandNewLanguage extends TargetLanguage<typeof brandNewLanguageConfig> {
    public constructor() {
        super(brandNewLanguageConfig);
    }

    public getOptions(): typeof brandNewLanguageOptions {
        return brandNewLanguageOptions;
    }

    protected makeRenderer(
        renderContext: RenderContext,
        untypedOptionValues: Record<string, unknown>
    ): BrandNewRenderer {
        return new BrandNewRenderer(this, renderContext, getOptionValues(brandNewLanguageOptions, untypedOptionValues));
    }
}
```

### Creating a `Renderer` from scratch

Creating a brand new `Renderer` class is very similar to extending an existing class:

```ts
export class BrandNewRenderer extends ConvenienceRenderer {
    public constructor(targetLanguage: TargetLanguage, renderContext: RenderContext) {
        super(targetLanguage, renderContext);
    }

    // Additional render methods go here
    // Please reference existing Renderer classes and open a GitHub issue if you need help
}
```

## Links

Blog post with an older example: http://blog.quicktype.io/customizing-quicktype/
