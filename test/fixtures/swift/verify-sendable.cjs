const fs = require("fs");

const source = fs.readFileSync("quicktype.swift", "utf8");
const declarations = source
    .split("\n")
    .filter((line) =>
        /^(?:@objcMembers )?(?:final )?(?:class|struct|enum) /.test(line),
    );

if (declarations.length === 0) {
    throw new Error("No generated type declarations found");
}

if (!declarations.some((line) => line.startsWith("enum "))) {
    throw new Error("No generated enum declaration found");
}

if (
    !declarations.some(
        (line) => line.includes("class ") || line.startsWith("struct "),
    )
) {
    throw new Error("No generated class or struct declaration found");
}

for (const declaration of declarations) {
    if (!declaration.includes("Sendable")) {
        throw new Error(`Generated type is not Sendable: ${declaration}`);
    }

    if (
        declaration.includes("class ") &&
        !declaration.startsWith("@objcMembers final class ")
    ) {
        throw new Error(`Generated Sendable class is not final: ${declaration}`);
    }
}
