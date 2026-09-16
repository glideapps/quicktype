// A small Wadler-style pretty-printer that reproduces `gleam format`'s exact
// layout for the expression and type fragments this renderer emits. Matching
// the formatter byte-for-byte is required: the fixture pipeline runs
// `gleam format --check src/` on generated output.
//
// The formatter targets an 80-column line and indents in two-space steps. When
// a call, list, tuple, or constructor does not fit on one line it breaks. If
// its *last* argument is itself "huggable" — a collection, a lambda, or a
// nested call — the earlier arguments and that argument's opening delimiter
// stay on the line and only the trailing argument's body breaks (`json.object([`,
// `decode.success(Big(`, `json.array(v, fn(v) {`). Otherwise every argument
// moves to its own line, each with a trailing comma.

export const MAX_WIDTH = 80;
const INDENT = 2;

export type Doc =
    | { kind: "text"; text: string }
    | { kind: "seq"; parts: Doc[] }
    | { kind: "call"; head: string; args: Doc[] }
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

// Whether `gleam format` keeps this document attached to the opening line of
// an enclosing call when that call breaks. Collections and lambdas always hug;
// a nested call hugs only when it is a constructor application (a capitalized
// head such as `Big(` or `FooString(`), not a plain function call.
function isHuggable(doc: Doc): boolean {
    if (doc.kind === "list" || doc.kind === "tuple" || doc.kind === "lambda") {
        return true;
    }

    return doc.kind === "call" && /^[A-Z]/.test(doc.head);
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

// A call whose last argument is huggable can break by hugging that argument,
// which moves its closing delimiter onto a continuation line. `gleam format`
// treats that delimiter as "free", so such a call stays on one line at up to
// one column past the normal limit before it breaks.
export function trailingSlack(doc: Doc): number {
    if (doc.kind === "call" && doc.args.length > 0) {
        return isHuggable(doc.args[doc.args.length - 1]) ? 1 : 0;
    }

    return 0;
}

function fits(doc: Doc, column: number): boolean {
    return column + flat(doc).length <= MAX_WIDTH + trailingSlack(doc);
}

// The opening delimiter of a huggable document — what appears on the enclosing
// line when the document hugs.
function openToken(doc: Doc): string {
    switch (doc.kind) {
        case "list":
            return "[";
        case "tuple":
            return "#(";
        case "lambda":
            return `fn(${doc.param}) {`;
        case "call":
            return `${doc.head}(`;
        default:
            return "";
    }
}

// Render a list or tuple broken across lines. Items sit at `indent + INDENT`;
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

// Force `doc` into its broken (multi-line) form. `column` is where the opening
// delimiter sits, needed only for a nested call's own hug decision.
function renderBroken(doc: Doc, indent: number, column: number): string {
    switch (doc.kind) {
        case "list":
            return renderBrokenItems(doc.items, doc.spread, indent, "[", "]");
        case "tuple":
            return renderBrokenItems(doc.items, null, indent, "#(", ")");
        case "lambda": {
            const bodyIndent = indent + INDENT;
            const body = render(doc.body, bodyIndent, bodyIndent).text;
            return `fn(${doc.param}) {\n${pad(bodyIndent)}${body}\n${pad(indent)}}`;
        }
        case "call":
            return renderCallBroken(doc, indent, column);
        default:
            return render(doc, indent, column).text;
    }
}

function renderCallBroken(
    doc: Doc & { kind: "call" },
    indent: number,
    column: number,
): string {
    const lastArg = doc.args[doc.args.length - 1];
    if (lastArg !== undefined && isHuggable(lastArg)) {
        const leading = doc.args.slice(0, -1).map(flat);
        const prefix = `${doc.head}(${leading.length > 0 ? `${leading.join(", ")}, ` : ""}`;
        // Hug only when the leading arguments and the trailing argument's
        // opening delimiter fit on the line; otherwise every argument breaks.
        // The hug frees the trailing closer, so one column of slack applies.
        if (
            column + prefix.length + openToken(lastArg).length <=
            MAX_WIDTH + 1
        ) {
            return `${prefix}${renderBroken(lastArg, indent, column + prefix.length)})`;
        }
    }

    const childIndent = indent + INDENT;
    let out = `${doc.head}(\n`;
    for (const arg of doc.args) {
        out += `${pad(childIndent)}${render(arg, childIndent, childIndent).text},\n`;
    }

    out += `${pad(indent)})`;
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

            return {
                text: renderCallBroken(doc, indent, column),
                endColumn: indent + 2,
            };
        }
        case "lambda":
        case "tuple":
        case "list": {
            if (fits(doc, column)) {
                const flatText = flat(doc);
                return { text: flatText, endColumn: column + flatText.length };
            }

            return {
                text: renderBroken(doc, indent, column),
                endColumn: indent + 1,
            };
        }
    }
}
