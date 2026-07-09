export const keywords = [
    "Serialize",
    "Deserialize",

    // Special reserved identifiers used internally for elided lifetimes,
    // unnamed method parameters, crate root module, error recovery etc.
    "{{root}}",
    "$crate",

    // Keywords used in the language.
    "as",
    "async",
    "box",
    "break",
    "const",
    "continue",
    "crate",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",

    // Keywords reserved for future use.
    "abstract",
    "alignof",
    "become",
    "do",
    "final",
    "macro",
    "offsetof",
    "override",
    "priv",
    "proc",
    "pure",
    "sizeof",
    "typeof",
    "unsized",
    "virtual",
    "yield",

    // Weak keywords, have special meaning only in specific contexts.
    "catch",
    "default",
    "dyn",
    "'static",
    "union",

    // Conflict between `std::Option` and potentially generated Option
    "option",

    // Prelude and standard-library names that generated code refers to
    // unqualified; a generated type with one of these names would shadow
    // them and break compilation (e.g. a struct named `Option`).
    "Option",
    "Some",
    "None",
    "Result",
    "Ok",
    "Err",
    "String",
    "Vec",
    "Box",
    // Generated code contains `use std::collections::HashMap;`, which a
    // type of the same name would conflict with.
    "HashMap",
] as const;
