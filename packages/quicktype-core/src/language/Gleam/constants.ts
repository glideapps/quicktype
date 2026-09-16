// Gleam's reserved words. This covers both the keywords the compiler uses
// today and the identifiers it reserves for future use — Gleam rejects both
// when they appear as a value, field, or type name.
//
// Verified against the Gleam compiler's parser (`compiler-core`, Gleam 1.x).
export const keywords = [
    "as",
    "assert",
    "auto",
    "case",
    "const",
    "delegate",
    "derive",
    "echo",
    "else",
    "fn",
    "if",
    "implement",
    "import",
    "let",
    "macro",
    "opaque",
    "panic",
    "pub",
    "test",
    "todo",
    "type",
    "use",
] as const;

// Module aliases the generated code imports at the top level. Generated
// function names must not collide with these, or references inside the module
// would resolve to the import instead.
export const forbiddenModuleNames = [
    "decode",
    "dict",
    "int",
    "json",
    "option",
] as const;
