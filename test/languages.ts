"use strict";

import { RendererOptions } from "../dist/quicktype";

export interface Language {
  name: string;
  base: string;
  setupCommand?: string;
  compileCommand?: string;
  runCommand(sample: string): string;
  diffViaSchema: boolean;
  allowMissingNull: boolean;
  output: string;
  topLevel: string;
  skipJSON: string[];
  skipSchema: string[];
  rendererOptions: RendererOptions;
  quickTestRendererOptions: RendererOptions[];
}

export const CSharpLanguage: Language = {
  name: "csharp",
  base: "test/fixtures/csharp",
  // https://github.com/dotnet/cli/issues/1582
  setupCommand: "dotnet restore --no-cache",
  runCommand(sample: string) {
    return `dotnet run "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.cs",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: [
    { "array-type": "list" },
    { "csharp-version": "5" },
    { density: "dense" }
  ]
};

export const JavaLanguage: Language = {
  name: "java",
  base: "test/fixtures/java",
  compileCommand: "mvn package",
  runCommand(sample: string) {
    return `java -cp target/QuickTypeTest-1.0-SNAPSHOT.jar io.quicktype.App "${sample}"`;
  },
  diffViaSchema: false,
  allowMissingNull: false,
  output: "src/main/java/io/quicktype/TopLevel.java",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json"],
  skipSchema: ["enum.schema"],
  rendererOptions: {},
  quickTestRendererOptions: []
};

export const GoLanguage: Language = {
  name: "golang",
  base: "test/fixtures/golang",
  runCommand(sample: string) {
    return `go run main.go quicktype.go < "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "quicktype.go",
  topLevel: "TopLevel",
  skipJSON: ["identifiers.json", "simple-identifiers.json", "blns-object.json"],
  skipSchema: [],
  rendererOptions: {},
  quickTestRendererOptions: []
};

function makeCPlusPlusLanguage(rendererOptions: {
  [name: string]: string;
}): Language {
  return {
    name: "cplusplus",
    base: "test/fixtures/cplusplus",
    setupCommand:
      "curl -o json.hpp https://raw.githubusercontent.com/nlohmann/json/87df1d6708915ffbfa26a051ad7562ecc22e5579/src/json.hpp",
    compileCommand: "g++ -O0 -o quicktype -std=c++14 main.cpp",
    runCommand(sample: string) {
      return `./quicktype "${sample}"`;
    },
    diffViaSchema: true,
    allowMissingNull: false,
    output: "quicktype.hpp",
    topLevel: "TopLevel",
    skipJSON: ["recursive.json"],
    skipSchema: [],
    rendererOptions: rendererOptions,
    quickTestRendererOptions: [{ unions: "indirection" }]
  };
}

export const CPlusPlusLanguage: Language = makeCPlusPlusLanguage({});
export const CPlusPlusIndirectionLanguage: Language = makeCPlusPlusLanguage({
  unions: "indirection"
});

export const ElmLanguage: Language = {
  name: "elm",
  base: "test/fixtures/elm",
  setupCommand: "rm -rf elm-stuff/build-artifacts && elm-make --yes",
  compileCommand: "elm-make Main.elm QuickType.elm --output elm.js",
  runCommand(sample: string) {
    return `node ./runner.js "${sample}"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "QuickType.elm",
  topLevel: "QuickType",
  skipJSON: [
    "identifiers.json",
    "simple-identifiers.json",
    "blns-object.json",
    "recursive.json"
  ],
  skipSchema: [], // All of them currently fail, so we don't even run it.
  rendererOptions: {},
  quickTestRendererOptions: [{ "array-type": "list" }]
};

function makeSwiftLanguage(
  version: number,
  rendererOptions: {
    [name: string]: string;
  }
): Language {
  let name: string;
  // This at least is keeping blns-object from working: https://bugs.swift.org/browse/SR-6314
  let skipJSON = ["no-classes.json", "blns-object.json", "recursive.json"];
  let skipSchema: string[] = [];
  if (version === 3) {
    rendererOptions["swift-version"] = "3";
    skipJSON.push("identifiers.json");
    skipSchema.push("enum.schema");
  } else {
    rendererOptions["swift-version"] = "4";
  }
  return {
    name: "swift",
    base: "test/fixtures/swift",
    compileCommand: `swiftc -o quicktype main.swift quicktype.swift`,
    runCommand(sample: string) {
      return `./quicktype "${sample}"`;
    },
    diffViaSchema: false,
    allowMissingNull: true,
    output: "quicktype.swift",
    topLevel: "TopLevel",
    skipJSON,
    skipSchema,
    rendererOptions: rendererOptions,
    quickTestRendererOptions: [{ "struct-or-class": "class" }]
  };
}

export const Swift3Language: Language = makeSwiftLanguage(3, {});
export const Swift3ClassesLanguage: Language = makeSwiftLanguage(3, {
  "struct-or-class": "class"
});
export const Swift4Language: Language = makeSwiftLanguage(4, {});
export const Swift4ClassesLanguage: Language = makeSwiftLanguage(4, {
  "struct-or-class": "class"
});

export const TypeScriptLanguage: Language = {
  name: "typescript",
  base: "test/fixtures/typescript",
  runCommand(sample: string) {
    // We have to unset TS_NODE_PROJECT because it gets set on the workers
    // to the root test/tsconfig.json
    return `TS_NODE_PROJECT= ts-node main.ts \"${sample}\"`;
  },
  diffViaSchema: true,
  allowMissingNull: false,
  output: "TopLevel.ts",
  topLevel: "TopLevel",
  skipJSON: [],
  skipSchema: ["enum.schema"],
  rendererOptions: { "runtime-typecheck": "yes", "explicit-unions": "yes" },
  quickTestRendererOptions: []
};
