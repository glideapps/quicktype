export interface DiffLine {
    kind: "hunk" | "add" | "del" | "context";
    old: string;
    next: string;
    text: string;
}
export function parsePatch(patch: string): DiffLine[] {
    const result: DiffLine[] = [];
    let old = 0,
        next = 0,
        inHunk = false;
    for (const line of patch.split("\n")) {
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (match) {
            old = +match[1];
            next = +match[2];
            inHunk = true;
            result.push({ kind: "hunk", old: "", next: "", text: line });
            continue;
        }
        if (!inHunk || ![" ", "+", "-"].includes(line[0])) continue;
        const kind =
            line[0] === "+" ? "add" : line[0] === "-" ? "del" : "context";
        result.push({
            kind,
            old: kind === "add" ? "" : String(old++),
            next: kind === "del" ? "" : String(next++),
            text: line.slice(1),
        });
    }
    return result;
}
