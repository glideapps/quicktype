// A small Wadler-style pretty-printer that reproduces `gleam format`'s exact
// layout for the expression and type fragments this renderer emits. Matching
// the formatter byte-for-byte is required: the fixture pipeline runs
// `gleam format --check src/` on generated output.
//
// The formatter targets an 80-column line and indents in two-space steps. A
// "group" (a call, list, tuple, or record constructor) renders on one line if
// its flat form fits from the current column; otherwise it breaks, placing one
// element per line indented two spaces past the group's own line, with a
// trailing comma after every element except a list spread (`..rest`).

export const MAX_WIDTH = 80;
const INDENT = 2;

export type Doc =
    | { kind: "text"; text: string }
    | { kind: "seq"; parts: Doc[] }
    | { kind: "call"; head: string; args: Doc[] }
    | { kind: "hug"; head: string; collection: Doc }
    | { kind: "lambda"; param: string; body: Doc }
    | { kind: "list"; items: Doc[]; spread: Doc | null }
    | { kind: "tuple"; items: Doc[] };

export function text(s: string): Doc {
    return { kind: "text", text: s };
}

export function seq(...parts: Doc[]): Doc {
    return { kind: "seq", parts };
}

export function call(head: string, args: Doc[]): Doc {
    return { kind: "call", head, args };
}

// A call whose sole argument is a collection literal. `gleam format` keeps the
// opening delimiter on the call's line (`json.object([`) rather than indenting
// the collection as a separate argument.
export function hugCall(head: string, collection: Doc): Doc {
    return { kind: "hug", head, collection };
}

export function lambda(param: string, body: Doc): Doc {
    return { kind: "lambda", param, body };
}

export function list(items: Doc[], spread: Doc | null = null): Doc {
    return { kind: "list", items, spread };
}

export function tuple(items: Doc[]): Doc {
    return { kind: "tuple", items };
}

export function isCollection(doc: Doc): boolean {
    return doc.kind === "list" || doc.kind === "tuple";
}

function pad(n: number): string {
    return " ".repeat(n);
}

export function flat(doc: Doc): string {
    switch (doc.kind) {
        case "text":
            return doc.text;
        case "seq":
            return doc.parts.map(flat).join("");
        case "call":
            return `${doc.head}(${doc.args.map(flat).join(", ")})`;
        case "hug":
            return `${doc.head}(${flat(doc.collection)})`;
        case "lambda":
            return `fn(${doc.param}) { ${flat(doc.body)} }`;
        case "tuple":
            return `#(${doc.items.map(flat).join(", ")})`;
        case "list": {
            const parts = doc.items.map(flat);
            if (doc.spread !== null) {
                parts.push(`..${flat(doc.spread)}`);
            }

            return `[${parts.join(", ")}]`;
        }
    }
}

interface Rendered {
    endColumn: number;
    text: string;
}

function endsWithLambda(doc: Doc): boolean {
    if (doc.kind === "lambda") {
        return true;
    }

    if (doc.kind === "call" && doc.args.length > 0) {
        return doc.args[doc.args.length - 1].kind === "lambda";
    }

    return false;
}

// A trailing lambda ends the flat form with a ` }` block-closer that
// `gleam format` treats as "free": such a construct stays on one line at up to
// one column past the normal limit before it breaks.
export function trailingSlack(doc: Doc): number {
    return endsWithLambda(doc) ? 1 : 0;
}

function fits(doc: Doc, column: number): boolean {
    return column + flat(doc).length <= MAX_WIDTH + trailingSlack(doc);
}

// Break a list or tuple onto multiple lines. Items sit at `indent + INDENT`;
// the closing delimiter returns to `indent`.
function renderBrokenItems(
    items: Doc[],
    spread: Doc | null,
    indent: number,
    open: string,
    close: string,
): string {
    const childIndent = indent + INDENT;
    let out = `${open}\n`;
    for (const item of items) {
        out += `${pad(childIndent)}${render(item, childIndent, childIndent).text},\n`;
    }

    if (spread !== null) {
        out += `${pad(childIndent)}..${render(spread, childIndent, childIndent).text}\n`;
    }

    out += `${pad(indent)}${close}`;
    return out;
}

export function render(doc: Doc, indent: number, column: number): Rendered {
    switch (doc.kind) {
        case "text":
            return { text: doc.text, endColumn: column + doc.text.length };
        case "seq": {
            let out = "";
            let col = column;
            for (const part of doc.parts) {
                const rendered = render(part, indent, col);
                out += rendered.text;
                col = rendered.endColumn;
            }

            return { text: out, endColumn: col };
        }
        case "call": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            // When the final argument is a lambda, `gleam format` keeps the
            // whole argument list (and the lambda's `fn(..) {`) on the opening
            // line and breaks only the lambda body.
            const lastArg = doc.args[doc.args.length - 1];
            if (lastArg !== undefined && lastArg.kind === "lambda") {
                const leading = doc.args.slice(0, -1).map(flat);
                const header = [...leading, `fn(${lastArg.param}) {`].join(
                    ", ",
                );
                const bodyIndent = indent + INDENT;
                const body = render(lastArg.body, bodyIndent, bodyIndent).text;
                const out = `${doc.head}(${header}\n${pad(bodyIndent)}${body}\n${pad(indent)}})`;
                return { text: out, endColumn: indent + 2 };
            }

            const childIndent = indent + INDENT;
            let out = `${doc.head}(\n`;
            for (const arg of doc.args) {
                out += `${pad(childIndent)}${render(arg, childIndent, childIndent).text},\n`;
            }

            out += `${pad(indent)})`;
            return { text: out, endColumn: indent + 1 };
        }
        case "lambda": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            const bodyIndent = indent + INDENT;
            const body = render(doc.body, bodyIndent, bodyIndent).text;
            return {
                text: `fn(${doc.param}) {\n${pad(bodyIndent)}${body}\n${pad(indent)}}`,
                endColumn: indent + 1,
            };
        }
        case "hug": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            const collection = doc.collection;
            const inner =
                collection.kind === "list"
                    ? renderBrokenItems(
                          collection.items,
                          collection.spread,
                          indent,
                          "[",
                          "]",
                      )
                    : collection.kind === "tuple"
                      ? renderBrokenItems(
                            collection.items,
                            null,
                            indent,
                            "#(",
                            ")",
                        )
                      : render(collection, indent, column).text;
            return {
                text: `${doc.head}(${inner})`,
                endColumn: indent + 1,
            };
        }
        case "tuple": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            return {
                text: renderBrokenItems(doc.items, null, indent, "#(", ")"),
                endColumn: indent + 1,
            };
        }
        case "list": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            return {
                text: renderBrokenItems(
                    doc.items,
                    doc.spread,
                    indent,
                    "[",
                    "]",
                ),
                endColumn: indent + 1,
            };
        }
    }
}
