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

// Gleam prelude types and value constructors are always in scope. A generated
// type, constructor, or field named after one of these would shadow the
// prelude, breaking `List(...)`, `json.int`, `option.Some`, and friends.
export const preludeNames = [
    "BitArray",
    "Bool",
    "Float",
    "Int",
    "List",
    "Nil",
    "Result",
    "String",
    "UtfCodepoint",
    "Dynamic",
    "Ok",
    "Error",
    "True",
    "False",
    "Some",
    "None",
] as const;

// Fixed identifiers the renderer emits for the `any` type: the `JsonValue`
// custom type, its constructors, and its conversion functions. User type and
// function names must avoid these so the hand-written definitions win.
export const jsonValueNames = [
    "JsonValue",
    "JsonNull",
    "JsonBool",
    "JsonInt",
    "JsonFloat",
    "JsonString",
    "JsonArray",
    "JsonObject",
    "json_value_to_json",
    "json_value_decoder",
] as const;
